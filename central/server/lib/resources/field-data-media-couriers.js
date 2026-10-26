// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { randomUUID } = require('node:crypto');
const { sql } = require('slonik');
const Problem = require('../util/problem');
const { UUID_PATTERN } = require('../util/claim-versioning');
const courier = require('../util/media-couriers');
const target = require('../util/media-upload-target');
const actorFor = auth => { const actor = auth.actor.orNull(); if (actor?.type !== 'field_key') throw Problem.user.insufficientRights(); return actor; };
const upload = async (tx, actor, id) => {
  if (!UUID_PATTERN.test(id ?? '')) throw Problem.user.notFound();
  const row = await tx.db.maybeOne(sql`SELECT * FROM field_data_media_uploads WHERE id=${id} FOR UPDATE`);
  if (!row || row.actorId !== actor.id) throw Problem.user.notFound(); return row;
};
module.exports = (service, endpoint) => {
  const root = '/field-data/app-user/media-uploads/:id/courier';
  service.post(root, endpoint(async (c, { auth, body, params }, _, response) => {
    const actor = actorFor(auth);
    if (!body || Object.keys(body).length !== 3 || !UUID_PATTERN.test(body.requestId ?? '') || !Number.isSafeInteger(body.courierId) || body.courierId <= 0 ||
      !Number.isInteger(body.minutes) || body.minutes < 5 || body.minutes > 1440) throw courier.invalid('Use a recipient account, request UUID and a duration of 5–1440 minutes.');
    const result = await c.transacting(async tx => {
      const row = await upload(tx, actor, params.id);
      await target(tx, actor, row.manifest, row);
      const requestHash = courier.digest(JSON.stringify({ uploadId: row.id, courierId: body.courierId, minutes: body.minutes }));
      const existing = await courier.grantFor(tx, row.id);
      if (existing) {
        if (existing.requestId !== body.requestId || existing.requestHash !== requestHash) throw Problem.user.mediaUploadConflict();
        return { grant: existing };
      }
      if (row.status !== 'pending' || row.manifest.challengeId != null || body.courierId === actor.id || !await courier.account(tx, body.courierId, row.projectId)) throw courier.invalid('Choose a different active App User in this project and an ordinary pending transfer.');
      const settings = courier.config(); if (!settings) throw courier.invalid('Courier signing is unavailable.');
      await tx.db.query(sql`SELECT pg_advisory_xact_lock(74163,${row.projectId})`);
      if (await tx.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_media_couriers WHERE "projectId"=${row.projectId}`) >= 1000) throw courier.invalid('Project courier history limit reached.');
      const { now, expiresAt } = await tx.db.one(sql`SELECT clock_timestamp() AS now,
        LEAST(${new Date(row.expiresAt).toISOString()}::timestamptz,clock_timestamp()+(${body.minutes} * interval '1 minute')) AS "expiresAt"`);
      if (new Date(expiresAt).getTime() <= new Date(now).getTime()) throw Problem.user.notFound();
      const id = randomUUID();
      const details = { id, uploadId: row.id, projectId: row.projectId, submissionDefId: row.submissionDefId, ownerId: actor.id, courierId: body.courierId,
        manifest: row.manifest, issuedAt: new Date(now).toISOString(), expiresAt: new Date(expiresAt).toISOString() };
      const grant = await tx.db.one(sql`INSERT INTO field_data_media_couriers(id,"uploadId","projectId","submissionDefId","ownerId","courierId","requestId","requestHash","expiresAt",manifest,attestation)
        VALUES(${id},${row.id},${row.projectId},${row.submissionDefId},${actor.id},${body.courierId},${body.requestId},${requestHash},${new Date(expiresAt).toISOString()},${JSON.stringify(row.manifest)},${JSON.stringify(courier.attest(settings, 'grant', details))}) RETURNING *`);
      await tx.Audits.log(auth.actor, 'field_data.media.courier.grant', null, { grantId: id, uploadId: row.id, projectId: row.projectId, ownerId: actor.id, courierId: body.courierId });
      return { grant };
    });
    response.set('Cache-Control', 'private, no-store'); return result;
  }));
  service.post(`${root}/revoke`, endpoint(async (c, { auth, params, body }, _, response) => {
    const actor = actorFor(auth);
    if (!body || Object.keys(body).length !== 2 || !UUID_PATTERN.test(body.requestId ?? '') || typeof body.reason !== 'string' || body.reason.trim().length < 10 || body.reason.length > 2000) throw courier.invalid('Provide a request UUID and a revocation reason of 10–2000 characters.');
    const result = await c.transacting(async tx => {
      if (!UUID_PATTERN.test(params.id ?? '')) throw Problem.user.notFound();
      // Same lock as status/chunk/completion. The history survives session cleanup.
      await tx.db.query(sql`SELECT id FROM field_data_media_uploads WHERE id=${params.id} FOR UPDATE`);
      const grant = await courier.grantFor(tx, params.id);
      if (!grant || grant.ownerId !== actor.id) throw Problem.user.notFound();
      await tx.db.query(sql`SELECT id FROM field_data_media_couriers WHERE id=${grant.id} FOR UPDATE`);
      const requestHash = courier.digest(body.reason);
      const existing = await tx.db.maybeOne(sql`SELECT * FROM field_data_media_courier_events WHERE "grantId"=${grant.id} AND kind='revoke'`);
      if (existing) {
        if (existing.requestId !== body.requestId || existing.requestHash !== requestHash) throw Problem.user.mediaUploadConflict();
        return { event: existing };
      }
      const { at } = await tx.db.one(sql`SELECT clock_timestamp() AS at`);
      const details = { grantId: grant.id, uploadId: grant.uploadId, projectId: grant.projectId, revokedBy: actor.id, revokedAt: new Date(at).toISOString(), reason: body.reason,
        grantPayloadHash: courier.digest(Buffer.from(grant.attestation.payload, 'base64url')) };
      const settings = courier.config(); const attestation = settings ? courier.attest(settings, 'revoke', details) : null;
      const event = await tx.db.one(sql`INSERT INTO field_data_media_courier_events(id,"grantId",kind,"requestId","requestHash",details,attestation)
        VALUES(${randomUUID()},${grant.id},'revoke',${body.requestId},${requestHash},${JSON.stringify(details)},${attestation == null ? null : JSON.stringify(attestation)}) RETURNING *`);
      await tx.Audits.log(auth.actor, 'field_data.media.courier.revoke', null, { grantId: grant.id, uploadId: grant.uploadId, projectId: grant.projectId });
      return { event };
    });
    response.set('Cache-Control', 'private, no-store'); return result;
  }));
  service.get(root, endpoint(async (c, { auth, params }, _, response) => {
    const actor = actorFor(auth);
    const result = await c.transacting(async tx => {
      if (!UUID_PATTERN.test(params.id ?? '')) throw Problem.user.notFound();
      const grant = await courier.grantFor(tx, params.id);
      if (!grant || ![grant.ownerId, grant.courierId].includes(actor.id) || !await courier.account(tx, actor.id, grant.projectId)) throw Problem.user.notFound();
      const events = await tx.db.any(sql`SELECT * FROM field_data_media_courier_events WHERE "grantId"=${grant.id} ORDER BY kind`);
      const delivered = events.find(e => e.kind === 'delivery');
      await target(tx, { id: grant.ownerId }, grant.manifest, { projectId: grant.projectId, submissionDefId: grant.submissionDefId,
        status: delivered ? 'completed' : 'pending', blobId: delivered?.details.blobId });
      return { grant, events, checkedAt: new Date().toISOString(), limitations: 'Server-attested account transport history; no proof of physical custody or absence of later revocations.' };
    });
    response.set('Cache-Control', 'private, no-store'); return result;
  }));
};
