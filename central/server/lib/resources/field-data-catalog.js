// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const crypto = require('node:crypto');
const { sql } = require('slonik');
const Problem = require('../util/problem');
const { getOrNotFound } = require('../util/promise');
const { authorizeSource, sourceRowsSql, invalid } = require('../util/analysis-data');
const { normalizePublication, suppressRelease, fingerprint } = require('../util/public-release');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const visits = new Map();
const rateLimit = (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  const now = Date.now(); const key = req.ip; let entry = visits.get(key);
  if (!entry && visits.size >= 1000) for (const [ip, v] of visits) if (now - v.start > 60000) visits.delete(ip);
  if (!entry && visits.size >= 1000) { res.set('Retry-After', '60').status(429).json({ message: 'Please retry in a minute.' }); return; }
  if (!entry || now - entry.start > 60000) { entry = { start: now, count: 0 }; visits.set(key, entry); }
  entry.count += 1;
  if (entry.count > 60) { res.set('Retry-After', '60').status(429).json({ message: 'Please retry in a minute.' }); return; }
  next();
};
const publicRecord = row => ({ id: row.id, ...row.metadata, publishedAt: row.publishedAt, release: row.release });
module.exports = (service, endpoint, anonymousEndpoint) => {
  const preview = async (c, params, auth, body) => {
    if (body?.source?.kind !== 'form') throw invalid('source', null, 'The public catalogue currently accepts published forms only.');
    const { project, source } = await authorizeSource(c, params.projectId, body.source, auth);
    await auth.canOrReject('project.update', project);
    if (body.kind === 'dataset') {
      const result = await require('../util/public-dataset-release').datasetRelease(c, source, body);
      return { ...result, hash: fingerprint(result), formId: source.forms[0].formId, projectId: project.id };
    }
    const config = normalizePublication(body);
    const field = source.fields.find(f => f.path === body.column);
    if (!field || field.repeated || field.type !== 'string' || field.selectMultiple) throw invalid('column', null, 'Choose a nonrepeating single-choice field.');
    const { refs, roots } = await c.db.one(sql`select xpath('//*[local-name()="select1"]/@ref', xml::xml)::text[] as refs, xpath('name((//*[local-name()="model"]/*[local-name()="instance"])[1]/*[1])', xml::xml)::text[] as roots from form_defs where id=${source.forms[0].currentDefId}`);
    if (!refs.some(ref => ref === `/${roots[0]}${field.path}`)) throw invalid('column', null, 'Only XLSForm single-choice questions can be released.');
    const rows = await c.db.any(sql`select extracted ->> ${field.path}::text as value, count(*)::integer as count from (${sourceRowsSql(source)}) selected group by 1`);
    const result = { metadata: config.metadata, release: suppressRelease(rows, config) };
    return { ...result, hash: fingerprint(result), formId: source.forms[0].formId, projectId: project.id };
  };
  service.post('/projects/:projectId/catalog/fields', endpoint(async (c, { params, auth, body }, _, response) => {
    if (body?.source?.kind !== 'form') throw invalid('source', null, 'Choose a form.');
    const { project, source } = await authorizeSource(c, params.projectId, body.source, auth); await auth.canOrReject('project.update', project);
    const form = source.forms[0]; response.set('Cache-Control', 'private, no-store');
    const fields = await c.db.any(sql`select ff.path, ff.name, ff.type, ff.binary, ff."selectMultiple" from form_fields ff join form_defs fd on fd.id=${form.currentDefId} and fd."schemaId"=ff."schemaId" where ff."formId"=${form.formId}`);
    return fields.filter(f => !['structure', 'group', 'repeat'].includes(f.type) && !f.path.startsWith('/meta/') && !source.repeatPaths.some(p => f.path.startsWith(`${p}/`)));
  }));
  service.post('/projects/:projectId/catalog/preview', endpoint(async (c, { params, auth, body }, _, response) => {
    response.set('Cache-Control', 'private, no-store'); const result = await preview(c, params, auth, body);
    return { metadata: result.metadata, release: result.release, hash: result.hash };
  }));
  service.post('/projects/:projectId/catalog/publish', endpoint(async (c, { params, auth, body }) => {
    const result = await preview(c, params, auth, body);
    if (body.previewHash !== result.hash || body.confirmPublication !== true) throw invalid('publication', null, 'Preview the current anonymous response and explicitly confirm publication.');
    if (result.release.suppressed) throw invalid('publication', null, 'The distribution does not meet disclosure thresholds.');
    const id = body.id || crypto.randomUUID(); if (!uuid.test(id)) throw invalid('id', null, 'Use a stable UUID.');
    const owner = auth.actor.map(a => a.id).orNull();
    await c.db.query(sql`select pg_advisory_xact_lock(74133, hashtext(${id}))`);
    const existing = await c.db.maybeOne(sql`select * from field_data_public_releases where id=${id}`);
    if (existing) { if (existing.createdBy !== owner || existing.projectId !== result.projectId || fingerprint({ metadata: existing.metadata, release: existing.release }) !== result.hash || !existing.published) throw invalid('id', null, 'This publication identifier is already used.'); return publicRecord(existing); }
    const row = await c.db.one(sql`insert into field_data_public_releases (id, "projectId", "formId", "createdBy", metadata, release, published, "publishedAt") values (${id}, ${result.projectId}, ${result.formId}, ${owner}, ${JSON.stringify(result.metadata)}, ${JSON.stringify(result.release)}, true, clock_timestamp()) returning *`);
    await c.db.query(sql`insert into field_data_public_release_audits ("releaseId", "actorId", action) values (${id}, ${owner}, 'published')`);
    return publicRecord(row);
  }));
  service.get('/projects/:projectId/catalog', endpoint(async (c, { params, auth }) => {
    const project = await c.Projects.getById(params.projectId).then(getOrNotFound); await auth.canOrReject('project.update', project);
    return c.db.any(sql`select id, metadata, published, "publishedAt", "revokedAt" from field_data_public_releases where "projectId"=${project.id} order by "publishedAt" desc limit 100`);
  }));
  service.delete('/projects/:projectId/catalog/:id', endpoint(async (c, { params, auth }) => {
    const project = await c.Projects.getById(params.projectId).then(getOrNotFound); await auth.canOrReject('project.update', project);
    if (!uuid.test(params.id)) throw Problem.user.notFound();
    const row = await c.db.maybeOne(sql`update field_data_public_releases set published=false, "revokedAt"=clock_timestamp() where id=${params.id} and "projectId"=${project.id} and published=true returning id`);
    if (!row) throw Problem.user.notFound();
    await c.db.query(sql`insert into field_data_public_release_audits ("releaseId", "actorId", action) values (${row.id}, ${auth.actor.map(a => a.id).orNull()}, 'revoked')`);
    return { success: true };
  }));
  const visible = sql`r.published=true and p."deletedAt" is null and f."deletedAt" is null and f."currentDefId" is not null`;
  service.get('/field-data/catalog/projects/:id', rateLimit, anonymousEndpoint(async (c, { params }, _, response) => {
    response.set('Cache-Control', 'no-store'); if (!uuid.test(params.id)) throw Problem.user.notFound();
    const seed = await c.db.maybeOne(sql`select r."projectId", r.metadata from field_data_public_releases r join projects p on p.id=r."projectId" join forms f on f.id=r."formId" where r.id=${params.id} and ${visible}`);
    if (!seed) throw Problem.user.notFound();
    const releases = await c.db.any(sql`select r.id, r.metadata, r."publishedAt" from field_data_public_releases r join projects p on p.id=r."projectId" join forms f on f.id=r."formId" where r."projectId"=${seed.projectId} and ${visible} order by r."publishedAt" desc limit 100`);
    return { title: seed.metadata.projectTitle || seed.metadata.title, description: seed.metadata.projectDescription || '', releases: releases.map(r => ({ id: r.id, ...r.metadata, publishedAt: r.publishedAt })) };
  }));
  service.get('/field-data/catalog', rateLimit, anonymousEndpoint(async (c, { query }, _, response) => {
    response.set('Cache-Control', 'no-store'); const term = String(query.q || '').slice(0, 100);
    const rows = await c.db.any(sql`select r.id, r.metadata, r."publishedAt" from field_data_public_releases r join projects p on p.id=r."projectId" join forms f on f.id=r."formId" where ${visible} and position(lower(${term}) in lower((r.metadata->>'title') || ' ' || (r.metadata->>'description'))) > 0 order by r."publishedAt" desc limit 50`);
    return rows.map(r => ({ id: r.id, ...r.metadata, publishedAt: r.publishedAt }));
  }));
  service.get('/field-data/catalog/:id', rateLimit, anonymousEndpoint(async (c, { params }, _, response) => {
    response.set('Cache-Control', 'no-store'); if (!uuid.test(params.id)) throw Problem.user.notFound();
    const row = await c.db.maybeOne(sql`select r.* from field_data_public_releases r join projects p on p.id=r."projectId" join forms f on f.id=r."formId" where r.id=${params.id} and ${visible}`);
    if (!row) throw Problem.user.notFound(); return publicRecord(row);
  }));
};
