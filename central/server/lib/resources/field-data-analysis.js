// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { sql } = require('slonik');
const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { getOrNotFound } = require('../util/promise');
const Problem = require('../util/problem');
const { invalid, authorizeSource, normalizeAnalysis, analysisRows, analysisSummary, mapFeatures } = require('../util/analysis-data');
const { exportSelection } = require('../util/analysis-export');
const actorId = auth => auth.actor.map(a => a.id).orNull();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = (service, endpoint) => {
  service.post('/projects/:projectId/analysis/export/:format', endpoint(async (container, { params, auth, body }) => {
    const file = await exportSelection(container, params, auth, body);
    return (_, response) => { response.set('Cache-Control', 'private, no-store'); response.set('Content-Type', file.type); response.set('Content-Disposition', file.disposition); response.send(file.buffer); };
  }));
  const projectRead = async (container, projectId, auth) => {
    const project = await container.Projects.getById(projectId).then(getOrNotFound);
    await auth.canOrReject('project.read', project);
    await auth.canOrReject('submission.list', project);
    await auth.canOrReject('submission.read', project);
    return project;
  };
  service.get('/projects/:projectId/analysis/sources', endpoint(async (container, { params, auth }) => {
    const project = await projectRead(container, params.projectId, auth);
    const [forms, filtered, merged] = await Promise.all([
      container.db.any(sql`select f.id, coalesce(fd.name, f."xmlFormId") as name from forms f
        join form_defs fd on fd.id=f."currentDefId" where f."projectId"=${project.id} and f."deletedAt" is null order by name`),
      container.db.any(sql`select id, name from field_data_filtered_datasets where "projectId"=${project.id} order by name`),
      container.db.any(sql`select id, name from field_data_merged_datasets where "projectId"=${project.id} order by name`)
    ]);
    return { forms, filtered, merged };
  }));
  service.post('/projects/:projectId/analysis/query', endpoint(async (container, { params, auth, body }, _, response) => {
    const { source } = await authorizeSource(container, params.projectId, body?.source, auth);
    const definition = normalizeAnalysis(body, source);
    const limit = body?.limit == null ? 100 : Number(body.limit);
    const offset = body?.offset == null ? 0 : Number(body.offset);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500 || !Number.isSafeInteger(offset) || offset < 0)
      throw invalid('pagination', { limit, offset }, 'Use a limit from 1 to 500 and a nonnegative offset.');
    const summary = await analysisSummary(container.db, source, definition);
    const rows = await analysisRows(container.db, source, definition, limit, offset);
    response.set('Cache-Control', 'private, no-store');
    return { ...summary, definition, availableFields: source.fields.filter(f => !['structure', 'group', 'repeat'].includes(f.type) && !f.repeated), fields: source.fields.filter(f => definition.columns.includes(f.path)),
      rows, limit, offset, nextOffset: offset + rows.length < summary.total ? offset + rows.length : null,
      map: definition.geometry ? mapFeatures(rows, definition.geometry) : null,
      mapScope: 'current-page', sourceName: source.name };
  }));
  service.get('/projects/:projectId/analysis/views', endpoint(async (container, { params, auth }, _, response) => {
    const project = await projectRead(container, params.projectId, auth);
    response.set('Cache-Control', 'private, no-store');
    return container.db.any(sql`select id, title, definition, revision, "updatedAt" from field_data_analysis_views
      where "projectId"=${project.id} and "createdBy"=${actorId(auth)} order by "updatedAt" desc`);
  }));
  service.post('/projects/:projectId/analysis/views', endpoint(async (container, { params, auth, body }) => {
    const { source, project } = await authorizeSource(container, params.projectId, body?.definition?.source, auth);
    const definition = normalizeAnalysis(body.definition, source);
    const title = String(body.title || '').trim();
    if (!title || title.length > 255) throw invalid('title', body.title, 'Use a title of 1–255 characters.');
    const id = body.id || crypto.randomUUID();
    if (!UUID.test(id)) throw invalid('id', id, 'Use a stable UUID for retry.');
    const owner = actorId(auth);
    if (owner == null) throw Problem.user.insufficientRights();
    await container.db.query(sql`select pg_advisory_xact_lock(74133, hashtext(${id}))`);
    const existing = await container.db.maybeOne(sql`select * from field_data_analysis_views where id=${id}`);
    if (existing) {
      if (existing.createdBy !== owner || existing.projectId !== project.id || existing.title !== title
        || !isDeepStrictEqual(existing.definition, definition))
        throw invalid('id', id, 'This save identifier is already used.');
      return existing;
    }
    return container.db.one(sql`insert into field_data_analysis_views (id, "projectId", "createdBy", title, definition)
      values (${id}, ${project.id}, ${owner}, ${title}, ${JSON.stringify(definition)}) returning id, title, definition, revision`);
  }));
  service.delete('/projects/:projectId/analysis/views/:id', endpoint(async (container, { params, auth, headers }) => {
    const project = await projectRead(container, params.projectId, auth);
    if (!UUID.test(params.id)) throw Problem.user.notFound();
    const row = await container.db.maybeOne(sql`select revision from field_data_analysis_views
      where id=${params.id} and "projectId"=${project.id} and "createdBy"=${actorId(auth)}`);
    if (row == null) throw Problem.user.notFound();
    if (headers['if-match'] !== `"view-${row.revision}"`) throw invalid('If-Match', null, 'Reload the saved view before deleting it.');
    await container.db.query(sql`delete from field_data_analysis_views where id=${params.id} and "createdBy"=${actorId(auth)} and revision=${row.revision}`);
    return { success: true };
  }));
};
