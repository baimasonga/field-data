// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
//
// Project findings inbox (F3): docs/field-intelligence/F3-findings-inbox.md
//
// One list of integrity findings across the forms of a project that the caller
// may review. It reads what the checks recorded; it detects nothing, scores no
// one, and resolves nothing. A finding is resolved on its form's Verification
// page, beside its full evidence, so the list carries no evidence or answers.

const { sql } = require('slonik');
const { Form } = require('../model/frames');
const Problem = require('../util/problem');
const { getOrNotFound } = require('../util/promise');

const FAMILIES = ['travel', 'location', 'contradiction', 'identity'];
const STATUSES = ['open', 'investigating', 'resolved'];
const OUTCOMES = ['concern', 'inconclusive', 'withdrawn'];
const LOCATION_RULES = ['location-accuracy', 'outside-project-area', 'repeated-location'];
const PAGE = 50;
const US_UTC = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"';

const familyOf = sql`CASE
  WHEN i.rule = 'implausible-travel' THEN 'travel'
  WHEN i.rule = ANY(${sql.array(LOCATION_RULES, 'text')}) THEN 'location'
  WHEN i.rule LIKE 'contradiction:%' THEN 'contradiction'
  WHEN i.rule LIKE 'identity-reused:%' OR i.rule LIKE 'identity-inconsistent:%' THEN 'identity'
  ELSE 'other' END`;
// The same order as a form's own findings list: concerns first, then open
// before investigating before resolved, newest first.
const rank = sql`(CASE i.outcome WHEN 'concern' THEN 0 ELSE 3 END
  + CASE i.status WHEN 'open' THEN 0 WHEN 'investigating' THEN 1 ELSE 2 END)`;
const OPEN = sql`i.status IN ('open', 'investigating') AND i.outcome <> 'withdrawn'`;

const invalid = (field, value) => Problem.user.unexpectedValue({ field, value, reason: 'it is not one of the allowed values' });
const list = (value) => (value == null ? [] : (Array.isArray(value) ? value : [value]));

const scope = async (container, auth, params) => {
  if (!/^[1-9]\d*$/.test(params.projectId) || !Number.isSafeInteger(Number(params.projectId))) throw Problem.user.notFound();
  const project = await container.Projects.getById(Number(params.projectId)).then(getOrNotFound);
  await auth.canOrReject('project.read', project);
  return project;
};

// Forms in the project with findings that the caller may list and read
// submissions of. Resolved before querying, so pages are full and counts only
// describe what the caller may see.
const readableForms = async (container, auth, projectId) => {
  const forms = await container.db.any(sql`SELECT DISTINCT f.id, f."xmlFormId"
    FROM field_data_integrity_flags i JOIN forms f ON f.id = i."formId" AND f."deletedAt" IS NULL
    WHERE f."projectId" = ${projectId}`);
  const checked = await Promise.all(forms.map(async ({ id, xmlFormId }) => {
    const form = await container.Forms.getByProjectAndXmlFormId(projectId, xmlFormId, Form.WithoutDef, Form.WithoutXml);
    if (!form.isDefined()) return null;
    const allowed = await auth.can('submission.list', form.get()) && await auth.can('submission.read', form.get());
    return allowed ? id : null;
  }));
  return checked.filter((id) => id != null);
};

const present = (row) => ({
  id: row.id, xmlFormId: row.xmlFormId, formName: row.formName, rule: row.rule, family: row.family,
  ruleVersion: row.ruleVersion, instanceId: row.instanceId, relatedInstanceId: row.relatedInstanceId,
  outcome: row.outcome, status: row.status, decision: row.decision, note: row.note,
  decidedAt: row.decidedAt, decidedByName: row.decidedByName, createdAt: row.createdAt,
  // A rule's or key's title, so the row says which one; no other evidence.
  title: row.title, kind: row.kind
});

module.exports = (service, endpoint) => {
  const root = '/projects/:projectId/findings';

  service.get(root, endpoint(async (container, { auth, params, query }, request, response) => {
    await scope(container, auth, params);
    const projectId = Number(params.projectId);
    const statuses = list(query.status ?? ['open', 'investigating']);
    const outcomes = list(query.outcome ?? ['concern', 'inconclusive']);
    for (const s of statuses) if (!STATUSES.includes(s)) throw invalid('status', s);
    for (const o of outcomes) if (!OUTCOMES.includes(o)) throw invalid('outcome', o);
    if (query.family != null && !FAMILIES.includes(query.family)) throw invalid('family', query.family);
    if (query.xmlFormId != null && (typeof query.xmlFormId !== 'string' || query.xmlFormId.length > 255)) throw invalid('xmlFormId', query.xmlFormId);
    let cursor = null;
    if (query.cursor != null) {
      try {
        if (typeof query.cursor !== 'string' || query.cursor.length > 512) throw new Error();
        cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'));
        if (!Number.isInteger(cursor.rank) || cursor.rank < 0 || cursor.rank > 5 || !Number.isSafeInteger(cursor.id)
          || typeof cursor.at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(cursor.at)) throw new Error();
      } catch { throw invalid('cursor', query.cursor); }
    }
    response.set('Cache-Control', 'private, no-store');
    const formIds = await readableForms(container, auth, projectId);
    if (formIds.length === 0) return { items: [], nextCursor: null };
    const rows = await container.db.any(sql`
      SELECT i.*, f."xmlFormId", COALESCE(fd.name, f."xmlFormId") AS "formName", ${familyOf} AS family,
        i.evidence->>'title' AS title, i.evidence->>'kind' AS kind, actors."displayName" AS "decidedByName",
        ${rank} AS rank, to_char(i."createdAt" AT TIME ZONE 'UTC', ${US_UTC}) AS at
      FROM field_data_integrity_flags i
      JOIN forms f ON f.id = i."formId"
      LEFT JOIN form_defs fd ON fd.id = COALESCE(f."currentDefId", f."draftDefId")
      LEFT JOIN actors ON actors.id = i."decidedBy"
      WHERE i."formId" = ANY(${sql.array(formIds, 'int4')})
        AND i.status = ANY(${sql.array(statuses, 'text')}) AND i.outcome = ANY(${sql.array(outcomes, 'text')})
        ${query.family == null ? sql`` : sql`AND ${familyOf} = ${query.family}`}
        ${query.xmlFormId == null ? sql`` : sql`AND f."xmlFormId" = ${query.xmlFormId}`}
        ${cursor == null ? sql`` : sql`AND (${rank} > ${cursor.rank}
          OR (${rank} = ${cursor.rank} AND (i."createdAt", i.id) < (${cursor.at}::timestamptz, ${cursor.id})))`}
      ORDER BY ${rank}, i."createdAt" DESC, i.id DESC
      LIMIT ${PAGE + 1}`);
    const page = rows.slice(0, PAGE);
    const last = page[page.length - 1];
    return {
      items: page.map(present),
      nextCursor: rows.length > PAGE
        ? Buffer.from(JSON.stringify({ rank: last.rank, at: last.at, id: last.id })).toString('base64url') : null
    };
  }));

  // Open findings by family and by form: a current count, not a measure of anyone.
  service.get(`${root}/summary`, endpoint(async (container, { auth, params }, request, response) => {
    await scope(container, auth, params);
    response.set('Cache-Control', 'private, no-store');
    const formIds = await readableForms(container, auth, Number(params.projectId));
    const byFamily = Object.fromEntries(FAMILIES.map((f) => [f, 0]));
    if (formIds.length === 0) return { open: 0, byFamily, byForm: [] };
    const rows = await container.db.any(sql`
      SELECT f."xmlFormId", COALESCE(fd.name, f."xmlFormId") AS "formName", ${familyOf} AS family, count(*)::integer AS count
      FROM field_data_integrity_flags i
      JOIN forms f ON f.id = i."formId"
      LEFT JOIN form_defs fd ON fd.id = COALESCE(f."currentDefId", f."draftDefId")
      WHERE i."formId" = ANY(${sql.array(formIds, 'int4')}) AND ${OPEN}
      GROUP BY f."xmlFormId", fd.name, family`);
    const forms = new Map();
    for (const row of rows) {
      if (byFamily[row.family] != null) byFamily[row.family] += row.count;
      const entry = forms.get(row.xmlFormId) ?? { xmlFormId: row.xmlFormId, formName: row.formName, open: 0 };
      entry.open += row.count;
      forms.set(row.xmlFormId, entry);
    }
    return {
      open: rows.reduce((n, r) => n + r.count, 0),
      byFamily,
      byForm: [...forms.values()].sort((a, b) => b.open - a.open || a.formName.localeCompare(b.formName))
    };
  }));
};
