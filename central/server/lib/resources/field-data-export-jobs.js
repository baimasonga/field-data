// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { sql } = require('slonik');
const { prepareExport, exportRowsSql } = require('../util/analysis-export');
const { authorizeSource, invalid } = require('../util/analysis-data');
const { storage } = require('../external/field-data-storage');
const Problem = require('../util/problem');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const owner = auth => auth.actor.map(a => a.id).orNull();
const metadata = sql`id, status, total, completed, error, "createdAt", "expiresAt", request->>'format' as format`;
module.exports = (service, endpoint) => {
  const read = async (c, params, auth, validate = true) => {
    if (!uuid.test(params.id)) throw Problem.user.notFound();
    const job = await c.db.maybeOne(sql`select * from field_data_export_jobs where id=${params.id} and "projectId"=${Number(params.projectId)} and "createdBy"=${owner(auth)}`);
    if (!job) throw Problem.user.notFound();
    if (!validate) {
      const project = await c.Projects.getById(params.projectId).then(require('../util/promise').getOrNotFound);
      await auth.canOrReject('project.read', project); return job;
    }
    await authorizeSource(c, params.projectId, job.request.source, auth);
    if (new Date(job.expiresAt) <= new Date()) throw Problem.user.notFound();
    // Revalidate every selected field after source edits or permission revocation.
    const current = await prepareExport(c, { ...params, format: job.request.format }, auth, job.request);
    if (!isDeepStrictEqual(current.payload.boundary, job.payload.boundary)) throw invalid('source', null, 'Source access boundary changed. Remove this export and queue a new selection.');
    if (job.payload.fields.some(f => !current.fields.some(allowed => allowed.path === f.path && allowed.type === f.type))) throw Problem.user.insufficientRights();
    return job;
  };
  service.post('/projects/:projectId/analysis/jobs', endpoint(async (c, { params, auth, body }, _, response) => {
    response.set('Cache-Control', 'private, no-store');
    const prepared = await prepareExport(c, { ...params, format: body?.format }, auth, body);
    const id = body.id || crypto.randomUUID(); if (!uuid.test(id)) throw invalid('id', id, 'Use a UUID.');
    const request = { ...body, id: undefined, format: body.format, ...prepared.definition, includeRepeats: body.includeRepeats !== false };
    const normalized = JSON.parse(JSON.stringify(request));
    await c.db.query(sql`select pg_advisory_xact_lock(74135, ${owner(auth)})`);
    const existing = await c.db.maybeOne(sql`select * from field_data_export_jobs where id=${id}`);
    if (existing) {
      if (existing.createdBy !== owner(auth) || existing.projectId !== Number(params.projectId) || !isDeepStrictEqual(existing.request, normalized)) throw invalid('id', null, 'Save identifier already used.');
      return c.db.one(sql`select ${metadata} from field_data_export_jobs where id=${id}`);
    }
    const active = await c.db.oneFirst(sql`select count(*)::int from field_data_export_jobs where "createdBy"=${owner(auth)} and "expiresAt">clock_timestamp()`);
    if (active >= 10) throw invalid('jobs', null, 'Remove an export before creating more than ten retained jobs.');
    await c.db.query(sql`insert into field_data_export_jobs (id, "projectId", "createdBy", request, payload) values (${id}, ${Number(params.projectId)}, ${owner(auth)}, ${JSON.stringify(normalized)}, ${JSON.stringify(prepared.payload)})`);
    await c.db.query(sql`insert into field_data_export_rows ("jobId", row) select ${id}::uuid, jsonb_build_object('instanceId', r."instanceId", 'sourceForm', r."sourceForm", 'submittedAt', r."submittedAt", 'xml', r.xml, 'data', r.data, 'repeatIndex', r."repeatIndex") from (${exportRowsSql(prepared.source, prepared.definition, 100001)}) r`);
    const size = await c.db.one(sql`select count(*)::int as total, coalesce(sum(octet_length(coalesce(row->>'xml', row->>'data'))),0)::bigint as bytes from field_data_export_rows where "jobId"=${id}`);
    if (size.total > 100000 || size.bytes > 200 * 1024 * 1024) throw invalid('export', null, 'Queued export supports 100,000 submissions and 200 MB source XML. Add filters.');
    await c.db.query(sql`update field_data_export_jobs set total=${size.total} where id=${id}`);
    return c.db.one(sql`select ${metadata} from field_data_export_jobs where id=${id}`);
  }));
  service.get('/projects/:projectId/analysis/jobs', endpoint(async (c, { params, auth }, _, response) => {
    response.set('Cache-Control', 'private, no-store');
    const project = await c.Projects.getById(params.projectId).then(require('../util/promise').getOrNotFound);
    await auth.canOrReject('project.read', project);
    return c.db.any(sql`select ${metadata} from field_data_export_jobs where "projectId"=${project.id} and "createdBy"=${owner(auth)} and "expiresAt">clock_timestamp() order by "createdAt" desc`);
  }));
  service.get('/projects/:projectId/analysis/jobs/:id/download', endpoint(async (c, { params, auth }, _, response) => {
    const job = await read(c, params, auth); if (job.status !== 'Success') throw invalid('status', job.status, 'Wait for the export to finish.');
    response.set('Cache-Control', 'private, no-store'); response.set('Content-Type', 'application/zip'); response.set('Content-Disposition', `attachment; filename="analysis-${job.id}.zip"`);
    return storage.getStream(job.storageKey);
  }));
  service.delete('/projects/:projectId/analysis/jobs/:id', endpoint(async (c, { params, auth }) => {
    await read(c, params, auth, false);
    await c.db.query(sql`delete from field_data_export_jobs where id=${params.id}`);
    return { success: true };
  }));
};
