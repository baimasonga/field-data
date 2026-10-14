// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { randomUUID } = require('node:crypto');
const { sql } = require('slonik');
const { checked, requestHash, metadata, history, lockReviewer } = require('../util/capture-assessments');
const { scope, source, attachment, isCurrent, image } = require('../util/capture-review-target');
const Problem = require('../util/problem');
module.exports = (service, endpoint) => {
  const root = '/projects/:projectId/forms/:xmlFormId/submissions/:instanceId/capture-challenges/:challengeId';
  service.get(`${root}/image`, endpoint(async (container, { auth, params }, _, response) => {
    const form = await scope(container, auth, params); const row = await source(container.db, params, form);
    if (!row) throw Problem.user.notFound();
    const bytes = await image(container, row);
    await container.Audits.log(auth.actor, 'field_data.capture.image.read', form, { challengeId: row.id, contentHash: row.contentHash });
    response.set('Content-Type', bytes[0] === 137 ? 'image/png' : 'image/jpeg'); response.set('Content-Disposition', 'attachment');
    response.set('Cache-Control', 'private, no-store'); return bytes;
  }));
  service.get(`${root}/assessments`, endpoint(async (container, { auth, params, query }, _, response) => {
    const form = await scope(container, auth, params); const row = await source(container.db, params, form);
    if (!row) throw Problem.user.notFound();
    if (query.before != null && (!/^[1-9]\d{0,8}$/.test(query.before))) throw Problem.user.captureAssessmentInvalid();
    const records = await history(container.db, row.id, query.before == null ? undefined : Number(query.before));
    response.set('Cache-Control', 'private, no-store');
    return { ...records, bindingCurrent: isCurrent(row, await attachment(container.db, row)), revision: row.assessmentRevision };
  }));
  service.post(`${root}/assessments`, endpoint(async (container, { auth, params, body, headers }, _, response) => {
    const form = await scope(container, auth, params, true); const actor = auth.actor.orNull();
    if (actor?.type !== 'user') throw Problem.user.notFound();
    const data = checked(body, headers); const digest = requestHash(data, actor.id);
    const result = await container.transacting(async tx => {
      const reviewer = await lockReviewer(tx, actor.id, form);
      const row = await source(tx.db, params, form, true); if (!row) throw Problem.user.notFound();
      // Match native upload lock ordering: attachment before challenge. Holding
      // these rows prevents replacement/supersession during assessment commit.
      const file = await attachment(tx.db, row, true);
      const locked = await tx.db.one(sql`SELECT * FROM field_data_capture_challenges WHERE id = ${row.id} FOR UPDATE`);
      const current = isCurrent({ ...row, ...locked }, file);
      const prior = await tx.db.maybeOne(sql`SELECT * FROM field_data_capture_assessments WHERE "challengeId" = ${row.id} AND "requestId" = ${data.requestId}`);
      if (prior) {
        if (prior.requestHash !== digest) throw Problem.user.captureAssessmentInvalid();
        return { assessment: metadata(prior), revision: prior.sequence, bindingCurrent: current, replayed: true };
      }
      if (!current || row.archived === true) throw Problem.user.captureAssessmentTargetChanged();
      if (locked.assessmentRevision !== data.revision) throw Problem.user.captureAssessmentRevisionStale();
      await image(tx, locked);
      const record = await tx.db.one(sql`INSERT INTO field_data_capture_assessments
        (id, "challengeId", sequence, "requestId", "requestHash", "reviewerId", "reviewerName", "codeAssessment", "sceneAssessment", note, "contentHash", "blobId", "reviewedOriginal")
        VALUES (${randomUUID()}, ${row.id}, ${locked.assessmentRevision + 1}, ${data.requestId}, ${digest}, ${reviewer.id}, ${reviewer.displayName},
          ${data.codeAssessment}, ${data.sceneAssessment}, ${data.note}, ${locked.contentHash}, ${locked.blobId}, TRUE) RETURNING *`);
      await tx.db.query(sql`UPDATE field_data_capture_challenges SET "assessmentRevision" = "assessmentRevision" + 1 WHERE id = ${row.id}`);
      await tx.Audits.log(actor, 'field_data.capture.assessed', form, { challengeId: row.id, assessmentId: record.id,
        sequence: record.sequence, codeAssessment: data.codeAssessment, sceneAssessment: data.sceneAssessment, contentHash: locked.contentHash, reviewedOriginal: true });
      return { assessment: metadata(record), revision: record.sequence, bindingCurrent: true, replayed: false };
    });
    response.set('Cache-Control', 'private, no-store'); response.set('Idempotency-Status', result.replayed ? 'replayed' : 'created');
    response.set('ETag', `"capture-${result.revision}"`); return result;
  }));
};
