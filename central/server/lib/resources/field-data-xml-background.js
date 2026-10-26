// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { randomUUID, sign, timingSafeEqual } = require('node:crypto');
const { sql } = require('slonik');
const { Form } = require('../model/frames');
const Option = require('../util/option');
const Problem = require('../util/problem');
const { UUID_PATTERN } = require('../util/claim-versioning');
const xml = require('../util/xml-couriers');
const delivery = require('../util/xml-delivery');
const conflict = () => Problem.user.mediaUploadConflict();
const actorFor = auth => { const actor = auth.actor.orNull(); if (actor?.type !== 'field_key') throw Problem.user.insufficientRights(); return actor; };
const attest = (settings, kind, details) => {
  const bytes = Buffer.from(JSON.stringify({ ...details, purpose: `field-data.xml-background-${kind}@1`, issuer: settings.origin }));
  return { algorithm: 'ES256', keyId: settings.keyId, publicKey: settings.publicKey, payload: bytes.toString('base64url'), signature: sign('sha256', bytes, { key: settings.key, dsaEncoding: 'ieee-p1363' }).toString('base64url') };
};
const get = async (tx, id, lock = false) => {
  if (!UUID_PATTERN.test(id ?? '')) throw Problem.user.notFound();
  const ref = await tx.db.maybeOne(sql`SELECT "targetId" FROM field_data_xml_background WHERE id=${id}`); if (!ref) throw Problem.user.notFound();
  const target = await tx.db.one(sql`SELECT * FROM field_data_xml_courier_targets WHERE id=${ref.targetId} ${lock ? sql`FOR UPDATE` : sql``}`);
  const authorization = await tx.db.one(sql`SELECT * FROM field_data_xml_background WHERE id=${id} ${lock ? sql`FOR UPDATE` : sql``}`);
  return { target, authorization };
};
const active = (tx, id) => tx.db.oneFirst(sql`SELECT EXISTS(SELECT 1 FROM field_data_xml_background a WHERE a.id=${id} AND a."expiresAt">clock_timestamp()
 AND NOT EXISTS(SELECT 1 FROM field_data_xml_background_events e WHERE e."authorizationId"=a.id AND e.kind='revoke'))`);
const proof = async (tx, target, authorization) => {
  const events = await tx.db.any(sql`SELECT * FROM field_data_xml_background_events WHERE "authorizationId"=${authorization.id} ORDER BY kind`);
  const received = events.find(event => event.kind === 'delivery'); let sourceAvailable = null;
  if (received) {
    const source = await tx.db.maybeOne(sql`SELECT sd.xml FROM submission_defs sd JOIN submissions s ON s.id=sd."submissionId"
      WHERE sd.id=${received.details.submissionDefId} AND sd.current AND (sd.root OR ${Boolean(target.manifest.deprecatedId)}) AND s."deletedAt" IS NULL AND sd."submitterId"=${target.ownerId}`);
    sourceAvailable = source != null && xml.digest(source.xml) === target.manifest.sha256;
  }
  return { target, authorization, events, sourceAvailable, checkedAt: new Date().toISOString(), limitations: 'An exact-file browser delivery authorization; no proof of account presence, physical custody or absence of later events.' };
};
const visits = new Map();
const rateLimit = (request, response, next) => {
  const now = Date.now(); const { ip } = request; let row = visits.get(ip);
  if (!row && visits.size >= 1000) for (const [key, value] of visits) if (now - value.at > 60000) visits.delete(key);
  if (!row && visits.size >= 1000) { response.set('Retry-After', '60').status(429).json({ message: 'Please retry in a minute.' }); return; }
  if (!row || now - row.at > 60000) { row = { at: now, count: 0 }; visits.set(ip, row); }
  row.count += 1; if (row.count > 120) { response.set('Retry-After', '60').status(429).json({ message: 'Please retry in a minute.' }); return; } next();
};
module.exports = (service, endpoint, anonymousEndpoint) => {
  const root = '/field-data/app-user/xml-background';
  service.post(root, endpoint(async (c, { auth, body }, _, response) => {
    const owner = actorFor(auth);
    if (!body || Object.keys(body).length !== 4 || !UUID_PATTERN.test(body.id ?? '') || !/^[a-f0-9]{64}$/.test(body.tokenHash ?? '') || typeof body.expiresAt !== 'string' || !Number.isFinite(Date.parse(body.expiresAt)) || new Date(body.expiresAt).toISOString() !== body.expiresAt) throw xml.invalid('Provide a request UUID, token hash, exact manifest and expiry.');
    const manifest = xml.manifestFor(body.manifest); const requestHash = xml.digest(JSON.stringify({ manifest, tokenHash: body.tokenHash, expiresAt: body.expiresAt }));
    const result = await c.transacting(async tx => {
      const user = await tx.db.maybeOne(sql`SELECT "projectId" FROM field_keys WHERE "actorId"=${owner.id}`); if (!user) throw Problem.user.notFound();
      const form = await xml.scope(tx, owner.id, user.projectId, manifest);
      await tx.db.query(sql`SELECT pg_advisory_xact_lock(74164,${user.projectId})`);
      const replay = await tx.db.maybeOne(sql`SELECT * FROM field_data_xml_background WHERE id=${body.id}`);
      if (replay) {
        if (replay.ownerId !== owner.id) throw Problem.user.notFound();
        if (replay.requestHash !== requestHash) throw conflict();
        const target = await tx.db.one(sql`SELECT * FROM field_data_xml_courier_targets WHERE id=${replay.targetId}`);
        if (target.formId !== form.id || target.formDefId !== form.formDefId) throw Problem.user.notFound();
        return proof(tx, target, replay);
      }
      const settings = xml.config(); if (!settings) throw xml.invalid('Background XML signing is unavailable.');
      const { at } = await tx.db.one(sql`SELECT clock_timestamp() AS at`); const now = new Date(at).getTime();
      if (Date.parse(body.expiresAt) <= now || Date.parse(body.expiresAt) - now > 86400000) throw xml.invalid('Expiry must be in the next 24 hours.');
      let target = await tx.db.maybeOne(sql`SELECT * FROM field_data_xml_courier_targets WHERE "formId"=${form.id} AND manifest->>'instanceId'=${manifest.instanceId} FOR UPDATE`);
      if (target && (target.ownerId !== owner.id || target.formDefId !== form.formDefId || JSON.stringify(xml.manifestFor(target.manifest)) !== JSON.stringify(manifest))) throw conflict();
      if (target && await delivery.consumed(tx, target.id)) throw conflict();
      const base = await xml.editBase(tx, owner.id, form.id, manifest);
      if (!target) {
        if (await tx.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_xml_courier_targets WHERE "projectId"=${user.projectId}`) >= 1000) throw xml.invalid('Project XML history limit reached.');
        target = await tx.db.one(sql`INSERT INTO field_data_xml_courier_targets(id,"projectId","formId","formDefId","ownerId",manifest) VALUES(${randomUUID()},${user.projectId},${form.id},${form.formDefId},${owner.id},${JSON.stringify(manifest)}) RETURNING *`);
      }
      if (await tx.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_xml_background WHERE "targetId"=${target.id}`) >= 20) throw conflict();
      if (await tx.db.oneFirst(sql`SELECT EXISTS(SELECT 1 FROM field_data_xml_background a WHERE a."targetId"=${target.id} AND a."expiresAt">clock_timestamp() AND NOT EXISTS(SELECT 1 FROM field_data_xml_background_events e WHERE e."authorizationId"=a.id AND e.kind='revoke'))`)) throw conflict();
      const details = { id: body.id, targetId: target.id, projectId: target.projectId, formId: target.formId, formDefId: target.formDefId, ownerId: owner.id, manifest, tokenHash: body.tokenHash,
        ...(base ? { baseSubmissionDefId: base.id } : {}), issuedAt: new Date(at).toISOString(), expiresAt: body.expiresAt };
      const authorization = await tx.db.one(sql`INSERT INTO field_data_xml_background(id,"targetId","ownerId","tokenHash","requestHash","expiresAt",attestation) VALUES(${body.id},${target.id},${owner.id},${body.tokenHash},${requestHash},${body.expiresAt},${JSON.stringify(attest(settings, 'authorization', details))}) RETURNING *`);
      await tx.Audits.log(auth.actor, 'field_data.xml.background.authorize', null, { authorizationId: body.id, targetId: target.id, projectId: target.projectId, ownerId: owner.id });
      return proof(tx, target, authorization);
    });
    response.set('Cache-Control', 'private, no-store'); return result;
  }));
  service.get(root, endpoint(async (c, { auth, query }, _, response) => {
    const owner = actorFor(auth); const filtered = query.xmlFormId != null || query.instanceId != null;
    if (filtered && ![query.xmlFormId, query.instanceId].every(value => typeof value === 'string' && value.length > 0 && value.length <= 1000)) throw xml.invalid('Choose a form and instance to find its background receipts.');
    const result = await c.transacting(async tx => {
      const rows = await tx.db.any(sql`SELECT a.* FROM field_data_xml_background a JOIN field_data_xml_courier_targets t ON t.id=a."targetId" JOIN forms f ON f.id=t."formId"
        WHERE a."ownerId"=${owner.id} ${filtered ? sql`AND f."xmlFormId"=${query.xmlFormId} AND t.manifest->>'instanceId'=${query.instanceId}` : sql``} ORDER BY a."expiresAt" DESC,a.id DESC LIMIT 50`); const items = [];
      for (const row of rows) { // eslint-disable-line no-restricted-syntax
        const target = await tx.db.one(sql`SELECT * FROM field_data_xml_courier_targets WHERE id=${row.targetId}`); // eslint-disable-line no-await-in-loop
        try { await xml.scope(tx, owner.id, target.projectId, target.manifest, target); items.push(await proof(tx, target, row)); } catch (error) { if (error.httpCode !== 404) throw error; } // eslint-disable-line no-await-in-loop
      }
      return { items };
    });
    response.set('Cache-Control', 'private, no-store'); return result;
  }));
  service.get(`${root}/:id`, endpoint(async (c, { auth, params }, _, response) => {
    const owner = actorFor(auth);
    const result = await c.transacting(async tx => { const { target, authorization } = await get(tx, params.id); if (authorization.ownerId !== owner.id) throw Problem.user.notFound(); await xml.scope(tx, owner.id, target.projectId, target.manifest, target); return proof(tx, target, authorization); });
    response.set('Cache-Control', 'private, no-store'); return result;
  }));
  service.post(`${root}/:id/revoke`, endpoint(async (c, { auth, params, body }, _, response) => {
    const owner = actorFor(auth);
    if (!body || Object.keys(body).length !== 2 || !UUID_PATTERN.test(body.requestId ?? '') || typeof body.reason !== 'string' || body.reason.trim().length < 10 || body.reason.length > 2000) throw xml.invalid('Provide a request UUID and 10–2000 character reason.');
    const result = await c.transacting(async tx => {
      const { target, authorization } = await get(tx, params.id, true); if (authorization.ownerId !== owner.id) throw Problem.user.notFound();
      const requestHash = xml.digest(body.reason); const previous = await tx.db.maybeOne(sql`SELECT * FROM field_data_xml_background_events WHERE "authorizationId"=${authorization.id} AND kind='revoke'`);
      if (previous) { if (previous.requestId !== body.requestId || previous.requestHash !== requestHash) throw conflict(); return { event: previous }; }
      const { at } = await tx.db.one(sql`SELECT clock_timestamp() AS at`); const settings = xml.config();
      const details = { authorizationId: authorization.id, targetId: target.id, projectId: target.projectId, ownerId: owner.id, revokedBy: owner.id, revokedAt: new Date(at).toISOString(), reason: body.reason, authorizationPayloadHash: xml.digest(Buffer.from(authorization.attestation.payload, 'base64url')) };
      const event = await tx.db.one(sql`INSERT INTO field_data_xml_background_events(id,"targetId","authorizationId",kind,"requestId","requestHash",details,attestation) VALUES(${randomUUID()},${target.id},${authorization.id},'revoke',${body.requestId},${requestHash},${JSON.stringify(details)},${settings ? JSON.stringify(attest(settings, 'revoke', details)) : null}) RETURNING *`);
      await tx.Audits.log(auth.actor, 'field_data.xml.background.revoke', null, { authorizationId: authorization.id, targetId: target.id, projectId: target.projectId }); return { event };
    });
    response.set('Cache-Control', 'private, no-store'); return result;
  }));
  service.put(`${root}/:id/deliver`, rateLimit, anonymousEndpoint(async (c, { params }, request, response) => {
    const token = request.headers['x-field-data-delivery-token'];
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token) || Buffer.from(token, 'base64url').toString('base64url') !== token) throw Problem.user.notFound();
    const initial = await get(c, params.id);
    if (!timingSafeEqual(Buffer.from(xml.digest(token), 'hex'), Buffer.from(initial.authorization.tokenHash, 'hex'))) throw Problem.user.notFound();
    const bytes = await xml.readBytes(request); const parsed = await xml.parse(bytes);
    const result = await c.transacting(async tx => {
      const { target, authorization } = await get(tx, params.id, true);
      if (!await active(tx, authorization.id)) throw Problem.user.notFound();
      const settings = xml.config(); if (!settings || JSON.parse(Buffer.from(authorization.attestation.payload, 'base64url')).issuer !== settings.origin) throw xml.invalid('Background signing is unavailable or changed.');
      const manifest = { ...parsed.manifest, ...(parsed.deprecatedId ? { deprecatedId: parsed.deprecatedId, baseSha256: target.manifest.baseSha256 } : {}) };
      if (JSON.stringify(xml.manifestFor(manifest)) !== JSON.stringify(xml.manifestFor(target.manifest))) throw conflict();
      const used = await delivery.consumed(tx, target.id);
      const accepted = await delivery.accept(tx, target, parsed, { sourceRef: `xml-background:${authorization.id}`, transformVersion: 'xml-background@1', userAgent: 'Field Data background XML', consumed: used != null, expectedDefId: used?.details.submissionDefId });
      const prior = await tx.db.maybeOne(sql`SELECT id FROM field_data_xml_background_events WHERE "authorizationId"=${authorization.id} AND kind='delivery'`); if (prior) return proof(tx, target, authorization);
      const { at } = await tx.db.one(sql`SELECT clock_timestamp() AS at`); if (new Date(at).getTime() >= new Date(authorization.expiresAt).getTime()) throw Problem.user.notFound();
      const details = { authorizationId: authorization.id, targetId: target.id, projectId: target.projectId, formId: target.formId, formDefId: target.formDefId, ownerId: target.ownerId,
        submissionDefId: accepted.submissionDefId, ...(accepted.base ? { deprecatedId: target.manifest.deprecatedId, baseSha256: target.manifest.baseSha256, baseSubmissionDefId: accepted.base.id } : {}),
        sha256: target.manifest.sha256, size: target.manifest.size, transport: 'background-capability', alreadyReceived: accepted.alreadyReceived, submissionReceivedAt: new Date(accepted.submittedAt).toISOString(), acceptedAt: new Date(at).toISOString(), authorizationPayloadHash: xml.digest(Buffer.from(authorization.attestation.payload, 'base64url')) };
      await tx.db.query(sql`INSERT INTO field_data_xml_background_events(id,"targetId","authorizationId",kind,"requestId","requestHash",details,attestation) VALUES(${randomUUID()},${target.id},${authorization.id},'delivery',${randomUUID()},${target.manifest.sha256},${JSON.stringify(details)},${JSON.stringify(attest(settings, 'delivery', details))})`);
      const acteeId = await tx.db.oneFirst(sql`SELECT "acteeId" FROM forms WHERE id=${target.formId}`);
      await tx.Audits.log(Option.none(), 'field_data.xml.background.delivery', new Form({ id: target.formId, acteeId }), { authorizationId: authorization.id, targetId: target.id, projectId: target.projectId, ownerId: target.ownerId, submissionDefId: accepted.submissionDefId, transport: 'background-capability' });
      return proof(tx, target, authorization);
    });
    response.set('Cache-Control', 'private, no-store'); return result;
  }));
};
