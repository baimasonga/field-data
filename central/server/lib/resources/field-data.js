// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
// This resource adds custom API support for Field Data platform dashboard metrics,
// media library uploads, webhooks, and backup history tracking.

const { sql } = require('slonik');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { User, Project } = require('../model/frames');
const { getOrNotFound } = require('../util/promise');
const { success } = require('../util/http');
const { getEncryptedPgDumpStream } = require('../util/backup');

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

const upload = multer({ storage: multer.memoryStorage() });

// Resolve persistence directory for media library and manual backups
const storageBaseDir = fs.existsSync('/data') ? '/data' : path.join(__dirname, '../../..');
const mediaDir = path.join(storageBaseDir, 'field-data-media');
const backupsDir = path.join(storageBaseDir, 'field-data-backups');

// Ensure directories exist
if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });
if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });

module.exports = (service, endpoint) => {
  // Initialize Database tables on startup
  const db = service.get('container') ? service.get('container').db : null;
  if (db) {
    db.query(sql`
      CREATE TABLE IF NOT EXISTS field_data_media (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL,
        size VARCHAR(50) NOT NULL,
        "createdAt" TIMESTAMP DEFAULT clock_timestamp()
      );
      CREATE TABLE IF NOT EXISTS field_data_webhooks (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        url VARCHAR(255) NOT NULL,
        events JSONB NOT NULL,
        active BOOLEAN DEFAULT TRUE,
        "lastStatus" VARCHAR(50) DEFAULT 'Pending',
        "createdAt" TIMESTAMP DEFAULT clock_timestamp()
      );
      CREATE TABLE IF NOT EXISTS field_data_backups (
        id SERIAL PRIMARY KEY,
        date TIMESTAMP DEFAULT clock_timestamp(),
        type VARCHAR(50) NOT NULL,
        size VARCHAR(50) NOT NULL,
        status VARCHAR(50) NOT NULL,
        "statusColor" VARCHAR(50) NOT NULL
      );
    `).catch(err => console.error('Error creating Field Data tables:', err));
  }

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
    const recentSubmissions = await dbPool.all(sql`
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
    const trend = await dbPool.all(sql`
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
    const topForms = await dbPool.all(sql`
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
    } catch (e) {}

    let fileStorageStatus = false;
    try {
      const testFile = path.join(storageBaseDir, '.write-test');
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      fileStorageStatus = true;
    } catch (e) {}

    let enketoStatus = false;
    const enketoUrl = container.config.default.enketo.url;
    if (enketoUrl) {
      enketoStatus = await pingUrl(enketoUrl);
    }

    let pyxformStatus = false;
    const xlsConfig = container.config.default.xlsform;
    if (xlsConfig) {
      pyxformStatus = await pingUrl(`http://${xlsConfig.host}:${xlsConfig.port}/`);
    }

    let emailServiceStatus = false;
    try {
      const emailConfig = container.config.default.email;
      if (emailConfig && emailConfig.transport) emailServiceStatus = true;
    } catch (e) {}

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
  service.get('/field-data/media', endpoint(async (container) => {
    return container.db.all(sql`select * from field_data_media order by "createdAt" desc`);
  }));

  service.post('/field-data/media', upload.single('file'), endpoint(async (container, { file, auth }) => {
    await auth.canOrReject('project.create', Project.species); // restrict to admin/managers
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
    const record = await container.db.maybeOne(sql`
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

  service.get('/field-data/media/download/:id', endpoint(async (container, { params }, _, response) => {
    const record = await container.db.maybeOne(sql`
      select * from field_data_media where id = ${params.id}
    `).then(getOrNotFound);

    const files = fs.readdirSync(mediaDir);
    const targetFile = files.find(f => f.startsWith(`${record.id}.`));
    if (!targetFile) throw new Error('File not found on disk.');

    response.download(path.join(mediaDir, targetFile), record.name);
  }));

  ////////////////////////////////////////////////////////////////////////////////
  // WEBHOOKS
  service.get('/field-data/webhooks', endpoint(async (container) => {
    return container.db.all(sql`select * from field_data_webhooks order by "createdAt" desc`);
  }));

  service.post('/field-data/webhooks', endpoint(async (container, { body, auth }) => {
    await auth.canOrReject('project.create', Project.species);
    return container.db.one(sql`
      insert into field_data_webhooks (name, url, events)
      values (${body.name}, ${body.url}, ${JSON.stringify(body.events || [])})
      returning *
    `);
  }));

  service.patch('/field-data/webhooks/:id', endpoint(async (container, { params, body, auth }) => {
    await auth.canOrReject('project.create', Project.species);
    const webhook = await container.db.maybeOne(sql`
      select * from field_data_webhooks where id = ${params.id}
    `).then(getOrNotFound);

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
  service.get('/field-data/backups', endpoint(async (container) => {
    return container.db.all(sql`select * from field_data_backups order by date desc`);
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
        const passphrase = body.passphrase || 'field-data-default';
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
          ? `${(stats.size / (1024 * 1024)).toFixed(1)} GB`
          : `${(stats.size / 1024).toFixed(0)} KB`;

        await container.db.query(sql`
          update field_data_backups
          set size=${sizeStr}, status='Success', "statusColor"='success'
          where id=${record.id}
        `);
      } catch (err) {
        console.error('Backup failed:', err);
        await container.db.query(sql`
          update field_data_backups
          set size='0 KB', status='Failed', "statusColor"='danger'
          where id=${record.id}
        `);
      }
    })();

    return record;
  }));
};
