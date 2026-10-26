// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { randomUUID } = require('node:crypto');
const { sql } = require('slonik');
const { Form } = require('../model/frames');
const Option = require('../util/option');
const Problem = require('../util/problem');
const { UUID_PATTERN } = require('../util/claim-versioning');
const { buildEnvelope } = require('../util/provenance');
const xml = require('../util/xml-couriers');
const conflict = () => Problem.user.mediaUploadConflict();
const actorFor = auth => { const actor = auth.actor.orNull(); if (actor?.type !== 'field_key') throw Problem.user.insufficientRights(); return actor; };
const same = (a, b) => JSON.stringify(xml.manifestFor(a)) === JSON.stringify(xml.manifestFor(b));
const get = async (tx, id, lock = false) => {
  if (!UUID_PATTERN.test(id ?? '')) throw Problem.user.notFound();
  const ref = await tx.db.maybeOne(sql`SELECT "targetId" FROM field_data_xml_couriers WHERE id=${id}`);
  if (!ref) throw Problem.user.notFound();
  const target = await tx.db.one(sql`SELECT * FROM field_data_xml_courier_targets WHERE id=${ref.targetId} ${lock ? sql`FOR UPDATE` : sql``}`);
  const grant = await tx.db.one(sql`SELECT * FROM field_data_xml_couriers WHERE id=${id} ${lock ? sql`FOR UPDATE` : sql``}`);
  return { target, grant };
};
const active = (tx, id) => tx.db.oneFirst(sql`SELECT EXISTS(SELECT 1 FROM field_data_xml_couriers g WHERE g.id=${id} AND g."expiresAt">clock_timestamp()
 AND NOT EXISTS(SELECT 1 FROM field_data_xml_courier_events e WHERE e."grantId"=g.id AND e.kind='revoke'))`);
const proof = async (tx, target, grant) => {
  const events = await tx.db.any(sql`SELECT * FROM field_data_xml_courier_events WHERE "grantId"=${grant.id} ORDER BY kind`);
  const delivered = events.find(event => event.kind === 'delivery'); let sourceAvailable = null;
  if (delivered) {
    const source = await tx.db.maybeOne(sql`SELECT sd.xml FROM submission_defs sd JOIN submissions s ON s.id=sd."submissionId"
      WHERE sd.id=${delivered.details.submissionDefId} AND sd.current AND sd.root AND s."deletedAt" IS NULL AND sd."submitterId"=${target.ownerId}`);
    sourceAvailable = source != null && xml.digest(source.xml) === target.manifest.sha256;
  }
  return { target, grant, events, sourceAvailable, checkedAt: new Date().toISOString(),
    limitations: 'Account transport assertions only. This snapshot cannot prove physical custody or absence of later events.' };
};
module.exports = (service, endpoint) => {
  const root = '/field-data/app-user/xml-couriers';
  service.post(root, endpoint(async (c, { auth, body }, _, response) => {
    const owner = actorFor(auth);
    if (!body || Object.keys(body).length !== 4 || !UUID_PATTERN.test(body.requestId ?? '') || !Number.isSafeInteger(body.courierId) || body.courierId <= 0 || body.courierId === owner.id || !Number.isInteger(body.minutes) || body.minutes < 5 || body.minutes > 1440) throw xml.invalid('Choose a different courier, request UUID and 5–1440 minute duration.');
    const manifest = xml.manifestFor(body.manifest);
    const result = await c.transacting(async tx => {
      const user = await tx.db.maybeOne(sql`SELECT "projectId" FROM field_keys WHERE "actorId"=${owner.id}`); if (!user) throw Problem.user.notFound();
      const form = await xml.scope(tx, owner.id, user.projectId, manifest);
      if (!await xml.account(tx, body.courierId, user.projectId)) throw xml.invalid('The recipient must be an active App User in the same project.');
      await tx.db.query(sql`SELECT pg_advisory_xact_lock(74164,${user.projectId})`);
      const requestHash = xml.digest(JSON.stringify({ courierId: body.courierId, minutes: body.minutes, manifest }));
      const replay = await tx.db.maybeOne(sql`SELECT * FROM field_data_xml_couriers WHERE "ownerId"=${owner.id} AND "requestId"=${body.requestId}`);
      if (replay) {
        if (replay.requestHash !== requestHash) throw conflict();
        const target = await tx.db.one(sql`SELECT * FROM field_data_xml_courier_targets WHERE id=${replay.targetId}`);
        if (target.formId !== form.id || target.formDefId !== form.formDefId) throw Problem.user.notFound();
        return proof(tx, target, replay);
      }
      const settings = xml.config(); if (!settings) throw xml.invalid('XML courier signing is unavailable.');
      let target = await tx.db.maybeOne(sql`SELECT * FROM field_data_xml_courier_targets WHERE "formId"=${form.id} AND manifest->>'instanceId'=${manifest.instanceId} FOR UPDATE`);
      if (target && (target.ownerId !== owner.id || target.formDefId !== form.formDefId || !same(target.manifest, manifest))) throw conflict();
      if (!target) {
        if (await tx.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_xml_courier_targets WHERE "projectId"=${user.projectId}`) >= 1000) throw xml.invalid('Project XML courier history limit reached.');
        target = await tx.db.one(sql`INSERT INTO field_data_xml_courier_targets(id,"projectId","formId","formDefId","ownerId",manifest)
          VALUES(${randomUUID()},${user.projectId},${form.id},${form.formDefId},${owner.id},${JSON.stringify(manifest)}) RETURNING *`);
      }
      const history = await tx.db.any(sql`SELECT id FROM field_data_xml_couriers WHERE "targetId"=${target.id}`);
      if (history.length >= 20 || await tx.db.oneFirst(sql`SELECT EXISTS(SELECT 1 FROM field_data_xml_courier_events WHERE "targetId"=${target.id} AND kind='delivery')`)) throw conflict();
      const live = await tx.db.oneFirst(sql`SELECT EXISTS(SELECT 1 FROM field_data_xml_couriers g WHERE g."targetId"=${target.id} AND g."expiresAt">clock_timestamp()
        AND NOT EXISTS(SELECT 1 FROM field_data_xml_courier_events e WHERE e."grantId"=g.id AND e.kind='revoke'))`);
      if (live) throw conflict();
      const { at, expiresAt } = await tx.db.one(sql`WITH stamp AS MATERIALIZED (SELECT clock_timestamp() AS at) SELECT at,at+(${body.minutes} * interval '1 minute') AS "expiresAt" FROM stamp`);
      const id = randomUUID();
      const details = { id, targetId: target.id, projectId: target.projectId, formId: target.formId, formDefId: target.formDefId, ownerId: owner.id, courierId: body.courierId,
        manifest, issuedAt: new Date(at).toISOString(), expiresAt: new Date(expiresAt).toISOString() };
      const grant = await tx.db.one(sql`INSERT INTO field_data_xml_couriers(id,"targetId","ownerId","courierId","requestId","requestHash","expiresAt",attestation)
        VALUES(${id},${target.id},${owner.id},${body.courierId},${body.requestId},${requestHash},${details.expiresAt},${JSON.stringify(xml.attest(settings, 'grant', details))}) RETURNING *`);
      await tx.Audits.log(auth.actor, 'field_data.xml.courier.grant', null, { grantId: id, targetId: target.id, projectId: target.projectId, ownerId: owner.id, courierId: body.courierId });
      return proof(tx, target, grant);
    });
    response.set('Cache-Control', 'private, no-store'); return result;
  }));
  service.get(root, endpoint(async (c, { auth, query }, _, response) => {
    const actor = actorFor(auth);
    if (![query.xmlFormId, query.instanceId].every(value => typeof value === 'string' && value.length > 0 && value.length <= 1000)) throw xml.invalid('Choose a form and instance to recover its grants.');
    const result = await c.transacting(async tx => {
      const user = await tx.db.maybeOne(sql`SELECT "projectId" FROM field_keys WHERE "actorId"=${actor.id}`); if (!user || !await xml.account(tx, actor.id, user.projectId)) throw Problem.user.notFound();
      const target = await tx.db.maybeOne(sql`SELECT t.* FROM field_data_xml_courier_targets t JOIN forms f ON f.id=t."formId"
        WHERE t."projectId"=${user.projectId} AND f."xmlFormId"=${query.xmlFormId} AND t.manifest->>'instanceId'=${query.instanceId}`);
      if (!target) return { items: [] };
      if (target.ownerId !== actor.id && !await tx.db.oneFirst(sql`SELECT EXISTS(SELECT 1 FROM field_data_xml_couriers WHERE "targetId"=${target.id} AND "courierId"=${actor.id})`)) return { items: [] };
      await xml.scope(tx, target.ownerId, target.projectId, target.manifest, target);
      const grants = await tx.db.any(sql`SELECT * FROM field_data_xml_couriers WHERE "targetId"=${target.id}
        AND (${target.ownerId}=${actor.id} OR "courierId"=${actor.id}) ORDER BY "expiresAt" DESC,id DESC LIMIT 20`);
      const items = [];
      for (const grant of grants) items.push(await proof(tx, target, grant)); // eslint-disable-line no-await-in-loop
      return { items };
    });
    response.set('Cache-Control', 'private, no-store'); return result;
  }));
  service.get(`${root}/:id`, endpoint(async (c, { auth, params }, _, response) => {
    const actor = actorFor(auth);
    const result = await c.transacting(async tx => {
      const { target, grant } = await get(tx, params.id);
      if (![target.ownerId, grant.courierId].includes(actor.id) || !await xml.account(tx, actor.id, target.projectId)) throw Problem.user.notFound();
      await xml.scope(tx, target.ownerId, target.projectId, target.manifest, target);
      return proof(tx, target, grant);
    });
    response.set('Cache-Control', 'private, no-store'); return result;
  }));
  service.post(`${root}/:id/revoke`, endpoint(async (c, { auth, params, body }, _, response) => {
    const actor = actorFor(auth);
    if (!body || Object.keys(body).length !== 2 || !UUID_PATTERN.test(body.requestId ?? '') || typeof body.reason !== 'string' || body.reason.trim().length < 10 || body.reason.length > 2000) throw xml.invalid('Provide a request UUID and a 10–2000 character revocation reason.');
    const result = await c.transacting(async tx => {
      const { target, grant } = await get(tx, params.id, true); if (target.ownerId !== actor.id) throw Problem.user.notFound();
      const requestHash = xml.digest(body.reason);
      const previous = await tx.db.maybeOne(sql`SELECT * FROM field_data_xml_courier_events WHERE "grantId"=${grant.id} AND kind='revoke'`);
      if (previous) { if (previous.requestId !== body.requestId || previous.requestHash !== requestHash) throw conflict(); return { event: previous }; }
      const { at } = await tx.db.one(sql`SELECT clock_timestamp() AS at`); const settings = xml.config();
      const details = { targetId: target.id, grantId: grant.id, projectId: target.projectId, ownerId: target.ownerId, revokedBy: actor.id, revokedAt: new Date(at).toISOString(), reason: body.reason,
        grantPayloadHash: xml.digest(Buffer.from(grant.attestation.payload, 'base64url')) };
      const attestation = settings ? xml.attest(settings, 'revoke', details) : null;
      const event = await tx.db.one(sql`INSERT INTO field_data_xml_courier_events(id,"targetId","grantId",kind,"requestId","requestHash",details,attestation)
        VALUES(${randomUUID()},${target.id},${grant.id},'revoke',${body.requestId},${requestHash},${JSON.stringify(details)},${attestation == null ? null : JSON.stringify(attestation)}) RETURNING *`);
      await tx.Audits.log(auth.actor, 'field_data.xml.courier.revoke', null, { targetId: target.id, grantId: grant.id, projectId: target.projectId });
      return { event };
    });
    response.set('Cache-Control', 'private, no-store'); return result;
  }));
  service.put(`${root}/:id/deliver`, endpoint(async (c, { auth, params }, request, response) => {
    const actor = actorFor(auth); const bytes = await xml.readBytes(request); const parsed = await xml.parse(bytes);
    const result = await c.transacting(async tx => {
      const { target, grant } = await get(tx, params.id, true);
      if (grant.courierId !== actor.id || !await xml.account(tx, actor.id, target.projectId)) throw Problem.user.notFound();
      const formScope = await xml.scope(tx, target.ownerId, target.projectId, target.manifest, target);
      if (!same(parsed.manifest, target.manifest)) throw conflict();
      if (!await active(tx, grant.id)) throw Problem.user.notFound();
      const settings = xml.config(); if (!settings || JSON.parse(Buffer.from(grant.attestation.payload, 'base64url')).issuer !== settings.origin) throw xml.invalid('The XML courier signing authority is unavailable or changed.');
      const prior = await tx.db.maybeOne(sql`SELECT * FROM field_data_xml_courier_events WHERE "targetId"=${target.id} AND kind='delivery'`);
      const existing = await tx.db.maybeOne(sql`SELECT s.id,s."submitterId",s."deletedAt",sd.id AS "submissionDefId",sd.xml,sd.current,sd.root,sd."formDefId",sd."createdAt"
        FROM submissions s JOIN submission_defs sd ON sd."submissionId"=s.id AND sd.current
        WHERE s."formId"=${target.formId} AND s."instanceId"=${target.manifest.instanceId} AND s.draft=FALSE FOR SHARE OF s,sd`);
      if (prior) {
        if (!existing || existing.deletedAt || !existing.root || existing.submissionDefId !== prior.details.submissionDefId || xml.digest(existing.xml) !== target.manifest.sha256) throw Problem.user.notFound();
        return proof(tx, target, grant);
      }
      if (existing && (existing.deletedAt || !existing.root || existing.submitterId !== target.ownerId || existing.formDefId !== target.formDefId || xml.digest(existing.xml) !== target.manifest.sha256)) throw conflict();
      let submissionDefId = existing?.submissionDefId; let submittedAt = existing?.createdAt;
      if (!existing) {
        const form = (await tx.Forms.getByProjectAndXmlFormId(target.projectId, target.manifest.xmlFormId, target.manifest.version)).orNull();
        if (!form || form.def.id !== formScope.formDefId) throw Problem.user.notFound();
        const owner = (await tx.Actors.getById(target.ownerId)).orNull(); if (!owner) throw Problem.user.notFound();
        // Scoped attribution only: all source/recipient/grant checks above use the real courier.
        // Native workers retain collector attribution; the separate custody audit records transport.
        const collector = tx.with({ context: { ...tx.context, auth: { actor: Option.of(owner), isAuthenticated: true } } });
        const provenance = buildEnvelope({ origin: 'collected', sourceRef: `xml-courier:${grant.id}`, xml: bytes, transformVersion: 'xml-courier@1' });
        const submission = await collector.Submissions.createNew(parsed.partial, form, null, 'Field Data XML courier', null, provenance);
        await collector.SubmissionAttachments.create(submission, form, await collector.Forms.getBinaryFields(form.def.id));
        submissionDefId = submission.def.id; submittedAt = submission.createdAt;
      }
      const { at } = await tx.db.one(sql`SELECT clock_timestamp() AS at`);
      if (new Date(at).getTime() >= new Date(grant.expiresAt).getTime()) throw Problem.user.notFound();
      const details = { targetId: target.id, grantId: grant.id, projectId: target.projectId, formId: target.formId, formDefId: target.formDefId,
        submissionDefId, ownerId: target.ownerId, receivedBy: actor.id, sha256: target.manifest.sha256, size: target.manifest.size,
        alreadyReceived: existing != null, submissionReceivedAt: new Date(submittedAt).toISOString(), acceptedAt: new Date(at).toISOString(),
        grantPayloadHash: xml.digest(Buffer.from(grant.attestation.payload, 'base64url')) };
      await tx.db.query(sql`INSERT INTO field_data_xml_courier_events(id,"targetId","grantId",kind,"requestId","requestHash",details,attestation)
        VALUES(${randomUUID()},${target.id},${grant.id},'delivery',${randomUUID()},${target.manifest.sha256},${JSON.stringify(details)},${JSON.stringify(xml.attest(settings, 'delivery', details))})`);
      await tx.Audits.log(auth.actor, 'field_data.xml.courier.delivery', new Form({ id: target.formId, acteeId: formScope.acteeId }),
        { grantId: grant.id, targetId: target.id, submissionDefId, ownerId: target.ownerId, receivedBy: actor.id, alreadyReceived: existing != null });
      return proof(tx, target, grant);
    });
    response.set('Cache-Control', 'private, no-store'); return result;
  }));
};
