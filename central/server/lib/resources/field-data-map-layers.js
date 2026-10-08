// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const crypto = require('node:crypto');
const { sql } = require('slonik');
const { getOrNotFound } = require('../util/promise');
const Problem = require('../util/problem');
const { normalizeLayer, MAX_BYTES } = require('../util/map-layers');
const { invalid } = require('../util/analysis-data');
const { storage } = require('../external/field-data-storage');
module.exports = (service, endpoint) => {
  const access = async (c, p, auth, write = false) => {
    const project = await c.Projects.getById(p).then(getOrNotFound);
    await auth.canOrReject(write ? 'project.update' : 'project.read', project);
    return project;
  };
  const load = async row => {
    if (row.remoteConfig) { const { remoteConfig, storageKey, createdBy, ...safe } = row; return { ...safe, data: { type: 'FeatureCollection', features: [] } }; }
    const stream = await storage.getStream(row.storageKey); const chunks = []; let size = 0;
    try { for await (const chunk of stream) { size += chunk.length; if (size > MAX_BYTES) throw new Error('Layer exceeds limit.'); chunks.push(chunk); } } finally { stream.destroy(); }
    const { storageKey, remoteConfig, createdBy, ...safe } = row;
    return { ...safe, data: JSON.parse(Buffer.concat(chunks).toString()) };
  };
  service.post('/projects/:projectId/map-layers/remote', endpoint(async (c, { params, auth, body }) => {
    const p = await access(c, params.projectId, auth, true);
    await c.db.query(sql`select pg_advisory_xact_lock(74134, ${p.id})`);
    const count = await c.db.oneFirst(sql`select count(*)::integer from field_data_map_layers where "projectId"=${p.id}`);
    if (count >= 10) throw invalid('layers', null, 'A project supports at most ten layers.');
    const layer = await require('../util/remote-map').normalizeRemote(body); const id = crypto.randomUUID();
    await c.db.query(sql`insert into field_data_map_layers (id, "projectId", "createdBy", title, definition, "remoteConfig", position) values (${id}, ${p.id}, ${auth.actor.map(a => a.id).orNull()}, ${layer.title}, ${JSON.stringify(layer.definition)}, ${layer.remoteConfig}, ${count})`);
    return { id };
  }));
  service.get('/projects/:projectId/map-layers/:id/tile', endpoint(async (c, { params, auth, query }, _, response) => {
    const p = await access(c, params.projectId, auth);
    if (!/^[0-9a-f-]{36}$/i.test(params.id)) throw Problem.user.notFound();
    const row = await c.db.maybeOne(sql`select * from field_data_map_layers where id=${params.id} and "projectId"=${p.id}`);
    if (!row?.remoteConfig) throw Problem.user.notFound();
    response.set('Cache-Control', 'private, no-store');
    try { const tile = await require('../util/remote-map').remoteTile(row, query); response.set('Content-Type', tile.type); return tile.buffer; } catch { throw invalid('map', null, 'Remote map unavailable. Check the provider configuration or retry.'); }
  }));
  service.get('/projects/:projectId/map-layers', endpoint(async (c, { params, auth }, _, response) => {
    const p = await access(c, params.projectId, auth); response.set('Cache-Control', 'private, no-store');
    const rows = await c.db.any(sql`select * from field_data_map_layers where "projectId"=${p.id} order by position, id`);
    return Promise.all(rows.map(load));
  }));
  service.post('/projects/:projectId/map-layers', endpoint(async (c, { params, auth, body }) => {
    const p = await access(c, params.projectId, auth, true);
    await c.db.query(sql`select pg_advisory_xact_lock(74134, ${p.id})`);
    const count = await c.db.oneFirst(sql`select count(*)::integer from field_data_map_layers where "projectId"=${p.id}`);
    if (count >= 10) throw invalid('layers', null, 'A project supports at most 10 reference layers.');
    const layer = normalizeLayer(body); const id = crypto.randomUUID(); const key = `map-layers/${id}.json`;
    await storage.putBuffer(key, Buffer.from(JSON.stringify(layer.data)), { 'Content-Type': 'application/geo+json' });
    await c.db.query(sql`insert into field_data_map_layers (id, "projectId", "createdBy", title, definition, "storageKey", position)
      values (${id}, ${p.id}, ${auth.actor.map(a => a.id).orNull()}, ${layer.title}, ${JSON.stringify(layer.definition)}, ${key}, ${count})`);
    return { id };
  }));
  service.put('/projects/:projectId/map-layers/:id', endpoint(async (c, { params, auth, body, headers }) => {
    const p = await access(c, params.projectId, auth, true);
    await c.db.query(sql`select pg_advisory_xact_lock(74134, ${p.id})`);
    if (!/^[0-9a-f-]{36}$/i.test(params.id)) throw Problem.user.notFound();
    const row = await c.db.maybeOne(sql`select * from field_data_map_layers where id=${params.id} and "projectId"=${p.id} for update`);
    if (!row) throw Problem.user.notFound();
    if (headers['if-match'] !== `"layer-${row.revision}"`) throw invalid('If-Match', null, 'Reload the layer before changing it.');
    if (row.remoteConfig) {
      if (Object.keys(body).some(k => !['visible', 'position', 'title'].includes(k))) throw invalid('layer', null, 'Remove and recreate a remote connection to change its configuration.');
      if (body.position != null && (!Number.isSafeInteger(body.position) || body.position < 0 || body.position > 9)) throw invalid('position', null, 'Use a position from zero to nine.');
      let position = body.position ?? row.position;
      if (body.position != null) {
        const ordered = await c.db.any(sql`select id from field_data_map_layers where "projectId"=${p.id} order by position, id for update`);
        const ids = ordered.map(l => l.id).filter(id => id !== row.id); position = Math.min(position, ids.length); ids.splice(position, 0, row.id);
        for (let index = 0; index < ids.length; index += 1) {
          if (ids[index] !== row.id) {
            // eslint-disable-next-line no-await-in-loop
            await c.db.query(sql`update field_data_map_layers set position=${index}, revision=revision+1 where id=${ids[index]} and position<>${index}`);
          }
        }
      }
      const title = String(body.title ?? row.title).trim(); if (!title || title.length > 255) throw invalid('title', null, 'Use a title of 1–255 characters.');
      const definition = { ...row.definition, ...(body.visible == null ? {} : { visible: body.visible === true }) };
      await c.db.query(sql`update field_data_map_layers set title=${title}, definition=${JSON.stringify(definition)}, position=${position}, revision=revision+1, "updatedAt"=clock_timestamp() where id=${row.id}`);
      return { success: true };
    }
    const existing = await load(row); const layer = normalizeLayer({ ...existing.definition, title: row.title, ...body, data: body.data || existing.data, style: body.style || existing.definition.style });
    const key = `map-layers/${crypto.randomUUID()}.json`;
    let position = body.position == null ? row.position : Number(body.position);
    if (!Number.isSafeInteger(position) || position < 0 || position > 9) throw invalid('position', position, 'Use a position from 0 to 9.');
    if (body.position != null) {
      const ordered = await c.db.any(sql`select id, position from field_data_map_layers where "projectId"=${p.id} order by position, id for update`);
      const ids = ordered.map(l => l.id).filter(id => id !== row.id); position = Math.min(position, ids.length); ids.splice(position, 0, row.id);
      for (let index = 0; index < ids.length; index += 1) {
        if (ids[index] !== row.id) {
          // eslint-disable-next-line no-await-in-loop
          await c.db.query(sql`update field_data_map_layers set position=${index}, revision=revision+1 where id=${ids[index]} and position<>${index}`);
        }
      }
    }
    await storage.putBuffer(key, Buffer.from(JSON.stringify(layer.data)), { 'Content-Type': 'application/geo+json' });
    await c.db.query(sql`update field_data_map_layers set title=${layer.title}, definition=${JSON.stringify(layer.definition)}, "storageKey"=${key}, position=${position}, revision=revision+1, "updatedAt"=clock_timestamp() where id=${row.id}`);
    if (row.storageKey) await c.db.query(sql`insert into field_data_storage_cleanup (key) values (${row.storageKey}) on conflict do nothing`);
    return { success: true };
  }));
  service.delete('/projects/:projectId/map-layers/:id', endpoint(async (c, { params, auth, headers }) => {
    const p = await access(c, params.projectId, auth, true);
    await c.db.query(sql`select pg_advisory_xact_lock(74134, ${p.id})`);
    if (!/^[0-9a-f-]{36}$/i.test(params.id)) throw Problem.user.notFound();
    const row = await c.db.maybeOne(sql`select * from field_data_map_layers where id=${params.id} and "projectId"=${p.id} for update`);
    if (!row) throw Problem.user.notFound();
    if (headers['if-match'] !== `"layer-${row.revision}"`) throw invalid('If-Match', null, 'Reload the layer before deleting it.');
    await c.db.query(sql`delete from field_data_map_layers where id=${row.id}`);
    await c.db.query(sql`with ranked as (select id, row_number() over (order by position,id)-1 as position from field_data_map_layers where "projectId"=${p.id}) update field_data_map_layers l set position=ranked.position, revision=l.revision+1 from ranked where l.id=ranked.id and l.position<>ranked.position`);
    if (row.storageKey) await c.db.query(sql`insert into field_data_storage_cleanup (key) values (${row.storageKey}) on conflict do nothing`);
    return { success: true };
  }));
};
