// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
/* eslint-disable no-await-in-loop */
const { randomUUID, sign, timingSafeEqual } = require('node:crypto');
const { sql } = require('slonik');
const Option = require('../util/option');
const Problem = require('../util/problem');
const { UUID_PATTERN } = require('../util/claim-versioning');
const courier = require('../util/media-couriers');
const transfer = require('../util/media-upload-transfer');
const target = require('../util/media-upload-target');
const invalid = reason => courier.invalid(reason);
const conflict = () => Problem.user.mediaUploadConflict();
const actorFor = auth => { const actor = auth.actor.orNull(); if (actor?.type !== 'field_key') throw Problem.user.insufficientRights(); return actor; };
const attest = (settings, kind, details) => {
  const bytes = Buffer.from(JSON.stringify({ ...details, purpose: `field-data.media-background-${kind}@1`, issuer: settings.origin }));
  return { algorithm: 'ES256', keyId: settings.keyId, publicKey: settings.publicKey, payload: bytes.toString('base64url'), signature: sign('sha256', bytes, { key: settings.key, dsaEncoding: 'ieee-p1363' }).toString('base64url') };
};
const get = async (tx, id, lock = false) => {
  if (!UUID_PATTERN.test(id ?? '')) throw Problem.user.notFound();
  const row = await tx.db.maybeOne(sql`SELECT * FROM field_data_media_background WHERE id=${id} ${lock ? sql`FOR UPDATE` : sql``}`);
  if (!row) throw Problem.user.notFound(); return row;
};
const active = (tx, id) => tx.db.oneFirst(sql`SELECT EXISTS(SELECT 1 FROM field_data_media_background a WHERE a.id=${id} AND a."expiresAt">clock_timestamp() AND NOT EXISTS(SELECT 1 FROM field_data_media_background_events e WHERE e."authorizationId"=a.id AND e.kind='revoke'))`);
const proof = async (tx, row) => {
  const events = await tx.db.any(sql`SELECT * FROM field_data_media_background_events WHERE "authorizationId"=${row.id} ORDER BY kind`);
  const delivered = events.find(event => event.kind === 'delivery'); let sourceAvailable = null;
  if (delivered) {
    try { await target(tx, { id: row.ownerId }, row.manifest, { projectId: row.projectId, submissionDefId: row.submissionDefId, status: 'completed', blobId: delivered.details.blobId }); sourceAvailable = true; } catch (error) { if (![404, 409].includes(error.httpCode)) throw error; sourceAvailable = false; }
  }
  const grant = row.courierGrantId ? await courier.grantFor(tx, row.uploadId) : null;
  const custody = grant ? { grant, events: await tx.db.any(sql`SELECT * FROM field_data_media_courier_events WHERE "grantId"=${grant.id} ORDER BY kind`) } : null;
  return { authorization: row, events, ...(custody ? { courier: custody } : {}), sourceAvailable, checkedAt: new Date().toISOString() };
};
const live = async (tx, row) => {
  if (!await active(tx, row.id) || !await courier.account(tx, row.senderId, row.projectId)) throw Problem.user.notFound();
  const upload = await transfer.load(tx, { id: row.senderId }, row.uploadId);
  if (upload.actorId !== row.ownerId || upload.projectId !== row.projectId || upload.submissionDefId !== row.submissionDefId || JSON.stringify(upload.manifest) !== JSON.stringify(row.manifest) || upload.manifest.challengeId != null) throw Problem.user.notFound();
  if (row.courierGrantId && (await courier.grantFor(tx, row.uploadId))?.id !== row.courierGrantId) throw Problem.user.notFound();
  return upload;
};
const visits = new Map();
const limit = (id, response) => {
  const now = Date.now(); let entry = visits.get(id);
  if (!entry || now - entry.at >= 60000) { if (visits.size >= 1000) visits.delete(visits.keys().next().value); entry = { at: now, count: 0 }; visits.set(id, entry); }
  entry.count += 1; if (entry.count > 240) { response.status(429).set('Retry-After', '60'); return false; } return true;
};
module.exports = (service, endpoint, anonymousEndpoint) => {
  const root = '/field-data/app-user/media-background';
  service.post(root, endpoint(async (c, { auth, body }, _, response) => {
    const actor = actorFor(auth);
    if (!body || Object.keys(body).length !== 4 || !UUID_PATTERN.test(body.id ?? '') || !UUID_PATTERN.test(body.uploadId ?? '') || !/^[a-f0-9]{64}$/.test(body.tokenHash ?? '') || typeof body.expiresAt !== 'string' || !Number.isFinite(Date.parse(body.expiresAt)) || new Date(body.expiresAt).toISOString() !== body.expiresAt) throw invalid('Provide authorization and transfer UUIDs, token hash and expiry.');
    const result = await c.transacting(async tx => {
      const upload = await transfer.load(tx, actor, body.uploadId);
      if (!await courier.account(tx, actor.id, upload.projectId) || upload.manifest.challengeId != null) throw Problem.user.notFound();
      await tx.db.query(sql`SELECT pg_advisory_xact_lock(74165,${upload.projectId})`);
      const requestHash = courier.digest(JSON.stringify({ uploadId: body.uploadId, tokenHash: body.tokenHash, expiresAt: body.expiresAt }));
      const replay = await tx.db.maybeOne(sql`SELECT * FROM field_data_media_background WHERE id=${body.id}`);
      if (replay) { if (replay.senderId !== actor.id) throw Problem.user.notFound(); if (replay.requestHash !== requestHash) throw conflict(); return proof(tx, replay); }
      if (upload.status !== 'pending') throw conflict();
      const grant = actor.id !== upload.actorId ? await courier.grantFor(tx, upload.id) : null;
      const settings = courier.config(); if (!settings || (grant && JSON.parse(Buffer.from(grant.attestation.payload, 'base64url')).issuer !== settings.origin)) throw invalid('Background signing is unavailable or changed.');
      const { at } = await tx.db.one(sql`SELECT clock_timestamp() AS at`); const now = new Date(at).getTime();
      if (Date.parse(body.expiresAt) <= now || Date.parse(body.expiresAt) - now > 86400000 || Date.parse(body.expiresAt) > new Date(upload.expiresAt).getTime() || (grant && Date.parse(body.expiresAt) > new Date(grant.expiresAt).getTime())) throw invalid('Expiry must be within 24 hours and the transfer/courier deadline.');
      if (await tx.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_media_background WHERE "projectId"=${upload.projectId}`) >= 1000 || await tx.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_media_background WHERE "uploadId"=${upload.id}`) >= 20) throw conflict();
      if (await tx.db.oneFirst(sql`SELECT EXISTS(SELECT 1 FROM field_data_media_background a WHERE a."uploadId"=${upload.id} AND a."expiresAt">clock_timestamp() AND NOT EXISTS(SELECT 1 FROM field_data_media_background_events e WHERE e."authorizationId"=a.id AND e.kind='revoke'))`)) throw conflict();
      const details = { id: body.id, uploadId: upload.id, ownerId: upload.actorId, senderId: actor.id, projectId: upload.projectId, submissionDefId: upload.submissionDefId, manifest: upload.manifest, tokenHash: body.tokenHash, issuedAt: new Date(at).toISOString(), expiresAt: body.expiresAt, ...(grant ? { courierGrantId: grant.id, courierGrantPayloadHash: courier.digest(Buffer.from(grant.attestation.payload, 'base64url')) } : {}) };
      const row = await tx.db.one(sql`INSERT INTO field_data_media_background(id,"uploadId","ownerId","senderId","projectId","submissionDefId",manifest,"courierGrantId","tokenHash","requestHash","expiresAt",attestation) VALUES(${body.id},${upload.id},${upload.actorId},${actor.id},${upload.projectId},${upload.submissionDefId},${JSON.stringify(upload.manifest)},${grant?.id ?? null},${body.tokenHash},${requestHash},${body.expiresAt},${JSON.stringify(attest(settings, 'authorization', details))}) RETURNING *`);
      await tx.Audits.log(auth.actor, 'field_data.media.background.authorize', null, { authorizationId: row.id, uploadId: row.uploadId, ownerId: row.ownerId, senderId: row.senderId, projectId: row.projectId }); return proof(tx, row);
    }); response.set('Cache-Control', 'private, no-store'); return result;
  }));
  service.get(root, endpoint(async (c, { auth }, _, response) => {
    const actor = actorFor(auth); const items = await c.transacting(async tx => {
      const rows = await tx.db.any(sql`SELECT * FROM field_data_media_background WHERE "ownerId"=${actor.id} OR "senderId"=${actor.id} ORDER BY "expiresAt" DESC,id DESC LIMIT 50`); const results = [];
      for (const row of rows) if (await courier.account(tx, actor.id, row.projectId)) results.push(await proof(tx, row)); return results;
    }); response.set('Cache-Control', 'private, no-store'); return { items };
  }));
  service.get(`${root}/:id`, endpoint(async (c, { auth, params }, _, response) => {
    const actor = actorFor(auth); const result = await c.transacting(async tx => { const row = await get(tx, params.id); if (![row.ownerId, row.senderId].includes(actor.id) || !await courier.account(tx, actor.id, row.projectId)) throw Problem.user.notFound(); return proof(tx, row); }); response.set('Cache-Control', 'private, no-store'); return result;
  }));
  service.post(`${root}/:id/revoke`, endpoint(async (c, { auth, params, body }, _, response) => {
    const actor = actorFor(auth);
    if (!body || Object.keys(body).length !== 2 || !UUID_PATTERN.test(body.requestId ?? '') || typeof body.reason !== 'string' || body.reason.trim().length < 10 || body.reason.length > 2000) throw invalid('Provide request UUID and a 10–2000 character reason.');
    const result = await c.transacting(async tx => {
      const row = await get(tx, params.id, true); if (![row.ownerId, row.senderId].includes(actor.id) || !await courier.account(tx, actor.id, row.projectId)) throw Problem.user.notFound();
      const requestHash = courier.digest(body.reason); const previous = await tx.db.maybeOne(sql`SELECT * FROM field_data_media_background_events WHERE "authorizationId"=${row.id} AND kind='revoke'`);
      if (previous) { if (previous.requestId !== body.requestId || previous.requestHash !== requestHash) throw conflict(); return { event: previous }; }
      const { at } = await tx.db.one(sql`SELECT clock_timestamp() AS at`); const settings = courier.config();
      const details = { authorizationId: row.id, uploadId: row.uploadId, projectId: row.projectId, ownerId: row.ownerId, senderId: row.senderId, revokedBy: actor.id, revokedAt: new Date(at).toISOString(), reason: body.reason, authorizationPayloadHash: courier.digest(Buffer.from(row.attestation.payload, 'base64url')) };
      const event = await tx.db.one(sql`INSERT INTO field_data_media_background_events(id,"authorizationId",kind,"requestId","requestHash",details,attestation) VALUES(${randomUUID()},${row.id},'revoke',${body.requestId},${requestHash},${JSON.stringify(details)},${settings ? JSON.stringify(attest(settings, 'revoke', details)) : null}) RETURNING *`);
      await tx.Audits.log(auth.actor, 'field_data.media.background.revoke', null, { authorizationId: row.id, projectId: row.projectId }); return { event };
    }); response.set('Cache-Control', 'private, no-store'); return result;
  }));
  const capability = (kind, handler) => anonymousEndpoint(async (c, { params, headers }, request, response) => {
    const token = headers['x-field-data-delivery-token'];
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token) || Buffer.from(token, 'base64url').toString('base64url') !== token) throw Problem.user.notFound();
    const initial = await get(c, params.id); if (!timingSafeEqual(Buffer.from(courier.digest(token), 'hex'), Buffer.from(initial.tokenHash, 'hex'))) throw Problem.user.notFound();
    if (!limit(initial.id, response)) return { message: 'Please retry in one minute.' };
    const bytes = kind === 'chunk' ? await transfer.chunkBytes(request) : null;
    const result = await c.transacting(async tx => {
      if (kind === 'complete') await tx.db.query(sql`SELECT pg_advisory_xact_lock(74145)`);
      const row = await get(tx, params.id, true); const upload = await live(tx, row);
      const settings = courier.config(); if (!settings || JSON.parse(Buffer.from(row.attestation.payload, 'base64url')).issuer !== settings.origin) throw invalid('Background signing is unavailable or changed.');
      const value = await handler(tx, row, upload, bytes, params, headers, settings);
      const { at } = await tx.db.one(sql`SELECT clock_timestamp() AS at`); if (new Date(at).getTime() >= new Date(row.expiresAt).getTime()) throw Problem.user.notFound(); return value;
    }); response.set('Cache-Control', 'no-store'); return result;
  });
  service.get(`${root}/:id/progress`, capability('progress', async (tx, row, upload) => ({ transfer: transfer.present(upload), proof: await proof(tx, row) })));
  service.put(`${root}/:id/chunks/:offset`, capability('chunk', async (tx, row, upload, bytes, params, headers) => {
    if (!/^(0|[1-9]\d{0,8})$/.test(params.offset) || !/^[a-f0-9]{64}$/.test(headers['x-chunk-sha256'] ?? '') || courier.digest(bytes) !== headers['x-chunk-sha256']) throw invalid('Invalid media chunk.');
    return transfer.putChunk(tx, { id: row.senderId }, upload.id, Number(params.offset), bytes, headers['x-chunk-sha256']);
  }));
  service.post(`${root}/:id/complete`, capability('complete', async (tx, row, upload, bytes, params, headers, settings) => {
    const authorizationPayloadHash = courier.digest(Buffer.from(row.attestation.payload, 'base64url')); const transport = { transport: 'background-capability', backgroundAuthorizationId: row.id, backgroundAuthorizationPayloadHash: authorizationPayloadHash };
    await transfer.complete(tx, { id: row.senderId }, upload.id, Option.none(), transport);
    if (!await tx.db.oneFirst(sql`SELECT EXISTS(SELECT 1 FROM field_data_media_background_events WHERE "authorizationId"=${row.id} AND kind='delivery')`)) {
      const stored = await tx.db.one(sql`SELECT "blobId" FROM field_data_media_uploads WHERE id=${upload.id}`); const { at } = await tx.db.one(sql`SELECT clock_timestamp() AS at`);
      const details = { authorizationId: row.id, uploadId: row.uploadId, projectId: row.projectId, submissionDefId: row.submissionDefId, ownerId: row.ownerId, senderId: row.senderId, receivedBy: row.senderId, sha256: row.manifest.sha256, size: row.manifest.size, blobId: stored.blobId, transport: 'background-capability', alreadyReceived: upload.status === 'completed', receivedAt: new Date(at).toISOString(), authorizationPayloadHash };
      await tx.db.query(sql`INSERT INTO field_data_media_background_events(id,"authorizationId",kind,"requestId","requestHash",details,attestation) VALUES(${randomUUID()},${row.id},'delivery',${randomUUID()},${row.manifest.sha256},${JSON.stringify(details)},${JSON.stringify(attest(settings, 'delivery', details))})`);
      await tx.Audits.log(Option.none(), 'field_data.media.background.delivery', null, details);
    } return proof(tx, row);
  }));
};
