// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { randomUUID } = require('node:crypto');
const { sql } = require('slonik');
const { scope, source, attachment, isCurrent, image } = require('../util/capture-review-target');
const { lockReviewer } = require('../util/capture-assessments');
const { context, checked, changeContext, checkedChange, lifecycle } = require('../util/capture-witnesses');
const Problem = require('../util/problem');
const { UUID_PATTERN } = require('../util/claim-versioning');
const eventsFor = (db, id) => db.any(sql`SELECT * FROM field_data_capture_witness_events WHERE "witnessRecordId" = ${id} ORDER BY sequence LIMIT 21`);
module.exports = (service, endpoint) => {
  const root = '/projects/:projectId/forms/:xmlFormId/submissions/:instanceId/capture-challenges/:challengeId/witnesses';
  service.get(root, endpoint(async (container, { auth, params }, _, response) => {
    const form = await scope(container, auth, params); const row = await source(container.db, params, form);
    if (!row) throw Problem.user.notFound();
    const actor = auth.actor.orNull(); const current = isCurrent(row, await attachment(container.db, row));
    const rows = await container.db.any(sql`SELECT * FROM field_data_capture_witnesses WHERE "challengeId" = ${row.id} ORDER BY "receivedAt" DESC LIMIT 10`);
    const mayChange = actor?.type === 'user' && await auth.can('submission.update', form);
    const events = rows.length === 0 ? [] : await container.db.any(sql`SELECT * FROM field_data_capture_witness_events
      WHERE "witnessRecordId" = ANY(${sql.array(rows.map(record => record.id), 'uuid')}) ORDER BY sequence`);
    const items = rows.map(record => {
      const changes = events.filter(event => event.witnessRecordId === record.id);
      const item = lifecycle(record, changes);
      return { ...item, canCorrect: mayChange && record.witnessId === actor.id && item.status === 'active' && item.revision < 20, changeContext: mayChange && record.witnessId === actor.id && item.status === 'active'
        ? changeContext(row, record, changes.at(-1)) : null };
    });
    const canWitness = actor?.type === 'user' && actor.id !== row.actorId && current && !row.archived && rows.length < 10 &&
      !rows.some(r => r.witnessId === actor.id) && mayChange;
    response.set('Cache-Control', 'private, no-store');
    return { items, activeCount: current ? items.filter(item => item.status === 'active').length : 0, bindingCurrent: current, canWitness, context: canWitness ? context(row, actor.id) : null };
  }));
  service.post(root, endpoint(async (container, { auth, params, body }, _, response) => {
    const form = await scope(container, auth, params, true); const actor = auth.actor.orNull();
    if (actor?.type !== 'user') throw Problem.user.notFound();
    const result = await container.transacting(async tx => {
      const witness = await lockReviewer(tx, actor.id, form);
      const row = await source(tx.db, params, form, true); if (!row || row.actorId === actor.id) throw Problem.user.notFound();
      const file = await attachment(tx.db, row, true);
      await tx.db.one(sql`SELECT id FROM field_data_capture_challenges WHERE id = ${row.id} FOR UPDATE`);
      const data = checked(body, row, actor.id);
      const prior = await tx.db.maybeOne(sql`SELECT * FROM field_data_capture_witnesses WHERE "challengeId" = ${row.id} AND "requestId" = ${data.requestId}`);
      const current = isCurrent(row, file);
      if (prior) {
        if (prior.requestHash !== data.requestHash) throw Problem.user.captureWitnessInvalid();
        return { witness: lifecycle(prior, await eventsFor(tx.db, prior.id)), replayed: true, bindingCurrent: current };
      }
      if (!current || row.archived) throw Problem.user.captureAssessmentTargetChanged();
      if (Math.abs(Date.now() - Date.parse(data.signedAt)) > 10 * 60000) throw Problem.user.captureWitnessInvalid();
      const counts = await tx.db.one(sql`SELECT count(*)::integer AS total, count(*) FILTER (WHERE "witnessId" = ${actor.id})::integer AS own FROM field_data_capture_witnesses WHERE "challengeId" = ${row.id}`);
      if (counts.total >= 10 || counts.own > 0) throw Problem.user.captureWitnessConflict();
      await image(tx, row);
      const record = await tx.db.one(sql`INSERT INTO field_data_capture_witnesses (id, "challengeId", "witnessId", "witnessName", "requestId", "requestHash", payload, "publicKey", signature)
        VALUES (${randomUUID()}, ${row.id}, ${witness.id}, ${witness.displayName}, ${data.requestId}, ${data.requestHash}, ${data.payload}, ${sql.json(data.publicKey)}, ${data.signature}) RETURNING *`);
      await tx.Audits.log(actor, 'field_data.capture.witnessed', form, { challengeId: row.id, witnessId: record.id, contentHash: row.contentHash });
      return { witness: lifecycle(record, []), replayed: false, bindingCurrent: true };
    });
    response.set('Cache-Control', 'private, no-store'); response.set('Idempotency-Status', result.replayed ? 'replayed' : 'created'); return result;
  }));
  service.post(`${root}/:witnessRecordId/events`, endpoint(async (container, { auth, params, body }, _, response) => {
    const form = await scope(container, auth, params, true); const actor = auth.actor.orNull();
    if (actor?.type !== 'user' || !UUID_PATTERN.test(params.witnessRecordId ?? '')) throw Problem.user.notFound();
    if (!UUID_PATTERN.test(body?.requestId ?? '')) throw Problem.user.captureWitnessInvalid();
    const result = await container.transacting(async tx => {
      const signer = await lockReviewer(tx, actor.id, form);
      const row = await source(tx.db, params, form, true); if (!row) throw Problem.user.notFound();
      const file = await attachment(tx.db, row, true);
      await tx.db.one(sql`SELECT id FROM field_data_capture_challenges WHERE id = ${row.id} FOR UPDATE`);
      const witness = await tx.db.maybeOne(sql`SELECT * FROM field_data_capture_witnesses
        WHERE id = ${params.witnessRecordId} AND "challengeId" = ${row.id} FOR UPDATE`);
      if (!witness || witness.witnessId !== actor.id) throw Problem.user.notFound();
      const events = await eventsFor(tx.db, witness.id);
      const prior = events.find(event => event.requestId === body.requestId);
      const previous = prior ? events[prior.sequence - 2] : events.at(-1);
      const data = checkedChange(body, changeContext(row, witness, previous));
      if (prior) {
        if (prior.requestHash !== data.requestHash) throw Problem.user.captureWitnessInvalid();
        return { witness: lifecycle(witness, events), replayed: true, bindingCurrent: isCurrent(row, file) };
      }
      if (events.at(-1)?.action === 'withdraw' || (events.length >= 20 && data.action !== 'withdraw')) throw Problem.user.captureWitnessChangeConflict();
      if (Math.abs(Date.now() - Date.parse(data.signedAt)) > 10 * 60000) throw Problem.user.captureWitnessInvalid();
      const event = await tx.db.one(sql`INSERT INTO field_data_capture_witness_events
        (id, "witnessRecordId", sequence, action, "actorId", "actorName", "requestId", "requestHash", payload, "publicKey", signature)
        VALUES (${randomUUID()}, ${witness.id}, ${events.length + 1}, ${data.action}, ${signer.id}, ${signer.displayName},
          ${data.requestId}, ${data.requestHash}, ${data.payload}, ${sql.json(data.publicKey)}, ${data.signature}) RETURNING *`);
      await tx.Audits.log(actor, `field_data.capture.witness.${data.action}`, form,
        { challengeId: row.id, witnessId: witness.id, eventId: event.id, sequence: event.sequence, contentHash: row.contentHash });
      return { witness: lifecycle(witness, [...events, event]), replayed: false, bindingCurrent: isCurrent(row, file) };
    });
    response.set('Cache-Control', 'private, no-store'); response.set('Idempotency-Status', result.replayed ? 'replayed' : 'created');
    return result;
  }));

};
