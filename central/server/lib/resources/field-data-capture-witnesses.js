// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { randomUUID } = require('node:crypto');
const { sql } = require('slonik');
const { scope, source, attachment, isCurrent, image } = require('../util/capture-review-target');
const { lockReviewer } = require('../util/capture-assessments');
const { context, checked, metadata } = require('../util/capture-witnesses');
const Problem = require('../util/problem');
module.exports = (service, endpoint) => {
  const root = '/projects/:projectId/forms/:xmlFormId/submissions/:instanceId/capture-challenges/:challengeId/witnesses';
  service.get(root, endpoint(async (container, { auth, params }, _, response) => {
    const form = await scope(container, auth, params); const row = await source(container.db, params, form);
    if (!row) throw Problem.user.notFound();
    const actor = auth.actor.orNull(); const current = isCurrent(row, await attachment(container.db, row));
    const rows = await container.db.any(sql`SELECT * FROM field_data_capture_witnesses WHERE "challengeId" = ${row.id} ORDER BY "receivedAt" DESC LIMIT 10`);
    const canWitness = actor?.type === 'user' && actor.id !== row.actorId && current && !row.archived && rows.length < 10 &&
      !rows.some(r => r.witnessId === actor.id) && await auth.can('submission.update', form);
    response.set('Cache-Control', 'private, no-store');
    return { items: rows.map(metadata), bindingCurrent: current, canWitness, context: canWitness ? context(row, actor.id) : null };
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
        return { witness: metadata(prior), replayed: true, bindingCurrent: current };
      }
      if (!current || row.archived) throw Problem.user.captureAssessmentTargetChanged();
      if (Math.abs(Date.now() - Date.parse(data.signedAt)) > 10 * 60000) throw Problem.user.captureWitnessInvalid();
      const counts = await tx.db.one(sql`SELECT count(*)::integer AS total, count(*) FILTER (WHERE "witnessId" = ${actor.id})::integer AS own FROM field_data_capture_witnesses WHERE "challengeId" = ${row.id}`);
      if (counts.total >= 10 || counts.own > 0) throw Problem.user.captureWitnessConflict();
      await image(tx, row);
      const record = await tx.db.one(sql`INSERT INTO field_data_capture_witnesses (id, "challengeId", "witnessId", "witnessName", "requestId", "requestHash", payload, "publicKey", signature)
        VALUES (${randomUUID()}, ${row.id}, ${witness.id}, ${witness.displayName}, ${data.requestId}, ${data.requestHash}, ${data.payload}, ${sql.json(data.publicKey)}, ${data.signature}) RETURNING *`);
      await tx.Audits.log(actor, 'field_data.capture.witnessed', form, { challengeId: row.id, witnessId: record.id, contentHash: row.contentHash });
      return { witness: metadata(record), replayed: false, bindingCurrent: true };
    });
    response.set('Cache-Control', 'private, no-store'); response.set('Idempotency-Status', result.replayed ? 'replayed' : 'created'); return result;
  }));
};
