// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { sql } = require('slonik');
const { Form } = require('../model/frames');
const Problem = require('./problem');
const { createHash, timingSafeEqual } = require('node:crypto');
const fail = () => Problem.user.captureChallengeConflict();
const present = (row, includeNonce = false) => ({
  id: row.id, xmlFormId: row.xmlFormId, instanceId: row.instanceId, name: row.name,
  code: row.nonce.slice(0, 8).toUpperCase(), ...(includeNonce ? { nonce: row.nonce } : {}),
  status: row.status, issuedAt: row.issuedAt, expiresAt: row.expiresAt, boundAt: row.boundAt,
  contentHash: row.contentHash, captureLocation: row.captureLocation ?? null, sceneReview: row.assessmentRevision > 0 ? 'assessed' : 'not-assessed'
});
const bindCapture = async (tx, actor, upload, source, bytes, blobId) => {
  const row = await tx.db.maybeOne(sql`SELECT * FROM field_data_capture_challenges WHERE id = ${upload.manifest.challengeId} AND "actorId" = ${actor.id} FOR UPDATE`);
  if (row == null || row.status !== 'issued' || row.submissionDefId !== source.id || row.projectId !== source.projectId ||
    row.xmlFormId !== upload.manifest.xmlFormId || row.instanceId !== upload.manifest.instanceId || row.name !== upload.manifest.name ||
    !timingSafeEqual(Buffer.from(row.nonce), Buffer.from(upload.manifest.challengeNonce))) throw fail();
  if (upload.manifest.contentType === 'image/png' ? !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255 || bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217)
    throw Problem.user.captureChallengeInvalid();
  // Serialize fingerprint acceptance within a project. This detects identical
  // challenged images, not visually similar images or all historic native media.
  await tx.db.query(sql`SELECT pg_advisory_xact_lock(74146, ${source.projectId})`);
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (await tx.db.maybeOne(sql`SELECT id FROM field_data_capture_challenges WHERE "projectId" = ${source.projectId} AND status = 'bound' AND "contentHash" = ${digest}`)) throw fail();
  const updated = await tx.db.maybeOne(sql`UPDATE field_data_capture_challenges SET status = 'bound', "boundAt" = clock_timestamp(),
    "contentHash" = ${digest}, "blobId" = ${blobId}, "uploadId" = ${upload.id},
    "captureLocation" = ${upload.manifest.captureLocation == null ? null : sql.json(upload.manifest.captureLocation)}
    WHERE id = ${row.id} AND "expiresAt" > clock_timestamp() RETURNING id`);
  if (updated == null) throw fail();
  await tx.Audits.log(actor, 'field_data.capture.bound', new Form({ id: source.formId, acteeId: source.acteeId }),
    { challengeId: row.id, submissionDefId: source.id, uploadId: upload.id, contentHash: digest, sceneReview: 'not-assessed' });
};
module.exports = { present, bindCapture };
