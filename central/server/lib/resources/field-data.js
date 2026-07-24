// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
// This resource adds custom API support for Field Data platform dashboard metrics,
// media library uploads, webhooks, and backup history tracking.

const { sql } = require('slonik');
const config = require('config');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const http = require('http');
const https = require('https');
const { User, Project } = require('../model/frames');
const Problem = require('../util/problem');
const { getOrNotFound, reject } = require('../util/promise');
const { success, contentDisposition } = require('../util/http');
const { getEncryptedPgDumpStream } = require('../util/backup');
const { storage, formatBytes } = require('../external/field-data-storage');
const { resolveWebhookUrl } = require('../util/safe-webhook-url');
const { encryptSecret } = require('../util/field-data-secret');

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

const uploadLimit = Number.parseInt(process.env.FIELD_DATA_UPLOAD_MAX_BYTES || '', 10) || 25 * 1024 * 1024;
const allowedMediaTypes = new Map([
  ['image/png', 'image'],
  ['image/jpeg', 'image'],
  ['image/gif', 'image'],
  ['image/svg+xml', 'image'],
  ['video/mp4', 'video'],
  ['video/quicktime', 'video'],
  ['audio/mpeg', 'audio'],
  ['audio/wav', 'audio'],
  ['audio/ogg', 'audio'],
  ['audio/mp4', 'audio'],
  ['application/pdf', 'document']
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: uploadLimit, files: 1, fields: 5 }
});
const uploadErrorHandler = (error, request, response, next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    next(Problem.user.requestTooLarge());
  } else if (error instanceof multer.MulterError) {
    next(Problem.user.multipartParsingFailed(error.message));
  } else {
    next(error);
  }
};

const publicWebhook = ({ secret, ...webhook }) => ({ ...webhook, hasSecret: Boolean(secret) });
const validWebhookUrl = async (url) => {
  try {
    await resolveWebhookUrl(url);
    return url;
  } catch (error) {
    return reject(Problem.user.unexpectedValue({
      field: 'url',
      value: url,
      reason: error.message
    }));
  }
};

module.exports = (service, endpoint) => {
  // The field_data_* tables backing these resources are created by the
  // 20260707-01-add-field-data-tables migration.

  ////////////////////////////////////////////////////////////////////////////////
  // DASHBOARD STATS
  service.get('/field-data/stats', endpoint(async (container, { auth }) => {
    const { Projects } = container;
    const dbPool = container.db;

    // Get projects the user has access to
    const projects = await Projects.getAllByAuth(auth);
    const projectIds = projects.map(p => p.id);

    if (projectIds.length === 0) {
      return {
        kpi: { projects: 0, forms: 0, submissions: 0, users: 0 },
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

    const isAdmin = await auth.can('user.list', User.species);

    // 1. KPI Counts
    const formsCount = await dbPool.oneFirst(sql`
      select count(*)::integer from forms 
      where "deletedAt" is null and "projectId" = ANY(${sql.array(projectIds, 'int4')})
    `);

    const submissionsCount = await dbPool.oneFirst(sql`
      select count(*)::integer from submissions 
      join forms on submissions."formId" = forms.id 
      where submissions."deletedAt" is null and submissions.draft = false 
        and forms."projectId" = ANY(${sql.array(projectIds, 'int4')})
    `);

    const usersCount = isAdmin
      ? await dbPool.oneFirst(sql`select count(*)::integer from users join actors on users."actorId" = actors.id where actors."deletedAt" is null`)
      : await dbPool.oneFirst(sql`select count(distinct "actorId")::integer from assignments where "acteeId" = ANY(${sql.array(projects.map(p => p.acteeId), 'text')})`);

    // 2. Recent Submissions
    const recentSubmissions = await dbPool.any(sql`
      select submissions.id, submissions."instanceId", submissions."createdAt",
             forms."xmlFormId" as form, forms.name as "formName",
             projects.name as project, actors."displayName" as submitter
      from submissions
      join forms on submissions."formId" = forms.id
      join projects on forms."projectId" = projects.id
      left join actors on submissions."submitterId" = actors.id
      where submissions."deletedAt" is null
        and submissions.draft = false
        and forms."projectId" = ANY(${sql.array(projectIds, 'int4')})
      order by submissions."createdAt" desc
      limit 5
    `);

    // 3. Submissions Trend (grouped by day)
    const trend = await dbPool.any(sql`
      select date_trunc('day', submissions."createdAt")::date as day, count(*)::integer as count
      from submissions
      join forms on submissions."formId" = forms.id
      where submissions."deletedAt" is null
        and submissions.draft = false
        and forms."projectId" = ANY(${sql.array(projectIds, 'int4')})
        and submissions."createdAt" >= now() - interval '7 days'
      group by day
      order by day asc
    `);

    // 4. Top Forms
    const topForms = await dbPool.any(sql`
      select forms."xmlFormId" as form, forms.name as name, count(submissions.id)::integer as count
      from submissions
      join forms on submissions."formId" = forms.id
      where submissions."deletedAt" is null
        and submissions.draft = false
        and forms."projectId" = ANY(${sql.array(projectIds, 'int4')})
      group by forms.id, forms."xmlFormId", forms.name
      order by count desc
      limit 5
    `);

    // 5. System Status Checkers
    let dbStatus = false;
    try {
      await dbPool.oneFirst(sql`select 1`);
      dbStatus = true;
    } catch (e) { /* status probe is best-effort */ }

    let fileStorageStatus = false;
    try {
      const testKey = `health/${crypto.randomUUID()}`;
      await storage.putBuffer(testKey, Buffer.from('ok'));
      await storage.delete(testKey);
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
      pyxformStatus = await pingUrl(`${xlsConfig.protocol || 'http'}://${xlsConfig.host}:${xlsConfig.port}/`);
    }

    let emailServiceStatus = false;
    const emailConfig = config.has('default.email') ? config.get('default.email') : null;
    if (emailConfig && emailConfig.transport) emailServiceStatus = true;

    return {
      kpi: {
        projects: projectIds.length,
        forms: formsCount,
        submissions: submissionsCount,
        users: usersCount
      },
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
  // MEDIA LIBRARY
  service.get('/field-data/media', endpoint(async (container, { auth }) => {
    await auth.canOrReject('project.create', Project.species);
    return container.db.any(sql`select * from field_data_media order by "createdAt" desc`);
  }));

  service.post('/field-data/media', upload.single('file'), uploadErrorHandler,
    endpoint(async (container, { auth }, request) => {
      await auth.canOrReject('project.create', Project.species); // restrict to admin/managers
      const { file } = request; // populated by multer's upload.single middleware
      if (!file) return reject(Problem.user.missingMultipartField({ field: 'file' }));
      const type = allowedMediaTypes.get(file.mimetype);
      if (type == null) {
        return reject(Problem.user.unexpectedValue({
          field: 'file',
          value: file.mimetype,
          reason: 'unsupported media type'
        }));
      }

      const fileExt = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '');
      const storageKey = `media/${crypto.randomUUID()}${fileExt}`;
      await storage.putBuffer(storageKey, file.buffer, { 'Content-Type': file.mimetype });
      try {
        return await container.db.one(sql`
        insert into field_data_media (name, type, size, "sizeBytes", "mimeType", "storageKey")
        values (${path.basename(file.originalname)}, ${type}, ${formatBytes(file.size)},
          ${file.size}, ${file.mimetype}, ${storageKey})
        returning *
      `);
      } catch (error) {
        await storage.delete(storageKey);
        throw error;
      }
    }));

  service.delete('/field-data/media/:id', endpoint(async (container, { params, auth }) => {
    await auth.canOrReject('project.create', Project.species);
    const record = await container.maybeOne(sql`
      select * from field_data_media where id = ${params.id}
    `).then(getOrNotFound);

    if (record.storageKey) await storage.delete(record.storageKey);
    await container.db.query(sql`delete from field_data_media where id = ${params.id}`);
    return success();
  }));

  service.get('/field-data/media/download/:id', endpoint(async (container, { params, auth }, _, response) => {
    await auth.canOrReject('project.create', Project.species);
    const record = await container.maybeOne(sql`
      select * from field_data_media where id = ${params.id}
    `).then(getOrNotFound);
    if (!record.storageKey) return reject(Problem.user.notFound());

    response.set('Content-Disposition', contentDisposition(record.name));
    response.set('Content-Type', record.mimeType || 'application/octet-stream');
    return storage.getStream(record.storageKey);
  }));

  ////////////////////////////////////////////////////////////////////////////////
  // WEBHOOKS
  service.get('/field-data/webhooks', endpoint(async (container, { auth }) => {
    await auth.canOrReject('project.create', Project.species);
    const webhooks = await container.db.any(sql`
      select id, name, url, events, active, "lastStatus", "createdAt",
        (secret is not null and secret <> '') as "hasSecret"
      from field_data_webhooks order by "createdAt" desc`);
    return webhooks;
  }));

  service.post('/field-data/webhooks', endpoint(async (container, { body, auth }) => {
    await auth.canOrReject('project.create', Project.species);
    if (!body.name) return reject(Problem.user.missingParameter({ field: 'name' }));
    if (!body.url) return reject(Problem.user.missingParameter({ field: 'url' }));
    await validWebhookUrl(body.url);
    // Generate a signing secret so receivers can verify the HMAC-SHA256
    // signature sent with each delivery (X-FieldData-Signature header).
    const secret = crypto.randomBytes(24).toString('hex');
    const created = await container.db.one(sql`
      insert into field_data_webhooks (name, url, events, secret)
      values (${body.name}, ${body.url}, ${JSON.stringify(body.events || [])}, ${encryptSecret(secret)})
      returning *
    `);
    return { ...publicWebhook(created), secret };
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

    const updated = {
      name: body.name !== undefined ? body.name : webhook.name,
      url: body.url !== undefined ? body.url : webhook.url,
      events: body.events !== undefined ? JSON.stringify(body.events) : JSON.stringify(webhook.events),
      active: body.active !== undefined ? body.active : webhook.active
    };
    await validWebhookUrl(updated.url);

    const result = await container.db.one(sql`
      update field_data_webhooks
      set name=${updated.name}, url=${updated.url}, events=${updated.events}, active=${updated.active}
      where id=${params.id}
      returning *
    `);
    return publicWebhook(result);
  }));

  service.post('/field-data/webhooks/:id/rotate-secret', endpoint(async (container, { params, auth }) => {
    await auth.canOrReject('project.create', Project.species);
    const secret = crypto.randomBytes(24).toString('hex');
    const result = await container.maybeOne(sql`
      update field_data_webhooks set secret=${encryptSecret(secret)}
      where id=${params.id} returning *
    `).then(getOrNotFound);
    return { ...publicWebhook(result), secret };
  }));

  service.delete('/field-data/webhooks/:id', endpoint(async (container, { params, auth }) => {
    await auth.canOrReject('project.create', Project.species);
    await container.db.query(sql`delete from field_data_webhooks where id = ${params.id}`);
    return success();
  }));

  ////////////////////////////////////////////////////////////////////////////////
  // BACKUPS
  service.get('/field-data/backups', endpoint(async (container, { auth }) => {
    await auth.canOrReject('project.create', Project.species);
    return container.db.any(sql`
      select id, date, type, size, status, "statusColor", "sizeBytes", error, "completedAt",
        ("storageKey" is not null) as downloadable
      from field_data_backups order by date desc`);
  }));

  service.post('/field-data/backups', endpoint(async (container, { auth, body }) => {
    await auth.canOrReject('project.create', Project.species);

    const record = await container.db.one(sql`
      insert into field_data_backups (type, size, status, "statusColor")
      values ('Manual', 'Pending', 'Running', 'info')
      returning *
    `);

    const passphrase = process.env.FIELD_DATA_BACKUP_PASSPHRASE || body.passphrase;
    if (typeof passphrase !== 'string' || passphrase.length < 16) {
      await container.db.query(sql`delete from field_data_backups where id=${record.id}`);
      return reject(Problem.user.unexpectedValue({
        field: 'passphrase',
        value: '[redacted]',
        reason: 'set FIELD_DATA_BACKUP_PASSPHRASE to at least 16 characters'
      }));
    }

    const storageKey = `backups/manual-backup-${record.id}-${Date.now()}.pgdump.enc.bin`;
    try {
      const backupStream = await getEncryptedPgDumpStream(passphrase);
      const sizeBytes = await storage.putStream(storageKey, backupStream, {
        'Content-Type': 'application/octet-stream'
      });
      return await container.db.one(sql`
        update field_data_backups
        set size=${formatBytes(sizeBytes)}, "sizeBytes"=${sizeBytes}, "storageKey"=${storageKey},
          status='Success', "statusColor"='success', "completedAt"=clock_timestamp()
        where id=${record.id}
        returning id, date, type, size, status, "statusColor", "sizeBytes", error, "completedAt",
          true as downloadable
      `);
    } catch (err) {
      process.stderr.write(`Field Data manual backup ${record.id} failed: ${err.message}\n`);
      await container.db.query(sql`
        update field_data_backups
        set size='0 KB', status='Failed', "statusColor"='danger',
          error=${String(err.message).slice(0, 1000)}, "completedAt"=clock_timestamp()
        where id=${record.id}
      `);
      throw err;
    }
  }));

  service.get('/field-data/backups/:id/download', endpoint(async (container, { params, auth }, _, response) => {
    await auth.canOrReject('project.create', Project.species);
    const record = await container.maybeOne(sql`
      select * from field_data_backups where id=${params.id}
    `).then(getOrNotFound);
    if (!record.storageKey || record.status !== 'Success') return reject(Problem.user.notFound());
    response.set('Content-Disposition', contentDisposition(`field-data-backup-${record.id}.pgdump.enc.bin`));
    response.set('Content-Type', 'application/octet-stream');
    return storage.getStream(record.storageKey);
  }));
};
