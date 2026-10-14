// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { randomUUID, createHash } = require('node:crypto');
const { sql } = require('slonik');
const { Form } = require('../model/frames');
const { blobContent } = require('../util/blob');
const { getOrNotFound } = require('../util/promise');
const { UUID_PATTERN } = require('../util/claim-versioning');
const { checked, requestHash, metadata, history, lockReviewer } = require('../util/capture-assessments');
const Problem = require('../util/problem');
const scope = async (container, auth, params, write = false) => {
  const form = await container.Forms.getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.WithoutDef, Form.WithoutXml).then(getOrNotFound);
  try { await auth.canOrReject('submission.read', form); if (write) await auth.canOrReject('submission.update', form); } catch (error) {
    if (error?.problemCode === Problem.user.insufficientRights.code) throw Problem.user.notFound();
    throw error;
  }
  await container.Submissions.getByIds(params.projectId, params.xmlFormId, params.instanceId, false).then(getOrNotFound);
  if (!UUID_PATTERN.test(params.challengeId ?? '')) throw Problem.user.notFound();
  return form;
};
const source = (db, params, form, lock = false) => db.maybeOne(sql`SELECT c.*, sd.current AS "definitionCurrent", p.archived,
  sd."submissionId" FROM field_data_capture_challenges c JOIN submission_defs sd ON sd.id = c."submissionDefId"
  JOIN submissions s ON s.id = sd."submissionId" AND s."deletedAt" IS NULL AND s.draft = FALSE
  JOIN forms f ON f.id = s."formId" AND f."deletedAt" IS NULL JOIN projects p ON p.id = f."projectId" AND p."deletedAt" IS NULL
  WHERE c.id = ${params.challengeId} AND s."instanceId" = ${params.instanceId} AND f.id = ${form.id}
  ${lock ? sql`FOR SHARE OF sd, s, f, p` : sql``}`);
const attachment = (db, row, lock = false) => db.maybeOne(sql`SELECT "blobId" FROM submission_attachments
  WHERE "submissionDefId" = ${row.submissionDefId} AND name = ${row.name} ${lock ? sql`FOR SHARE` : sql``}`);
const isCurrent = (row, file) => row.definitionCurrent === true && row.status === 'bound' && row.blobId != null && row.blobId === file?.blobId;
const image = async (container, row) => {
  if (row.status !== 'bound' || row.blobId == null) throw Problem.user.evidenceBytesMissing();
  const blob = (await container.Blobs.getById(row.blobId)).orNull();
  const bytes = blob == null ? null : await blobContent(container.s3, blob);
  if (!Buffer.isBuffer(bytes)) throw Problem.user.evidenceBytesMissing();
  if (bytes.length > 5 * 1024 * 1024 || createHash('sha256').update(bytes).digest('hex') !== row.contentHash) throw Problem.user.evidenceHashMismatch();
  return bytes;
};
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
