// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { sql } = require('slonik');
const { UUID_PATTERN } = require('./claim-versioning');
const Problem = require('./problem');
const { createHash } = require('node:crypto');
const checked = (body, headers) => {
  if (headers['if-match'] == null) throw Problem.user.captureAssessmentRevisionRequired();
  const match = /^"capture-(0|[1-9]\d{0,8})"$/.exec(headers['if-match']);
  if (!match || !body || Object.keys(body).length !== 5 || Object.keys(body).some(k => !['requestId', 'codeAssessment', 'sceneAssessment', 'note', 'reviewedOriginal'].includes(k)) ||
    body.reviewedOriginal !== true || !UUID_PATTERN.test(body.requestId ?? '') || !['visible', 'not-visible', 'unclear'].includes(body.codeAssessment) ||
    !['supports', 'does-not-support', 'unclear'].includes(body.sceneAssessment) || typeof body.note !== 'string' || body.note.length > 2000 ||
    ((body.codeAssessment !== 'visible' || body.sceneAssessment !== 'supports') && !body.note.trim())) throw Problem.user.captureAssessmentInvalid();
  return { ...body, note: body.note.trim(), revision: Number(match[1]) };
};
const requestHash = (data, actorId) => createHash('sha256').update(JSON.stringify({ actorId, revision: data.revision,
  codeAssessment: data.codeAssessment, sceneAssessment: data.sceneAssessment, note: data.note })).digest('hex');
const metadata = row => ({ id: row.id, sequence: row.sequence, reviewerId: row.reviewerId, reviewerName: row.reviewerName,
  codeAssessment: row.codeAssessment, sceneAssessment: row.sceneAssessment, note: row.note,
  reviewedOriginal: row.reviewedOriginal, contentHash: row.contentHash, reviewedAt: row.reviewedAt });
const history = async (db, challengeId, before = 2147483647) => {
  const rows = await db.any(sql`SELECT *, count(*) OVER ()::integer AS total FROM field_data_capture_assessments
    WHERE "challengeId" = ${challengeId} AND sequence < ${before} ORDER BY sequence DESC LIMIT 10`);
  const omitted = Math.max(0, (rows[0]?.total ?? 0) - rows.length);
  return { items: rows.map(metadata), omitted, nextBefore: omitted > 0 ? rows[rows.length - 1].sequence : null };
};
// Follow Central's inherited form/project/species assignments, and hold the
// actual write grant and reviewer identity while committing an assessment.
const lockReviewer = async (tx, actorId, form) => {
  const actor = await tx.db.maybeOne(sql`SELECT id, "displayName" FROM actors WHERE id = ${actorId} AND type = 'user' AND "deletedAt" IS NULL FOR SHARE`);
  if (!actor) throw Problem.user.notFound();
  const grant = await tx.db.maybeOne(sql`WITH RECURSIVE implied(id) AS (
    (SELECT ${form.acteeId}::varchar) UNION (SELECT unnest(ARRAY[parent, species]) FROM actees JOIN implied ON implied.id = actees.id))
    SELECT ass."actorId" FROM assignments ass JOIN implied ON implied.id = ass."acteeId" JOIN roles r ON r.id = ass."roleId"
    WHERE ass."actorId" = ${actorId} AND r.verbs ? 'submission.update' LIMIT 1 FOR SHARE OF ass, r`);
  if (!grant) throw Problem.user.notFound();
  return actor;
};
module.exports = { checked, requestHash, metadata, history, lockReviewer };
