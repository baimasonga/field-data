// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
// This resource adds custom API support for Field Data platform dashboard metrics,
// media library uploads, webhooks, and backup history tracking.

const { sql } = require('slonik');
const config = require('config');
const crypto = require('crypto');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { User, Project, Form } = require('../model/frames');
const { getOrNotFound } = require('../util/promise');
const { success, contentDisposition } = require('../util/http');
const { getEncryptedPgDumpStream } = require('../util/backup');
const Problem = require('../util/problem');

// Reject anything that is not a syntactically valid http(s) URL. We deliberately
// do NOT block private/LAN addresses: offline LAN deployments are a supported
// use case, so a webhook may legitimately target an internal host.
const validateWebhookUrl = (url) => {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    throw Problem.user.unexpectedValue({ field: 'url', value: url, reason: 'must be a valid URL' });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    throw Problem.user.unexpectedValue({ field: 'url', value: url, reason: 'must be an http(s) URL' });
};

const pingUrl = (urlStr) => new Promise((resolve) => {
  try {
    const parsed = new URL(urlStr);
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.get(urlStr, { timeout: 1500 }, (res) => {
      resolve(res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  } catch (err) {
    resolve(false);
  }
});

const upload = multer({
  storage: multer.memoryStorage(),
  // memoryStorage buffers the entire file in the worker's heap, so cap the size
  // to keep a single upload from exhausting memory. 100 MB is generous for the
  // logos/images/short clips this library is meant to hold.
  limits: { fileSize: 100 * 1024 * 1024 }
});

// Resolve persistence directory for media library and manual backups. In the
// Docker deployment a named volume is mounted at /data (see docker-compose.yml)
// so these survive container rebuilds; otherwise we fall back to the app tree.
const storageBaseDir = fs.existsSync('/data') ? '/data' : path.join(__dirname, '../../..');
const mediaDir = path.join(storageBaseDir, 'field-data-media');
const backupsDir = path.join(storageBaseDir, 'field-data-backups');

// Ensure directories exist
if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });
if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });

// Resolve the passphrase used to encrypt a manual backup. Priority:
//   1. an explicit passphrase supplied with the request,
//   2. FIELD_DATA_BACKUP_PASSPHRASE from the environment,
//   3. a persistent, randomly generated per-install secret stored alongside the
//      backups (created on first use, owner-readable only).
// This replaces the former hard-coded public passphrase, which gave the
// encrypted dumps no real protection.
const passphraseFile = path.join(backupsDir, '.passphrase');
const resolveBackupPassphrase = (requested) => {
  if (requested != null && requested !== '') return requested;
  if (process.env.FIELD_DATA_BACKUP_PASSPHRASE) return process.env.FIELD_DATA_BACKUP_PASSPHRASE;
  if (!fs.existsSync(passphraseFile))
    fs.writeFileSync(passphraseFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(passphraseFile, 'utf8').trim();
};

const dayKey = (date) => new Date(date).toISOString().slice(0, 10);
const monthPeriod = (date = new Date()) => `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
const csvValue = (value) => {
  if (value == null) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const csvTable = (columns, rows) => [
  columns.map(col => csvValue(col.header)).join(','),
  ...rows.map(row => columns.map(col => csvValue(col.value(row))).join(','))
].join('\r\n') + '\r\n';
const QUALITY_RULE_KEYS = new Set([
  'noLocation', 'noSubmitter', 'hasIssues', 'rapidSuccession',
  'possibleDuplicate', 'offHours', 'unusualVolume'
]);

module.exports = (service, endpoint, rootContainer, anonymousEndpoint) => {
  // The field_data_* tables backing these resources are created by the
  // 20260707-01-add-field-data-tables migration.

  const getAuthorizedScope = async (container, auth) => {
    const forms = await container.Forms.getAllByAuth(auth);
    const allowedForms = (await Promise.all(forms.map(async (form) =>
      ((await auth.can('submission.list', form)) ? form : null))))
      .filter(form => form != null);
    return {
      formIds: allowedForms.map(form => form.id),
      projectIds: [...new Set(allowedForms.map(form => form.projectId))]
    };
  };

  const dhis2Param = (query, name, fallback) =>
    ((query[name] != null && query[name] !== '') ? query[name] : fallback);
  const defaultDhis2Settings = () => ({
    dataSet: 'FdDataSet01',
    orgUnit: 'FdOrgUnit01',
    categoryOptionCombo: '',
    attributeOptionCombo: '',
    dataElements: {
      submissions: 'FdTotSubm01',
      approved: 'FdApproved1',
      rejected: 'FdRejected1',
      inReview: 'FdInReview1',
      activeForms: 'FdActForms1'
    }
  });
  const getQualityRules = async (db) => {
    const rows = await db.any(sql`
      select key, label, description, active, config
      from field_data_quality_rules
      order by key asc
    `);
    return rows.map(row => ({ ...row, config: row.config || {} }));
  };
  const qualityConfig = (rules, key) => {
    const rule = rules.find(r => r.key === key);
    return { active: rule?.active === true, ...(rule?.config || {}) };
  };
  const getDhis2Settings = async (db) => {
    const row = await db.maybeOne(sql`
      select config from field_data_dhis2_settings where id = true
    `);
    const defaults = defaultDhis2Settings();
    const config = row?.config || {};
    return {
      ...defaults,
      ...config,
      dataElements: { ...defaults.dataElements, ...(config.dataElements || {}) }
    };
  };

  ////////////////////////////////////////////////////////////////////////////////
  // DASHBOARD STATS
  service.get('/field-data/stats', endpoint(async (container, { auth }) => {
    const { Projects } = container;
    const dbPool = container.db;

    // Get projects the user has access to
    const { formIds, projectIds } = await getAuthorizedScope(container, auth);
    const projects = (await Projects.getAllByAuth(auth)).filter(p => projectIds.includes(p.id));

    if (formIds.length === 0) {
      return {
        kpi: { projects: 0, forms: 0, submissions: 0, users: 0, approved: 0, rejected: 0, inReview: 0, activeForms: 0 },
        deltas: { submissions: 0, approved: 0, rejected: 0, inReview: 0 },
        formSummary: { active: 0, inactive: 0, archived: 0, draft: 0 },
        districtCounts: [],
        recentSubmissions: [],
        projects: [],
        submissionsTrend: [],
        topForms: [],
        systemStatus: {
          database: true,
          fileStorage: true,
          enketo: false,
          pyxform: false,
          emailService: false
        }
      };
    }
    const fids = sql.array(formIds, 'int4');

    const isAdmin = await auth.can('user.list', User.species);

    // 1. KPI Counts
    const formsCount = await dbPool.oneFirst(sql`
      select count(*)::integer from forms 
      where "deletedAt" is null and id = ANY(${fids})
    `);

    const submissionsCount = await dbPool.oneFirst(sql`
      select count(*)::integer from submissions 
      join forms on submissions."formId" = forms.id 
      where submissions."deletedAt" is null and submissions.draft = false 
        and forms.id = ANY(${fids})
    `);

    const usersCount = isAdmin
      ? await dbPool.oneFirst(sql`select count(*)::integer from users join actors on users."actorId" = actors.id where actors."deletedAt" is null`)
      : await dbPool.oneFirst(sql`select count(distinct "actorId")::integer from assignments where "acteeId" = ANY(${sql.array(projects.map(p => p.acteeId), 'text')})`);

    // 2. Recent Submissions
    const recentSubmissions = await dbPool.any(sql`
      select submissions.id, submissions."instanceId", submissions."createdAt",
             submissions."reviewState",
             forms."xmlFormId" as form, fd.name as "formName",
             projects.name as project, actors."displayName" as submitter,
             geo.district as location
      from submissions
      join forms on submissions."formId" = forms.id
      left join form_defs fd on forms."currentDefId" = fd.id
      join projects on forms."projectId" = projects.id
      left join actors on submissions."submitterId" = actors.id
      left join field_data_submission_geo geo on geo."submissionId" = submissions.id
      where submissions."deletedAt" is null
        and submissions.draft = false
        and forms.id = ANY(${fids})
      order by submissions."createdAt" desc
      limit 5
    `);

    // 3. Submissions Trend (grouped by day, split by review status)
    const trend = await dbPool.any(sql`
      select date_trunc('day', submissions."createdAt")::date as day,
             count(*)::integer as count,
             count(*) filter (where submissions."reviewState" = 'approved')::integer as approved,
             count(*) filter (where submissions."reviewState" = 'rejected')::integer as rejected,
             count(*) filter (where submissions."reviewState" is distinct from 'approved'
                                and submissions."reviewState" is distinct from 'rejected')::integer as "inReview"
      from submissions
      join forms on submissions."formId" = forms.id
      where submissions."deletedAt" is null
        and submissions.draft = false
        and forms.id = ANY(${fids})
        and submissions."createdAt" >= now() - interval '7 days'
      group by day
      order by day asc
    `);

    // 3b. Submission counts by review status (all-time, for KPI cards)
    const statusCounts = await dbPool.one(sql`
      select
        count(*) filter (where submissions."reviewState" = 'approved')::integer as approved,
        count(*) filter (where submissions."reviewState" = 'rejected')::integer as rejected
      from submissions
      join forms on submissions."formId" = forms.id
      where submissions."deletedAt" is null and submissions.draft = false
        and forms.id = ANY(${fids})
    `);
    const approvedCount = statusCounts.approved;
    const rejectedCount = statusCounts.rejected;
    const inReviewCount = submissionsCount - approvedCount - rejectedCount;

    // 3c. Form summary breakdown (for the donut) + active-forms KPI
    const formSummary = await dbPool.one(sql`
      select
        count(*) filter (where state = 'open' and "currentDefId" is not null)::integer as active,
        count(*) filter (where state = 'closing')::integer as inactive,
        count(*) filter (where state = 'closed')::integer as archived,
        count(*) filter (where "currentDefId" is null)::integer as draft
      from forms
      where "deletedAt" is null and id = ANY(${fids})
    `);
    const activeFormsCount = formSummary.active;

    // 3d. Deltas: current 7-day window vs the prior 7-day window (percent change)
    const windows = await dbPool.one(sql`
      select
        count(*) filter (where submissions."createdAt" >= now() - interval '7 days')::integer as cur_total,
        count(*) filter (where submissions."createdAt" <  now() - interval '7 days')::integer as prev_total,
        count(*) filter (where submissions."createdAt" >= now() - interval '7 days' and submissions."reviewState" = 'approved')::integer as cur_appr,
        count(*) filter (where submissions."createdAt" <  now() - interval '7 days' and submissions."reviewState" = 'approved')::integer as prev_appr,
        count(*) filter (where submissions."createdAt" >= now() - interval '7 days' and submissions."reviewState" = 'rejected')::integer as cur_rej,
        count(*) filter (where submissions."createdAt" <  now() - interval '7 days' and submissions."reviewState" = 'rejected')::integer as prev_rej
      from submissions
      join forms on submissions."formId" = forms.id
      where submissions."deletedAt" is null and submissions.draft = false
        and forms.id = ANY(${fids})
        and submissions."createdAt" >= now() - interval '14 days'
    `);
    const pctDelta = (cur, prev) => (prev === 0 ? (cur > 0 ? 100 : 0) : Math.round(((cur - prev) / prev) * 1000) / 10);
    const curInReview = windows.cur_total - windows.cur_appr - windows.cur_rej;
    const prevInReview = windows.prev_total - windows.prev_appr - windows.prev_rej;
    const deltas = {
      submissions: pctDelta(windows.cur_total, windows.prev_total),
      approved: pctDelta(windows.cur_appr, windows.prev_appr),
      rejected: pctDelta(windows.cur_rej, windows.prev_rej),
      inReview: pctDelta(curInReview, prevInReview)
    };

    // 4. Top Forms
    const topForms = await dbPool.any(sql`
      select forms."xmlFormId" as form, fd.name as name, count(submissions.id)::integer as count
      from submissions
      join forms on submissions."formId" = forms.id
      left join form_defs fd on forms."currentDefId" = fd.id
      where submissions."deletedAt" is null
        and submissions.draft = false
        and forms.id = ANY(${fids})
      group by forms.id, forms."xmlFormId", fd.name
      order by count desc
      limit 5
    `);

    // 4b. Submissions by district (for the Sierra Leone map)
    const districtCounts = await dbPool.any(sql`
      select geo.district, count(*)::integer as count
      from field_data_submission_geo geo
      join submissions on geo."submissionId" = submissions.id
      join forms on submissions."formId" = forms.id
      where submissions."deletedAt" is null and submissions.draft = false
        and forms.id = ANY(${fids})
      group by geo.district
      order by count desc
    `);

    // 5. System Status Checkers
    let dbStatus = false;
    try {
      await dbPool.oneFirst(sql`select 1`);
      dbStatus = true;
    } catch (e) { /* status probe is best-effort */ }

    let fileStorageStatus = false;
    try {
      const testFile = path.join(storageBaseDir, '.write-test');
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      fileStorageStatus = true;
    } catch (e) { /* status probe is best-effort */ }

    let enketoStatus = false;
    const enketoUrl = config.has('default.enketo.url') ? config.get('default.enketo.url') : null;
    if (enketoUrl) {
      enketoStatus = await pingUrl(enketoUrl);
    }

    let pyxformStatus = false;
    const xlsConfig = config.has('default.xlsform') ? config.get('default.xlsform') : null;
    if (xlsConfig) {
      pyxformStatus = await pingUrl(`http://${xlsConfig.host}:${xlsConfig.port}/`);
    }

    let emailServiceStatus = false;
    const emailConfig = config.has('default.email') ? config.get('default.email') : null;
    if (emailConfig && emailConfig.transport) emailServiceStatus = true;

    return {
      kpi: {
        projects: projectIds.length,
        forms: formsCount,
        submissions: submissionsCount,
        users: usersCount,
        approved: approvedCount,
        rejected: rejectedCount,
        inReview: inReviewCount,
        activeForms: activeFormsCount
      },
      deltas,
      formSummary,
      districtCounts,
      recentSubmissions,
      projects: projects.map(p => ({
        id: p.id,
        name: p.name,
        date: p.createdAt,
        count: p.def?.forms || 0
      })),
      submissionsTrend: trend,
      topForms,
      systemStatus: {
        database: dbStatus,
        fileStorage: fileStorageStatus,
        enketo: enketoStatus,
        pyxform: pyxformStatus,
        emailService: emailServiceStatus
      }
    };
  }));

  ////////////////////////////////////////////////////////////////////////////////
  // DATA EXPLORER (Ona-style: table / map / charts / photos for submissions)
  service.get('/field-data/explore', endpoint(async (container, { auth, query }) => {
    const dbPool = container.db;
    const { formIds } = await getAuthorizedScope(container, auth);

    const empty = {
      forms: [], rows: [],
      charts: { byDistrict: [], byStatus: [], byForm: [], trend: [] },
      photos: []
    };
    if (formIds.length === 0) return empty;
    const fids = sql.array(formIds, 'int4');
    const formFilter = query.form ? sql`and forms."xmlFormId" = ${query.form}` : sql``;

    // Forms available to explore (published, with submission counts).
    const forms = await dbPool.any(sql`
      select forms."xmlFormId" as form, fd.name as name,
             count(s.id) filter (where s."deletedAt" is null and s.draft = false)::integer as submissions
      from forms
      left join form_defs fd on forms."currentDefId" = fd.id
      left join submissions s on s."formId" = forms.id
      where forms."deletedAt" is null and forms."currentDefId" is not null
        and forms.id = ANY(${fids})
      group by forms.id, forms."xmlFormId", fd.name
      order by submissions desc, name asc
    `);

    // One row per submission - powers both the Table and the Map.
    const rows = await dbPool.any(sql`
      select s.id, s."instanceId", s."createdAt", s."reviewState",
             forms."xmlFormId" as form, fd.name as "formName",
             actors."displayName" as submitter,
             geo.district, geo.lat, geo.lng
      from submissions s
      join forms on s."formId" = forms.id
      left join form_defs fd on forms."currentDefId" = fd.id
      left join actors on s."submitterId" = actors.id
      left join field_data_submission_geo geo on geo."submissionId" = s.id
      where s."deletedAt" is null and s.draft = false
        and forms.id = ANY(${fids}) ${formFilter}
      order by s."createdAt" desc
      limit 3000
    `);

    // Chart aggregations.
    const byDistrict = await dbPool.any(sql`
      select geo.district as label, count(*)::integer as count
      from submissions s
      join forms on s."formId" = forms.id
      join field_data_submission_geo geo on geo."submissionId" = s.id
      where s."deletedAt" is null and s.draft = false
        and forms.id = ANY(${fids}) ${formFilter}
      group by geo.district order by count desc
    `);
    const byStatus = await dbPool.any(sql`
      select coalesce(s."reviewState", 'received') as label, count(*)::integer as count
      from submissions s
      join forms on s."formId" = forms.id
      where s."deletedAt" is null and s.draft = false
        and forms.id = ANY(${fids}) ${formFilter}
      group by s."reviewState" order by count desc
    `);
    const byForm = await dbPool.any(sql`
      select fd.name as label, count(*)::integer as count
      from submissions s
      join forms on s."formId" = forms.id
      left join form_defs fd on forms."currentDefId" = fd.id
      where s."deletedAt" is null and s.draft = false
        and forms.id = ANY(${fids}) ${formFilter}
      group by fd.name order by count desc limit 10
    `);
    const trend = await dbPool.any(sql`
      select date_trunc('day', s."createdAt")::date as day, count(*)::integer as count
      from submissions s
      join forms on s."formId" = forms.id
      where s."deletedAt" is null and s.draft = false
        and forms.id = ANY(${fids}) ${formFilter}
        and s."createdAt" >= now() - interval '30 days'
      group by day order by day asc
    `);

    // Photos: best-effort listing of image attachments across submissions. If the
    // attachment schema differs, fall back to an empty gallery rather than error.
    let photos = [];
    try {
      photos = await dbPool.any(sql`
        select s."instanceId", forms."projectId" as "projectId",
               forms."xmlFormId" as form, sa.name
        from submission_attachments sa
        join submission_defs sd on sa."submissionDefId" = sd.id
        join submissions s on s.id = sd."submissionId"
        join forms on s."formId" = forms.id
        left join blobs b on sa."blobId" = b.id
        where s."deletedAt" is null and s.draft = false and sa."blobId" is not null
          and forms.id = ANY(${fids}) ${formFilter}
          and (b."contentType" like 'image/%' or sa.name ~* '\\.(jpg|jpeg|png|gif|webp)$')
        order by s."createdAt" desc
        limit 200
      `);
    } catch (e) { photos = []; }

    return { forms, rows, charts: { byDistrict, byStatus, byForm, trend }, photos };
  }));

  service.get('/field-data/explore.csv', endpoint.plain(async (container, { auth, query }, _, response) => {
    const dbPool = container.db;
    const { formIds } = await getAuthorizedScope(container, auth);
    const selectedForm = query.form || '';
    const filename = selectedForm ? `field-data-${selectedForm}-explorer.csv` : 'field-data-explorer.csv';

    response.set('Content-Disposition', contentDisposition(filename));
    response.set('Content-Type', 'text/csv');

    if (formIds.length === 0) {
      return csvTable([
        { header: 'submission_id', value: r => r.id },
        { header: 'instance_id', value: r => r.instanceId },
        { header: 'project_id', value: r => r.projectId },
        { header: 'project', value: r => r.project },
        { header: 'form_id', value: r => r.form },
        { header: 'form_name', value: r => r.formName },
        { header: 'submitter', value: r => r.submitter },
        { header: 'district', value: r => r.district },
        { header: 'latitude', value: r => r.lat },
        { header: 'longitude', value: r => r.lng },
        { header: 'review_state', value: r => r.reviewState || 'received' },
        { header: 'submitted_at', value: r => r.createdAt },
        { header: 'submission_url', value: r => r.submissionUrl }
      ], []);
    }

    const fids = sql.array(formIds, 'int4');
    const formFilter = selectedForm ? sql`and forms."xmlFormId" = ${selectedForm}` : sql``;
    const rows = await dbPool.any(sql`
      select s.id, s."instanceId", s."createdAt", s."reviewState",
             forms."projectId" as "projectId", projects.name as project,
             forms."xmlFormId" as form, fd.name as "formName",
             actors."displayName" as submitter,
             geo.district, geo.lat, geo.lng
      from submissions s
      join forms on s."formId" = forms.id
      join projects on forms."projectId" = projects.id
      left join form_defs fd on forms."currentDefId" = fd.id
      left join actors on s."submitterId" = actors.id
      left join field_data_submission_geo geo on geo."submissionId" = s.id
      where s."deletedAt" is null and s.draft = false
        and forms.id = ANY(${fids}) ${formFilter}
      order by s."createdAt" desc
      limit 10000
    `);

    return csvTable([
      { header: 'submission_id', value: r => r.id },
      { header: 'instance_id', value: r => r.instanceId },
      { header: 'project_id', value: r => r.projectId },
      { header: 'project', value: r => r.project },
      { header: 'form_id', value: r => r.form },
      { header: 'form_name', value: r => r.formName },
      { header: 'submitter', value: r => r.submitter },
      { header: 'district', value: r => r.district },
      { header: 'latitude', value: r => r.lat },
      { header: 'longitude', value: r => r.lng },
      { header: 'review_state', value: r => r.reviewState || 'received' },
      { header: 'submitted_at', value: r => r.createdAt },
      {
        header: 'submission_url',
        value: r => `/projects/${r.projectId}/forms/${encodeURIComponent(r.form)}/submissions/${encodeURIComponent(r.instanceId)}`
      }
    ], rows);
  }));

  ////////////////////////////////////////////////////////////////////////////////
  // FIELD TEAMS (per-enumerator performance)
  service.get('/field-data/team', endpoint(async (container, { auth }) => {
    const dbPool = container.db;
    const { formIds } = await getAuthorizedScope(container, auth);
    if (formIds.length === 0) return { members: [], totals: { enumerators: 0, submissions: 0, avgApproval: 0 } };
    const fids = sql.array(formIds, 'int4');
    const members = await dbPool.any(sql`
      select actors.id as "submitterId", coalesce(actors."displayName", '(unassigned)') as name,
        count(*)::integer as total,
        count(*) filter (where s."reviewState" = 'approved')::integer as approved,
        count(*) filter (where s."reviewState" = 'rejected')::integer as rejected,
        count(*) filter (where s."reviewState" is distinct from 'approved' and s."reviewState" is distinct from 'rejected')::integer as "needsReview",
        count(distinct geo.district)::integer as districts,
        count(distinct s."formId")::integer as forms,
        max(s."createdAt") as "lastActive"
      from submissions s
      join forms on s."formId" = forms.id
      left join actors on s."submitterId" = actors.id
      left join field_data_submission_geo geo on geo."submissionId" = s.id
      where s."deletedAt" is null and s.draft = false and forms.id = ANY(${fids})
      group by actors.id, actors."displayName"
      order by total desc
    `);
    const submissions = members.reduce((n, m) => n + m.total, 0);
    const decided = members.reduce((n, m) => n + m.approved + m.rejected, 0);
    const approvedTotal = members.reduce((n, m) => n + m.approved, 0);
    const avgApproval = decided > 0 ? Math.round((approvedTotal / decided) * 100) : 0;
    return { members, totals: { enumerators: members.length, submissions, avgApproval } };
  }));

  ////////////////////////////////////////////////////////////////////////////////
  // REVIEW QUEUE + DATA QUALITY FLAGS + APPROVAL ACTION
  service.get('/field-data/review', endpoint(async (container, { auth }) => {
    const dbPool = container.db;
    const { formIds } = await getAuthorizedScope(container, auth);
    if (formIds.length === 0) return { items: [], counts: { pending: 0, flagged: 0 }, qualitySummary: [] };
    const fids = sql.array(formIds, 'int4');
    const rules = await getQualityRules(dbPool);
    const rapidRule = qualityConfig(rules, 'rapidSuccession');
    const duplicateRule = qualityConfig(rules, 'possibleDuplicate');
    const offHoursRule = qualityConfig(rules, 'offHours');
    const volumeRule = qualityConfig(rules, 'unusualVolume');
    const rows = await dbPool.any(sql`
      select s.id, s."instanceId", s."createdAt", s."reviewState", s."submitterId",
        forms.id as "formId", forms."xmlFormId" as form, fd.name as "formName", forms."projectId" as "projectId",
        actors."displayName" as submitter, geo.district, geo.lat,
        latest_review.note as "latestReviewNote", latest_review.decision as "latestReviewDecision"
      from submissions s
      join forms on s."formId" = forms.id
      left join form_defs fd on forms."currentDefId" = fd.id
      left join actors on s."submitterId" = actors.id
      left join field_data_submission_geo geo on geo."submissionId" = s.id
      left join lateral (
        select decision, note
        from field_data_reviews r
        where r."submissionId" = s.id
        order by r."reviewedAt" desc
        limit 1
      ) latest_review on true
      where s."deletedAt" is null and s.draft = false and forms.id = ANY(${fids})
        and (s."reviewState" is null or s."reviewState" in ('received', 'hasIssues', 'edited'))
      order by s."createdAt" desc
      limit 300
    `);

    const rapidSuccessionIds = rapidRule.active ? new Set(await dbPool.anyFirst(sql`
      with ordered as (
        select s.id, s."submitterId", s."createdAt",
          lag(s."createdAt") over (partition by s."submitterId" order by s."createdAt") as prev_at,
          lead(s."createdAt") over (partition by s."submitterId" order by s."createdAt") as next_at
        from submissions s
        where s."deletedAt" is null and s.draft = false
          and s."submitterId" is not null
          and s."formId" = ANY(${fids})
      )
      select id from ordered
      where (prev_at is not null and "createdAt" - prev_at < (${rapidRule.minutes || 3} * interval '1 minute'))
        or (next_at is not null and next_at - "createdAt" < (${rapidRule.minutes || 3} * interval '1 minute'))
    `)) : new Set();

    const possibleDuplicateIds = duplicateRule.active ? new Set(await dbPool.anyFirst(sql`
      select distinct s.id
      from submissions s
      join field_data_submission_geo geo on geo."submissionId" = s.id
      where s."deletedAt" is null and s.draft = false
        and s."submitterId" is not null
        and s."formId" = ANY(${fids})
        and exists (
          select 1
          from submissions other
          join field_data_submission_geo other_geo on other_geo."submissionId" = other.id
          where other.id <> s.id
            and other."deletedAt" is null
            and other.draft = false
            and other."submitterId" = s."submitterId"
            and other."formId" = s."formId"
            and other_geo.district = geo.district
            and abs(extract(epoch from (other."createdAt" - s."createdAt"))) <= ${(duplicateRule.minutes || 10) * 60}
        )
    `)) : new Set();

    const volumeRows = volumeRule.active ? await dbPool.any(sql`
      select s.id, s."submitterId", s."createdAt"
      from submissions s
      where s."deletedAt" is null and s.draft = false
        and s."submitterId" is not null
        and s."formId" = ANY(${fids})
        and s."createdAt" >= now() - (${volumeRule.lookbackDays || 45} * interval '1 day')
    `) : [];
    const dailyCounts = new Map();
    for (const row of volumeRows) {
      const key = `${row.submitterId}:${dayKey(row.createdAt)}`;
      dailyCounts.set(key, (dailyCounts.get(key) || 0) + 1);
    }
    const submitterDayCounts = new Map();
    for (const [key, count] of dailyCounts) {
      const [submitterId, day] = key.split(':');
      if (!submitterDayCounts.has(submitterId)) submitterDayCounts.set(submitterId, []);
      submitterDayCounts.get(submitterId).push({ day, count });
    }
    const unusualVolumeIds = new Set();
    for (const row of volumeRows) {
      const submitterId = row.submitterId.toString();
      const today = dayKey(row.createdAt);
      const todayCount = dailyCounts.get(`${submitterId}:${today}`) || 0;
      const prior = (submitterDayCounts.get(submitterId) || []).filter(d => d.day < today).map(d => d.count);
      const avg = prior.length > 0 ? prior.reduce((sum, count) => sum + count, 0) / prior.length : 0;
      if (avg > 0 && todayCount >= (volumeRule.minDailyCount || 8) && todayCount >= avg * (volumeRule.multiplier || 2.5)) unusualVolumeIds.add(row.id);
    }

    let flaggedCount = 0;
    const activeKeys = rules.filter(rule => rule.active).map(rule => rule.key);
    const qualityCounts = Object.fromEntries(activeKeys.map(key => [key, 0]));
    const items = rows.map((r) => {
      const flags = [];
      if (qualityConfig(rules, 'noLocation').active && (r.district == null || r.lat == null)) flags.push('noLocation');
      if (qualityConfig(rules, 'noSubmitter').active && r.submitter == null) flags.push('noSubmitter');
      if (qualityConfig(rules, 'hasIssues').active && r.reviewState === 'hasIssues') flags.push('hasIssues');
      if (rapidSuccessionIds.has(r.id)) flags.push('rapidSuccession');
      if (possibleDuplicateIds.has(r.id)) flags.push('possibleDuplicate');
      const submittedHour = new Date(r.createdAt).getUTCHours();
      if (offHoursRule.active && submittedHour >= (offHoursRule.startHour ?? 0) && submittedHour < (offHoursRule.endHour ?? 5)) flags.push('offHours');
      if (unusualVolumeIds.has(r.id)) flags.push('unusualVolume');
      for (const key of Object.keys(qualityCounts)) {
        if (flags.includes(key)) qualityCounts[key] += 1;
      }
      if (flags.length > 0) flaggedCount += 1;
      return { ...r, flags };
    });
    const qualitySummary = rules
      .map(rule => ({ key: rule.key, label: rule.label, count: qualityCounts[rule.key] || 0 }))
      .filter(item => item.count > 0);
    return { items, counts: { pending: items.length, flagged: flaggedCount }, qualitySummary, rules };
  }));

  service.post('/field-data/review', endpoint(async (container, { auth, body }) => {
    await auth.canOrReject('project.create', Project.species); // restrict to admin/managers
    const valid = ['approved', 'rejected', 'hasIssues'];
    if (body.submissionId == null || !valid.includes(body.decision))
      throw Problem.user.unexpectedValue({ field: 'decision', value: body.decision, reason: 'must be approved, rejected, or hasIssues' });

    const target = await container.maybeOne(sql`
      select s.id, forms.id as "formId", forms."projectId"
      from submissions s
      join forms on s."formId" = forms.id
      where s.id = ${body.submissionId}
        and s."deletedAt" is null
        and s.draft = false
    `).then(getOrNotFound);
    await container.Forms.getByProjectAndNumericId(target.projectId, target.formId, Form.WithoutDef)
      .then(getOrNotFound)
      .then(auth.canOrReject('submission.update'));

    let reviewedBy = null;
    try { reviewedBy = auth.actor.map((a) => a.displayName).orElse(null); } catch (e) { reviewedBy = null; }
    await container.db.query(sql`update submissions set "reviewState" = ${body.decision} where id = ${target.id}`);
    await container.db.query(sql`
      insert into field_data_reviews ("submissionId", decision, note, "reviewedBy")
      values (${target.id}, ${body.decision}, ${body.note || null}, ${reviewedBy})`);
    return success();
  }));

  service.get('/field-data/cleaning', endpoint(async (container, { auth }) => {
    await auth.canOrReject('project.create', Project.species);
    const dbPool = container.db;
    const { formIds } = await getAuthorizedScope(container, auth);
    if (formIds.length === 0) {
      return {
        counts: { open: 0, corrected: 0, rejected: 0 },
        items: []
      };
    }
    const fids = sql.array(formIds, 'int4');

    const counts = await dbPool.one(sql`
      select
        count(*) filter (where s."reviewState" = 'hasIssues')::integer as open,
        count(*) filter (where s."reviewState" = 'edited')::integer as corrected,
        count(*) filter (where s."reviewState" = 'rejected')::integer as rejected
      from submissions s
      join forms on s."formId" = forms.id
      where s."deletedAt" is null and s.draft = false
        and forms.id = ANY(${fids})
    `);

    const items = await dbPool.any(sql`
      select s.id, s."instanceId", s."createdAt", s."reviewState",
             forms."projectId" as "projectId", forms."xmlFormId" as form,
             fd.name as "formName", actors."displayName" as submitter,
             geo.district, geo.lat, geo.lng,
             latest_review.note as note,
             latest_review."reviewedBy" as "reviewedBy",
             latest_review."reviewedAt" as "reviewedAt"
      from submissions s
      join forms on s."formId" = forms.id
      left join form_defs fd on forms."currentDefId" = fd.id
      left join actors on s."submitterId" = actors.id
      left join field_data_submission_geo geo on geo."submissionId" = s.id
      left join lateral (
        select r.note, r."reviewedBy", r."reviewedAt"
        from field_data_reviews r
        where r."submissionId" = s.id and r.decision = 'hasIssues'
        order by r."reviewedAt" desc
        limit 1
      ) latest_review on true
      where s."deletedAt" is null and s.draft = false
        and s."reviewState" = 'hasIssues'
        and forms.id = ANY(${fids})
      order by latest_review."reviewedAt" desc nulls last, s."createdAt" desc
      limit 1000
    `);

    return { counts, items };
  }));

  service.get('/field-data/quality-rules', endpoint(async (container, { auth }) => {
    await auth.canOrReject('project.create', Project.species);
    return getQualityRules(container.db);
  }));

  service.patch('/field-data/quality-rules/:key', endpoint(async (container, { auth, params, body }) => {
    await auth.canOrReject('project.create', Project.species);
    if (!QUALITY_RULE_KEYS.has(params.key))
      throw Problem.user.unexpectedValue({ field: 'key', value: params.key, reason: 'is not a supported quality rule' });
    const existing = await container.maybeOne(sql`
      select key, label, description, active, config from field_data_quality_rules where key = ${params.key}
    `).then(getOrNotFound);
    const nextConfig = { ...(existing.config || {}), ...(body.config || {}) };
    return container.db.one(sql`
      update field_data_quality_rules
      set active = ${body.active !== undefined ? body.active : existing.active},
          label = ${body.label !== undefined ? body.label : existing.label},
          description = ${body.description !== undefined ? body.description : existing.description},
          config = ${JSON.stringify(nextConfig)}::jsonb,
          "updatedAt" = clock_timestamp()
      where key = ${params.key}
      returning key, label, description, active, config
    `);
  }));

  service.get('/field-data/templates', endpoint(async (container, { auth }) => {
    await auth.canOrReject('project.create', Project.species);
    const templates = await container.db.any(sql`
      select id, name, category, description, config, "createdBy", "createdAt", "updatedAt"
      from field_data_project_templates
      order by "createdAt" asc, name asc
    `);
    const qualityRules = await getQualityRules(container.db);
    return { templates, qualityRules };
  }));

  service.post('/field-data/templates', endpoint(async (container, { auth, body }) => {
    await auth.canOrReject('project.create', Project.species);
    const name = (body.name || '').trim();
    if (name === '')
      throw Problem.user.unexpectedValue({ field: 'name', value: body.name, reason: 'must not be blank' });

    let createdBy = null;
    try { createdBy = auth.actor.map((a) => a.displayName).orElse(null); } catch (e) { createdBy = null; }
    const qualityRules = await getQualityRules(container.db);
    const rulesConfig = Object.fromEntries(qualityRules.map(rule => [
      rule.key,
      { active: rule.active, ...(rule.config || {}) }
    ]));
    const configBody = body.config || {};
    const configPayload = {
      forms: Array.isArray(configBody.forms) ? configBody.forms : [],
      workflow: Array.isArray(configBody.workflow)
        ? configBody.workflow
        : ['collect', 'review', 'request_correction', 'approve', 'export'],
      qualityRules: configBody.qualityRules || rulesConfig,
      integrations: Array.isArray(configBody.integrations)
        ? configBody.integrations
        : ['csv_export', 'public_report', 'webhooks']
    };

    return container.db.one(sql`
      insert into field_data_project_templates (name, category, description, config, "createdBy")
      values (
        ${name},
        ${(body.category || 'General').trim() || 'General'},
        ${body.description || null},
        ${JSON.stringify(configPayload)}::jsonb,
        ${createdBy}
      )
      returning id, name, category, description, config, "createdBy", "createdAt", "updatedAt"
    `);
  }));

  service.delete('/field-data/templates/:id', endpoint(async (container, { auth, params }) => {
    await auth.canOrReject('project.create', Project.species);
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0)
      throw Problem.user.unexpectedValue({ field: 'id', value: params.id, reason: 'must be a positive integer' });
    const deleted = await container.db.maybeOneFirst(sql`
      delete from field_data_project_templates
      where id = ${id}
      returning id
    `);
    if (deleted == null) throw Problem.user.notFound();
    return success();
  }));

  ////////////////////////////////////////////////////////////////////////////////
  // CASE MANAGEMENT (beneficiary/site tracking + assignments)
  service.get('/field-data/cases', endpoint(async (container, { auth, query }) => {
    await auth.canOrReject('project.create', Project.species);
    const status = query.status ? sql`and c.status = ${query.status}` : sql``;
    const district = query.district ? sql`and c.district = ${query.district}` : sql``;
    const q = query.q ? sql`and c.name ilike ${`%${query.q}%`}` : sql``;
    const cases = await container.db.any(sql`
      select c.*,
        (select count(*)::integer from field_data_case_submissions cs where cs."caseId" = c.id) as visits,
        (select max(s."createdAt") from field_data_case_submissions cs join submissions s on cs."submissionId" = s.id where cs."caseId" = c.id) as "lastVisit",
        (select count(*)::integer from field_data_assignments a where a."caseId" = c.id and a.status = 'assigned') as "openAssignments"
      from field_data_cases c
      where true ${status} ${district} ${q}
      order by c."createdAt" desc
      limit 500
    `);
    const counts = await container.db.one(sql`
      select count(*)::integer as total,
        count(*) filter (where status = 'active')::integer as active,
        count(*) filter (where status = 'closed')::integer as closed
      from field_data_cases
    `);
    return { cases, counts };
  }));

  service.post('/field-data/cases', endpoint(async (container, { auth, body }) => {
    await auth.canOrReject('project.create', Project.species);
    if (body.name == null || body.name === '')
      throw Problem.user.unexpectedValue({ field: 'name', value: body.name, reason: 'is required' });
    return container.db.one(sql`
      insert into field_data_cases (name, type, district, note)
      values (${body.name}, ${body.type || 'household'}, ${body.district || null}, ${body.note || null})
      returning *
    `);
  }));

  service.get('/field-data/cases/:id', endpoint(async (container, { auth, params }) => {
    await auth.canOrReject('project.create', Project.species);
    const kase = await container.maybeOne(sql`
      select * from field_data_cases where id = ${params.id}
    `).then(getOrNotFound);
    const timeline = await container.db.any(sql`
      select s.id, s."instanceId", s."createdAt", s."reviewState",
        forms."xmlFormId" as form, fd.name as "formName", actors."displayName" as submitter
      from field_data_case_submissions cs
      join submissions s on cs."submissionId" = s.id
      join forms on s."formId" = forms.id
      left join form_defs fd on forms."currentDefId" = fd.id
      left join actors on s."submitterId" = actors.id
      where cs."caseId" = ${params.id}
      order by s."createdAt" desc
    `);
    const assignments = await container.db.any(sql`
      select a.*, actors."displayName" as enumerator
      from field_data_assignments a
      left join actors on a."actorId" = actors.id
      where a."caseId" = ${params.id}
      order by a."createdAt" desc
    `);
    return { case: kase, timeline, assignments };
  }));

  service.patch('/field-data/cases/:id', endpoint(async (container, { auth, params, body }) => {
    await auth.canOrReject('project.create', Project.species);
    const kase = await container.maybeOne(sql`
      select * from field_data_cases where id = ${params.id}
    `).then(getOrNotFound);
    const updated = {
      name: body.name !== undefined ? body.name : kase.name,
      type: body.type !== undefined ? body.type : kase.type,
      district: body.district !== undefined ? body.district : kase.district,
      status: body.status !== undefined ? body.status : kase.status,
      note: body.note !== undefined ? body.note : kase.note
    };
    return container.db.one(sql`
      update field_data_cases
      set name=${updated.name}, type=${updated.type}, district=${updated.district},
          status=${updated.status}, note=${updated.note}
      where id=${params.id}
      returning *
    `);
  }));

  service.post('/field-data/cases/:id/link', endpoint(async (container, { auth, params, body }) => {
    await auth.canOrReject('project.create', Project.species);
    if (body.submissionId == null)
      throw Problem.user.unexpectedValue({ field: 'submissionId', value: body.submissionId, reason: 'is required' });
    await container.db.query(sql`
      insert into field_data_case_submissions ("caseId", "submissionId")
      values (${params.id}, ${body.submissionId})
      on conflict do nothing
    `);
    return success();
  }));

  service.get('/field-data/assignments', endpoint(async (container, { auth, query }) => {
    await auth.canOrReject('project.create', Project.species);
    const status = query.status ? sql`and a.status = ${query.status}` : sql``;
    const assignments = await container.db.any(sql`
      select a.*, actors."displayName" as enumerator, c.name as "caseName", c.district as "caseDistrict"
      from field_data_assignments a
      left join actors on a."actorId" = actors.id
      left join field_data_cases c on a."caseId" = c.id
      where true ${status}
      order by (a.status = 'assigned') desc, a."dueDate" asc nulls last, a."createdAt" desc
      limit 500
    `);
    const counts = await container.db.one(sql`
      select count(*) filter (where status = 'assigned')::integer as open,
        count(*) filter (where status = 'assigned' and "dueDate" is not null and "dueDate" < current_date)::integer as overdue,
        count(*) filter (where status = 'done')::integer as done
      from field_data_assignments
    `);
    return { assignments, counts };
  }));

  service.post('/field-data/assignments', endpoint(async (container, { auth, body }) => {
    await auth.canOrReject('project.create', Project.species);
    if (body.actorId == null)
      throw Problem.user.unexpectedValue({ field: 'actorId', value: body.actorId, reason: 'is required' });
    return container.db.one(sql`
      insert into field_data_assignments ("caseId", "actorId", form, note, "dueDate")
      values (${body.caseId || null}, ${body.actorId}, ${body.form || null}, ${body.note || null}, ${body.dueDate || null})
      returning *
    `);
  }));

  service.patch('/field-data/assignments/:id', endpoint(async (container, { auth, params, body }) => {
    await auth.canOrReject('project.create', Project.species);
    const valid = ['assigned', 'in_progress', 'done', 'cancelled'];
    if (!valid.includes(body.status))
      throw Problem.user.unexpectedValue({ field: 'status', value: body.status, reason: `must be one of ${valid.join(', ')}` });
    const completed = body.status === 'done' ? sql`, "completedAt" = clock_timestamp()` : sql``;
    return container.db.maybeOne(sql`
      update field_data_assignments set status = ${body.status} ${completed}
      where id = ${params.id}
      returning *
    `).then(getOrNotFound);
  }));

  ////////////////////////////////////////////////////////////////////////////////
  // REPORTS & PUBLIC SHARE LINKS

  // Aggregate program report for the given forms. Aggregates only - no raw
  // submission records or emails, so it is safe to expose via a share link.
  const buildReport = async (dbPool, formIds, options = {}) => {
    const fids = sql.array(formIds, 'int4');
    const kpi = await dbPool.one(sql`
      select
        count(distinct forms."projectId")::integer as projects,
        count(distinct forms.id) filter (where forms."currentDefId" is not null)::integer as forms,
        count(s.id)::integer as submissions,
        count(s.id) filter (where s."reviewState" = 'approved')::integer as approved,
        count(s.id) filter (where s."reviewState" = 'rejected')::integer as rejected,
        count(s.id) filter (where s."reviewState" is distinct from 'approved'
                              and s."reviewState" is distinct from 'rejected')::integer as "inReview"
      from forms
      left join submissions s on s."formId" = forms.id and s."deletedAt" is null and s.draft = false
      where forms."deletedAt" is null and forms.id = ANY(${fids})
    `);
    const districtCounts = await dbPool.any(sql`
      select geo.district, count(*)::integer as count
      from field_data_submission_geo geo
      join submissions s on geo."submissionId" = s.id
      join forms on s."formId" = forms.id
      where s."deletedAt" is null and s.draft = false and forms.id = ANY(${fids})
      group by geo.district order by count desc
    `);
    const trend = await dbPool.any(sql`
      select date_trunc('day', s."createdAt")::date as day, count(*)::integer as count
      from submissions s join forms on s."formId" = forms.id
      where s."deletedAt" is null and s.draft = false and forms.id = ANY(${fids})
        and s."createdAt" >= now() - interval '30 days'
      group by day order by day asc
    `);
    const topForms = await dbPool.any(sql`
      select fd.name as name, forms."xmlFormId" as form, count(s.id)::integer as count,
        count(s.id) filter (where s."reviewState" = 'approved')::integer as approved
      from submissions s
      join forms on s."formId" = forms.id
      left join form_defs fd on forms."currentDefId" = fd.id
      where s."deletedAt" is null and s.draft = false and forms.id = ANY(${fids})
      group by forms.id, forms."xmlFormId", fd.name
      order by count desc limit 8
    `);
    const team = await dbPool.any(sql`
      select coalesce(actors."displayName", '(unassigned)') as name,
        count(*)::integer as total,
        count(*) filter (where s."reviewState" = 'approved')::integer as approved,
        count(*) filter (where s."reviewState" = 'rejected')::integer as rejected
      from submissions s
      join forms on s."formId" = forms.id
      left join actors on s."submitterId" = actors.id
      where s."deletedAt" is null and s.draft = false and forms.id = ANY(${fids})
      group by actors."displayName" order by total desc limit 12
    `);
    const decided = kpi.approved + kpi.rejected;
    return {
      generatedAt: new Date().toISOString(),
      kpi,
      approvalRate: decided > 0 ? Math.round((kpi.approved / decided) * 100) : 0,
      districtCounts,
      trend,
      topForms,
      team: options.anonymizeTeam === true
        ? team.map((member, index) => ({ ...member, name: `Enumerator ${index + 1}` }))
        : team
    };
  };

  service.get('/field-data/report', endpoint(async (container, { auth }) => {
    const { formIds } = await getAuthorizedScope(container, auth);
    if (formIds.length === 0) return buildReport(container.db, [-1]);
    return buildReport(container.db, formIds);
  }));

  service.get('/field-data/dhis2-settings', endpoint(async (container, { auth }) => {
    await auth.canOrReject('project.create', Project.species);
    return getDhis2Settings(container.db);
  }));

  service.patch('/field-data/dhis2-settings', endpoint(async (container, { auth, body }) => {
    await auth.canOrReject('project.create', Project.species);
    const current = await getDhis2Settings(container.db);
    const incomingElements = body.dataElements != null && typeof body.dataElements === 'object' && !Array.isArray(body.dataElements)
      ? body.dataElements
      : {};
    const next = {
      dataSet: body.dataSet !== undefined ? body.dataSet : current.dataSet,
      orgUnit: body.orgUnit !== undefined ? body.orgUnit : current.orgUnit,
      categoryOptionCombo: body.categoryOptionCombo !== undefined ? body.categoryOptionCombo : current.categoryOptionCombo,
      attributeOptionCombo: body.attributeOptionCombo !== undefined ? body.attributeOptionCombo : current.attributeOptionCombo,
      dataElements: { ...(current.dataElements || {}), ...incomingElements }
    };
    return container.db.oneFirst(sql`
      insert into field_data_dhis2_settings (id, config)
      values (true, ${JSON.stringify(next)}::jsonb)
      on conflict (id) do update
      set config = excluded.config,
          "updatedAt" = clock_timestamp()
      returning config
    `);
  }));

  service.get('/field-data/dhis2', endpoint(async (container, { auth, query }) => {
    const { formIds } = await getAuthorizedScope(container, auth);
    const settings = await getDhis2Settings(container.db);
    const dataElements = settings.dataElements || {};
    const report = await buildReport(container.db, formIds.length === 0 ? [-1] : formIds, { anonymizeTeam: true });
    const categoryOptionCombo = dhis2Param(query, 'categoryOptionCombo', settings.categoryOptionCombo || undefined);
    const attrOptionCombo = dhis2Param(query, 'attributeOptionCombo', settings.attributeOptionCombo || undefined);
    const asDataValue = (dataElement, value, comment) => ({
      dataElement,
      value: value == null ? 0 : value,
      ...(categoryOptionCombo != null ? { categoryOptionCombo } : {}),
      ...(attrOptionCombo != null ? { attributeOptionCombo: attrOptionCombo } : {}),
      ...(comment != null ? { comment } : {})
    });

    return {
      dataSet: dhis2Param(query, 'dataSet', settings.dataSet || 'FdDataSet01'),
      completeDate: new Date().toISOString().slice(0, 10),
      period: dhis2Param(query, 'period', monthPeriod()),
      orgUnit: dhis2Param(query, 'orgUnit', settings.orgUnit || 'FdOrgUnit01'),
      dataValues: [
        asDataValue(dhis2Param(query, 'deSubmissions', dataElements.submissions || 'FdTotSubm01'), report.kpi.submissions, 'Total Field Data submissions'),
        asDataValue(dhis2Param(query, 'deApproved', dataElements.approved || 'FdApproved1'), report.kpi.approved, 'Approved submissions'),
        asDataValue(dhis2Param(query, 'deRejected', dataElements.rejected || 'FdRejected1'), report.kpi.rejected, 'Rejected submissions'),
        asDataValue(dhis2Param(query, 'deInReview', dataElements.inReview || 'FdInReview1'), report.kpi.inReview, 'Submissions still in review'),
        asDataValue(dhis2Param(query, 'deActiveForms', dataElements.activeForms || 'FdActForms1'), report.kpi.forms, 'Active forms')
      ],
      fieldData: {
        generatedAt: report.generatedAt,
        source: 'Field Data',
        mappingNote: 'DHIS2 IDs come from Field Data DHIS2 settings unless query parameters override them.'
      }
    };
  }));

  service.get('/field-data/shares', endpoint(async (container, { auth }) => {
    await auth.canOrReject('project.create', Project.species);
    return container.db.any(sql`
      select id, token, label, "createdAt", "revokedAt"
      from field_data_share_links order by "createdAt" desc
    `);
  }));

  service.post('/field-data/shares', endpoint(async (container, { auth, body }) => {
    await auth.canOrReject('project.create', Project.species);
    const { formIds } = await getAuthorizedScope(container, auth);
    const token = crypto.randomBytes(24).toString('hex');
    return container.db.one(sql`
      insert into field_data_share_links (token, label, "formIds")
      values (${token}, ${body.label || null}, ${sql.array(formIds, 'int4')})
      returning *
    `);
  }));

  service.delete('/field-data/shares/:id', endpoint(async (container, { auth, params }) => {
    await auth.canOrReject('project.create', Project.species);
    await container.db.query(sql`
      update field_data_share_links set "revokedAt" = clock_timestamp()
      where id = ${params.id} and "revokedAt" is null
    `);
    return success();
  }));

  if (anonymousEndpoint != null) {
    // Public, tokenized, read-only report (aggregates only).
    service.get('/field-data/public/report/:token', anonymousEndpoint(async (container, { params }) => {
      const share = await container.maybeOne(sql`
        select id, "formIds" from field_data_share_links
        where token = ${params.token} and "revokedAt" is null
      `).then(getOrNotFound);
      return buildReport(container.db, share.formIds.length === 0 ? [-1] : share.formIds, { anonymizeTeam: true });
    }));
  }

  ////////////////////////////////////////////////////////////////////////////////
  // MEDIA LIBRARY
  service.get('/field-data/media', endpoint(async (container, { auth }) => {
    await auth.canOrReject('project.create', Project.species); // restrict to admin/managers
    return container.db.any(sql`select * from field_data_media order by "createdAt" desc`);
  }));

  service.post('/field-data/media', upload.single('file'), endpoint(async (container, { auth }, request) => {
    await auth.canOrReject('project.create', Project.species); // restrict to admin/managers
    const { file } = request; // populated by multer's upload.single middleware
    if (!file) throw new Error('No file uploaded.');

    const fileExt = path.extname(file.originalname).toLowerCase();
    let type = 'other';
    if (['.png', '.jpg', '.jpeg', '.gif', '.svg'].includes(fileExt)) type = 'image';
    else if (['.mp4', '.mov', '.avi', '.mkv'].includes(fileExt)) type = 'video';
    else if (['.mp3', '.wav', '.ogg', '.m4a'].includes(fileExt)) type = 'audio';

    const sizeStr = file.size > 1024 * 1024
      ? `${(file.size / (1024 * 1024)).toFixed(1)} MB`
      : `${(file.size / 1024).toFixed(0)} KB`;

    // Save metadata
    const record = await container.db.one(sql`
      insert into field_data_media (name, type, size)
      values (${file.originalname}, ${type}, ${sizeStr})
      returning *
    `);

    // Save to disk
    const targetPath = path.join(mediaDir, `${record.id}${fileExt}`);
    fs.writeFileSync(targetPath, file.buffer);

    return record;
  }));

  service.delete('/field-data/media/:id', endpoint(async (container, { params, auth }) => {
    await auth.canOrReject('project.create', Project.species);
    const record = await container.maybeOne(sql`
      select * from field_data_media where id = ${params.id}
    `).then(getOrNotFound);

    // Delete file from disk
    const files = fs.readdirSync(mediaDir);
    const targetFile = files.find(f => f.startsWith(`${record.id}.`));
    if (targetFile) {
      fs.unlinkSync(path.join(mediaDir, targetFile));
    }

    // Delete record from DB
    await container.db.query(sql`delete from field_data_media where id = ${params.id}`);
    return success();
  }));

  service.get('/field-data/media/download/:id', endpoint(async (container, { params, auth }, _, response) => {
    await auth.canOrReject('project.create', Project.species); // restrict to admin/managers
    const record = await container.maybeOne(sql`
      select * from field_data_media where id = ${params.id}
    `).then(getOrNotFound);

    const files = fs.readdirSync(mediaDir);
    const targetFile = files.find(f => f.startsWith(`${record.id}.`));
    if (!targetFile) throw new Error('File not found on disk.');

    // Set download headers and return a stream; the endpoint pipeline writes it
    // to the response. (Calling response.download directly and returning nothing
    // trips the endpoint's empty-response guard.)
    response.set('Content-Disposition', contentDisposition(record.name));
    response.set('Content-Type', 'application/octet-stream');
    return fs.createReadStream(path.join(mediaDir, targetFile));
  }));

  ////////////////////////////////////////////////////////////////////////////////
  // WEBHOOKS
  service.get('/field-data/webhooks', endpoint(async (container, { auth }) => {
    await auth.canOrReject('project.create', Project.species);
    return container.db.any(sql`select * from field_data_webhooks order by "createdAt" desc`);
  }));

  service.post('/field-data/webhooks', endpoint(async (container, { body, auth }) => {
    await auth.canOrReject('project.create', Project.species);
    if (body.name == null || body.name === '')
      throw Problem.user.unexpectedValue({ field: 'name', value: body.name, reason: 'is required' });
    validateWebhookUrl(body.url);
    // Generate a signing secret so receivers can verify the HMAC-SHA256
    // signature sent with each delivery (X-FieldData-Signature header).
    const secret = crypto.randomBytes(24).toString('hex');
    return container.db.one(sql`
      insert into field_data_webhooks (name, url, events, secret)
      values (${body.name}, ${body.url}, ${JSON.stringify(body.events || [])}, ${secret})
      returning *
    `);
  }));

  service.get('/field-data/webhooks/:id/deliveries', endpoint(async (container, { params, auth }) => {
    await auth.canOrReject('project.create', Project.species);
    return container.db.any(sql`
      select * from field_data_webhook_deliveries
      where "webhookId" = ${params.id}
      order by "createdAt" desc
      limit 50
    `);
  }));

  service.patch('/field-data/webhooks/:id', endpoint(async (container, { params, body, auth }) => {
    await auth.canOrReject('project.create', Project.species);
    const webhook = await container.maybeOne(sql`
      select * from field_data_webhooks where id = ${params.id}
    `).then(getOrNotFound);

    if (body.url !== undefined) validateWebhookUrl(body.url);

    const updated = {
      name: body.name !== undefined ? body.name : webhook.name,
      url: body.url !== undefined ? body.url : webhook.url,
      events: body.events !== undefined ? JSON.stringify(body.events) : JSON.stringify(webhook.events),
      active: body.active !== undefined ? body.active : webhook.active
    };

    return container.db.one(sql`
      update field_data_webhooks
      set name=${updated.name}, url=${updated.url}, events=${updated.events}, active=${updated.active}
      where id=${params.id}
      returning *
    `);
  }));

  service.delete('/field-data/webhooks/:id', endpoint(async (container, { params, auth }) => {
    await auth.canOrReject('project.create', Project.species);
    await container.db.query(sql`delete from field_data_webhooks where id = ${params.id}`);
    return success();
  }));

  ////////////////////////////////////////////////////////////////////////////////
  // BACKUPS
  service.get('/field-data/backups', endpoint(async (container, { auth }) => {
    await auth.canOrReject('project.create', Project.species); // restrict to admin/managers
    return container.db.any(sql`select * from field_data_backups order by date desc`);
  }));

  service.post('/field-data/backups', endpoint(async (container, { auth, body }) => {
    await auth.canOrReject('project.create', Project.species);

    const record = await container.db.one(sql`
      insert into field_data_backups (type, size, status, "statusColor")
      values ('Manual', 'Pending', 'Running', 'info')
      returning *
    `);

    // Run actual backup asynchronously
    (async () => {
      try {
        const passphrase = resolveBackupPassphrase(body.passphrase);
        const backupStream = await getEncryptedPgDumpStream(passphrase);
        const fileName = `manual-backup-${record.id}-${Date.now()}.pgdump.enc.bin`;
        const backupFilePath = path.join(backupsDir, fileName);

        const writeStream = fs.createWriteStream(backupFilePath);
        backupStream.pipe(writeStream);

        await new Promise((resolve, reject) => {
          writeStream.on('finish', resolve);
          writeStream.on('error', reject);
        });

        const stats = fs.statSync(backupFilePath);
        const sizeStr = stats.size > 1024 * 1024
          ? `${(stats.size / (1024 * 1024)).toFixed(1)} MB`
          : `${(stats.size / 1024).toFixed(0)} KB`;

        // Use the long-lived root container here: this runs after the request's
        // write transaction has already committed, so `container.db` (the request
        // transaction connection) is no longer usable.
        await rootContainer.db.query(sql`
          update field_data_backups
          set size=${sizeStr}, status='Success', "statusColor"='success'
          where id=${record.id}
        `);
      } catch (err) {
        process.stderr.write(`Field Data manual backup ${record.id} failed: ${err.message}\n`);
        await rootContainer.db.query(sql`
          update field_data_backups
          set size='0 KB', status='Failed', "statusColor"='danger'
          where id=${record.id}
        `);
      }
    })();

    return record;
  }));
};
