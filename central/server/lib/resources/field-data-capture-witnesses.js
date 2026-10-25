// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { randomUUID } = require('node:crypto');
const { sql } = require('slonik');
const { scope, source, attachment, isCurrent, image } = require('../util/capture-review-target');
const delegation = require('../util/witness-delegations');
const { context, checked, changeContext, checkedChange, lifecycle } = require('../util/capture-witnesses');
const Problem = require('../util/problem');
const { UUID_PATTERN } = require('../util/claim-versioning');
const keyTrust = require('../util/witness-key-trust');

const eventsFor = (db, id) => db.any(sql`SELECT * FROM field_data_capture_witness_events WHERE "witnessRecordId" = ${id} ORDER BY sequence LIMIT 21`);
module.exports = (service, endpoint) => {
  const root = '/projects/:projectId/forms/:xmlFormId/submissions/:instanceId/capture-challenges/:challengeId/witnesses';
  service.get(root, endpoint(async (container, { auth, params }, _, response) => {
    const form = await scope(container, auth, params); const row = await source(container.db, params, form);
    if (!row) throw Problem.user.notFound();
    const actor = auth.actor.orNull(); const current = isCurrent(row, await attachment(container.db, row));
    const rows = await container.db.any(sql`SELECT * FROM field_data_capture_witnesses WHERE "challengeId" = ${row.id} ORDER BY "receivedAt" DESC LIMIT 10`);
    const mayChange = await delegation.maySign(container, auth, form) && (!row.archived || await auth.can('submission.update', form));
    const events = rows.length === 0 ? [] : await container.db.any(sql`SELECT * FROM field_data_capture_witness_events
      WHERE "witnessRecordId" = ANY(${sql.array(rows.map(record => record.id), 'uuid')}) ORDER BY sequence`);
    const project = (await container.Projects.getById(params.projectId)).orNull();
    const mayRevokeOthers = mayChange && project != null && await auth.can('project.update', project);
    const items = await Promise.all(rows.map(async record => {
      const changes = events.filter(event => event.witnessRecordId === record.id);
      const trust = await keyTrust.trustFor(container.db, params.projectId, record, changes);
      const item = { ...lifecycle(record, changes), keyTrust: { ...trust, signingAvailable: keyTrust.config() != null, canRevoke: actor?.type === 'user' && ((record.witnessId === actor.id && (mayChange || record.authorization != null)) || mayRevokeOthers) } };
      return { ...item, canCorrect: mayChange && record.witnessId === actor.id && item.status === 'active' && item.keyTrust.status === 'clear' && item.revision < 20, changeContext: actor?.type === 'user' && (mayChange || record.authorization != null) && record.witnessId === actor.id && item.status === 'active'
        ? changeContext(row, record, changes.at(-1)) : null };
    }));
    const canWitness = actor?.type === 'user' && actor.id !== row.actorId && current && !row.archived && rows.length < 10 &&
      !rows.some(r => r.witnessId === actor.id) && mayChange;
    response.set('Cache-Control', 'private, no-store');
    return { items, activeCount: current ? items.filter(item => item.status === 'active' && item.keyTrust.status === 'clear').length : 0, bindingCurrent: current, canWitness, context: canWitness ? context(row, actor.id) : null };
  }));
  service.post(root, endpoint(async (container, { auth, params, body }, _, response) => {
    const form = await scope(container, auth, params); const actor = auth.actor.orNull();
    if (actor?.type !== 'user') throw Problem.user.notFound();
    const result = await container.transacting(async tx => {
      await keyTrust.trustLock(tx.db, params.projectId);
      let witness = await delegation.lockSigner(tx, auth, form, true);
      const row = await source(tx.db, params, form, true); if (!row || row.actorId === actor.id) throw Problem.user.notFound();
      const file = await attachment(tx.db, row, true);
      await tx.db.one(sql`SELECT id FROM field_data_capture_challenges WHERE id = ${row.id} FOR UPDATE`);
      if (!await delegation.maySign(tx, auth, form) && (!UUID_PATTERN.test(body?.requestId ?? '') || !await tx.db.maybeOne(sql`SELECT id FROM field_data_capture_witnesses WHERE "challengeId"=${row.id} AND "witnessId"=${actor.id} AND "requestId"=${body.requestId} AND "authorization" IS NOT NULL`))) throw Problem.user.notFound();
      const data = checked(body, row, actor.id);
      const prior = await tx.db.maybeOne(sql`SELECT * FROM field_data_capture_witnesses WHERE "challengeId" = ${row.id} AND "requestId" = ${data.requestId}`);
      const current = isCurrent(row, file);
      if (prior) {
        if (prior.authorization == null) await delegation.lockSigner(tx, auth, form);
        if (prior.requestHash !== data.requestHash) throw Problem.user.captureWitnessInvalid();
        return { witness: { ...lifecycle(prior, await eventsFor(tx.db, prior.id)), keyTrust: await keyTrust.trustFor(tx.db, params.projectId, prior, await eventsFor(tx.db, prior.id)) }, replayed: true, bindingCurrent: current };
      }
      witness = await delegation.lockSigner(tx, auth, form);
      if (await keyTrust.keyRevoked(tx.db, params.projectId, data.publicKey)) throw Problem.user.captureWitnessConflict();
      if (!current || row.archived) throw Problem.user.captureAssessmentTargetChanged();
      if (Math.abs(Date.now() - Date.parse(data.signedAt)) > 10 * 60000) throw Problem.user.captureWitnessInvalid();
      const counts = await tx.db.one(sql`SELECT count(*)::integer AS total, count(*) FILTER (WHERE "witnessId" = ${actor.id})::integer AS own FROM field_data_capture_witnesses WHERE "challengeId" = ${row.id}`);
      if (counts.total >= 10 || counts.own > 0) throw Problem.user.captureWitnessConflict();
      await image(tx, row);
      const receivedAt = new Date(await tx.db.oneFirst(sql`SELECT clock_timestamp()`));
      const authorization = delegation.receipt(witness, data, receivedAt);
      const record = await tx.db.one(sql`INSERT INTO field_data_capture_witnesses (id, "challengeId", "witnessId", "witnessName", "requestId", "requestHash", payload, "publicKey", signature,"authorization","receivedAt")
        VALUES (${randomUUID()}, ${row.id}, ${witness.id}, ${witness.displayName}, ${data.requestId}, ${data.requestHash}, ${data.payload}, ${sql.json(data.publicKey)}, ${data.signature},${authorization == null ? null : sql.json(authorization)},${receivedAt.toISOString()}) RETURNING *`);
      await tx.Audits.log(actor, 'field_data.capture.witnessed', form, { challengeId: row.id, witnessId: record.id, contentHash: row.contentHash });
      return { witness: { ...lifecycle(record, []), keyTrust: await keyTrust.trustFor(tx.db, params.projectId, record, []) }, replayed: false, bindingCurrent: true };
    });
    response.set('Cache-Control', 'private, no-store'); response.set('Idempotency-Status', result.replayed ? 'replayed' : 'created'); return result;
  }));
  service.post(`${root}/:witnessRecordId/events`, endpoint(async (container, { auth, params, body }, _, response) => {
    const form = await scope(container, auth, params); const actor = auth.actor.orNull();
    if (actor?.type !== 'user' || !UUID_PATTERN.test(params.witnessRecordId ?? '')) throw Problem.user.notFound();
    if (!UUID_PATTERN.test(body?.requestId ?? '')) throw Problem.user.captureWitnessInvalid();
    const result = await container.transacting(async tx => {
      await keyTrust.trustLock(tx.db, params.projectId);
      let signer = await delegation.lockSigner(tx, auth, form, true);
      const row = await source(tx.db, params, form, true); if (!row) throw Problem.user.notFound();
      const file = await attachment(tx.db, row, true);
      await tx.db.one(sql`SELECT id FROM field_data_capture_challenges WHERE id = ${row.id} FOR UPDATE`);
      const witness = await tx.db.maybeOne(sql`SELECT * FROM field_data_capture_witnesses
        WHERE id = ${params.witnessRecordId} AND "challengeId" = ${row.id} FOR UPDATE`);
      if (!witness || witness.witnessId !== actor.id) throw Problem.user.notFound();
      if (witness.authorization == null) signer = await delegation.lockSigner(tx, auth, form);
      const events = await eventsFor(tx.db, witness.id);
      const prior = events.find(event => event.requestId === body.requestId);
      const previous = prior ? events[prior.sequence - 2] : events.at(-1);
      const data = checkedChange(body, changeContext(row, witness, previous));
      if (prior) {
        if (prior.requestHash !== data.requestHash) throw Problem.user.captureWitnessInvalid();
        return { witness: { ...lifecycle(witness, events), keyTrust: await keyTrust.trustFor(tx.db, params.projectId, witness, events) }, replayed: true, bindingCurrent: isCurrent(row, file) };
      }
      if (data.action === 'correct' && row.archived && witness.authorization != null) throw Problem.user.captureAssessmentTargetChanged();
      if (data.action === 'correct') signer = await delegation.lockSigner(tx, auth, form);
      const trust = await keyTrust.trustFor(tx.db, params.projectId, witness, events);
      if (await keyTrust.keyRevoked(tx.db, params.projectId, data.publicKey) || (trust.status === 'revoked' && data.action === 'correct')) throw Problem.user.captureWitnessChangeConflict();
      if (events.at(-1)?.action === 'withdraw' || (events.length >= 20 && data.action !== 'withdraw')) throw Problem.user.captureWitnessChangeConflict();
      if (Math.abs(Date.now() - Date.parse(data.signedAt)) > 10 * 60000) throw Problem.user.captureWitnessInvalid();
      const receivedAt = new Date(await tx.db.oneFirst(sql`SELECT clock_timestamp()`));
      const authorization = delegation.receipt(signer, data, receivedAt);
      const event = await tx.db.one(sql`INSERT INTO field_data_capture_witness_events
        (id, "witnessRecordId", sequence, action, "actorId", "actorName", "requestId", "requestHash", payload, "publicKey", signature,"authorization","receivedAt")
        VALUES (${randomUUID()}, ${witness.id}, ${events.length + 1}, ${data.action}, ${signer.id}, ${signer.displayName},
          ${data.requestId}, ${data.requestHash}, ${data.payload}, ${sql.json(data.publicKey)}, ${data.signature},${authorization == null ? null : sql.json(authorization)},${receivedAt.toISOString()}) RETURNING *`);
      await tx.Audits.log(actor, `field_data.capture.witness.${data.action}`, form,
        { challengeId: row.id, witnessId: witness.id, eventId: event.id, sequence: event.sequence, contentHash: row.contentHash });
      return { witness: { ...lifecycle(witness, [...events, event]), keyTrust: await keyTrust.trustFor(tx.db, params.projectId, witness, [...events, event]) }, replayed: false, bindingCurrent: isCurrent(row, file) };
    });
    response.set('Cache-Control', 'private, no-store'); response.set('Idempotency-Status', result.replayed ? 'replayed' : 'created');
    return result;
  }));

  service.post(`${root}/:witnessRecordId/key-revocations`, endpoint(async (container, { auth, params, body }, _, response) => {
    const form = await scope(container, auth, params); const actor = auth.actor.orNull();
    const data = keyTrust.validateRevocation(body);
    if (actor?.type !== 'user' || !UUID_PATTERN.test(params.witnessRecordId ?? '')) throw Problem.user.notFound();
    if (!data) throw Problem.user.captureWitnessInvalid();
    const result = await container.transacting(async tx => {
      await keyTrust.trustLock(tx.db, params.projectId);
      await delegation.lockSigner(tx, auth, form, true);
      const row = await source(tx.db, params, form, true); if (!row) throw Problem.user.notFound();
      const witness = await tx.db.maybeOne(sql`SELECT * FROM field_data_capture_witnesses WHERE id = ${params.witnessRecordId} AND "challengeId" = ${row.id}`);
      if (!witness) throw Problem.user.notFound();
      if (witness.authorization == null) await delegation.lockSigner(tx, auth, form);
      const project = (await tx.Projects.getById(params.projectId)).orNull();
      if (witness.witnessId !== actor.id && !await keyTrust.lockProjectManager(tx, actor.id, project)) throw Problem.user.notFound();
      const events = await eventsFor(tx.db, witness.id);
      if (![witness, ...events].some(item => keyTrust.keyHash(item.publicKey) === data.keyHash)) throw Problem.user.notFound();
      const hash = keyTrust.revocationHash(data, actor.id);
      const priorRows = await tx.db.any(sql`SELECT * FROM field_data_witness_key_revocations WHERE "projectId" = ${Number(params.projectId)} AND ("requestId" = ${data.requestId} OR "keyHash" = ${data.keyHash})`);
      if (priorRows.length > 1) throw Problem.user.captureWitnessConflict();
      const prior = priorRows[0];
      if (prior) {
        if (prior.requestId !== data.requestId || prior.requestHash !== hash) throw Problem.user.captureWitnessConflict();
        return { attestation: prior.attestation, replayed: true };
      }
      const settings = keyTrust.config(); if (!settings) throw Problem.user.captureWitnessInvalid();
      const revokedAt = await tx.db.oneFirst(sql`SELECT clock_timestamp()`);
      const attestation = keyTrust.attest(settings, { projectId: Number(params.projectId), keyHash: data.keyHash,
        referenceWitnessId: witness.id, revokedBy: actor.id, witnessAccountId: witness.witnessId,
        requestId: data.requestId, reasonCode: data.reasonCode, reason: data.reason, revokedAt: new Date(revokedAt).toISOString() });
      await tx.db.query(sql`INSERT INTO field_data_witness_key_revocations ("projectId", "keyHash", "requestId", "requestHash", attestation)
        VALUES (${Number(params.projectId)}, ${data.keyHash}, ${data.requestId}, ${hash}, ${sql.json(attestation)})`);
      await tx.Audits.log(actor, 'field_data.capture.witness.key_revoked', form, { keyHash: data.keyHash, witnessId: witness.id, reasonCode: data.reasonCode, issuerKeyId: settings.keyId });
      return { attestation, replayed: false };
    });
    response.set('Cache-Control', 'private, no-store'); response.set('Idempotency-Status', result.replayed ? 'replayed' : 'created');
    return result;
  }));

};
