// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { createHash } = require('node:crypto');
const { sql } = require('slonik');
const { Blob, Form } = require('../model/frames');
const { blobContent } = require('./blob');
const Problem = require('./problem');
const { UUID_PATTERN } = require('./claim-versioning');
const target = require('./media-upload-target');
const courier = require('./media-couriers');
const { bindCapture } = require('./capture-challenges');
const CHUNK = 262144;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const invalid = () => Problem.user.mediaUploadInvalid();
const conflict = () => Problem.user.mediaUploadConflict();
const present = row => ({ ...row.manifest, ownerId: row.actorId, offset: row.offset, status: row.status, expiresAt: row.expiresAt, chunkSize: CHUNK });
const load = async (tx, actor, id) => {
  if (!UUID_PATTERN.test(id ?? '')) throw Problem.user.notFound();
  const row = await tx.db.maybeOne(sql`SELECT * FROM field_data_media_uploads
    WHERE id = ${id} AND ("actorId" = ${actor.id} OR EXISTS(SELECT 1 FROM field_data_media_couriers g WHERE g."uploadId"=field_data_media_uploads.id AND g."courierId"=${actor.id})) AND "expiresAt" > clock_timestamp() FOR UPDATE`);
  if (row == null) throw Problem.user.notFound();
  await courier.authorize(tx, actor, row);
  await target(tx, { id: row.actorId }, row.manifest, row);
  return row;
};
const chunkBytes = async request => {
  if (request.headers['content-type'] !== 'application/octet-stream') throw invalid();
  if (Number(request.headers['content-length']) > CHUNK) { request.resume(); throw invalid(); }
  const chunks = []; let size = 0;
  for await (const bytes of request) {
    size += bytes.length;
    if (size > CHUNK) throw invalid();
    chunks.push(bytes);
  }
  if (size < 1) throw invalid();
  return Buffer.concat(chunks);
};
const putChunk = async (tx, actor, id, at, bytes, digest) => {
  const row = await load(tx, actor, id);
  if (row.status !== 'pending') throw conflict();
  if (at > row.offset || at % CHUNK !== 0 || bytes.length !== Math.min(CHUNK, row.manifest.size - at)) throw conflict();
  if (at < row.offset) {
    const previous = await tx.db.maybeOne(sql`SELECT hash FROM field_data_media_upload_chunks WHERE "uploadId" = ${row.id} AND "offset" = ${at}`);
    if (previous?.hash !== digest) throw conflict();
    return present(row);
  }
  await tx.db.query(sql`INSERT INTO field_data_media_upload_chunks ("uploadId", "offset", hash, bytes)
        VALUES (${row.id}, ${at}, ${digest}, ${sql.binary(bytes)})`);
  const updated = await tx.db.one(sql`UPDATE field_data_media_uploads SET "offset" = "offset" + ${bytes.length} WHERE id = ${row.id} RETURNING *`);
  return present(updated);
};
const complete = async (tx, actor, id, auditActor, transport = {}) => {
  // Bound memory during whole-file assembly and storage verification.
  await tx.db.query(sql`SELECT pg_advisory_xact_lock(74145)`);
  const row = await load(tx, actor, id);
  if (row.status === 'completed') return present(row);
  if (row.offset !== row.manifest.size) throw conflict();
  const chunks = await tx.db.any(sql`SELECT bytes FROM field_data_media_upload_chunks WHERE "uploadId" = ${row.id} ORDER BY "offset"`);
  const bytes = Buffer.concat(chunks.map(chunk => chunk.bytes));
  if (bytes.length !== row.manifest.size || hash(bytes) !== row.manifest.sha256) throw invalid();
  const blobId = await tx.Blobs.ensure(Blob.fromBuffer(bytes, row.manifest.contentType));
  const storedBlob = (await tx.Blobs.getById(blobId)).orNull();
  const storedBytes = storedBlob == null ? null : await blobContent(tx.s3, storedBlob);
  if (!Buffer.isBuffer(storedBytes) || storedBytes.length !== bytes.length || hash(storedBytes) !== row.manifest.sha256) throw invalid();
  const source = await target(tx, { id: row.actorId }, row.manifest, { ...row, blobId }, true);
  await courier.delivery(tx, actor, row, blobId, transport);
  if (row.manifest.challengeId != null) await bindCapture(tx, actor, row, source, bytes, blobId);
  if (source.attachmentBlobId == null) {
    await tx.SubmissionAttachments.attach(row.submissionDefId, row.manifest.name, blobId);
    await tx.Audits.log(auditActor, 'submission.attachment.update', new Form({ id: source.formId, acteeId: source.acteeId }),
      { instanceId: row.manifest.instanceId, submissionDefId: row.submissionDefId, name: row.manifest.name, oldBlobId: null, newBlobId: blobId,
        uploadId: row.id, sha256: row.manifest.sha256, ...transport });
  }
  await tx.Audits.log(auditActor, 'field_data.media.upload.complete', new Form({ id: source.formId, acteeId: source.acteeId }),
    { uploadId: row.id, submissionDefId: row.submissionDefId, sha256: row.manifest.sha256, alreadyAttached: source.attachmentBlobId != null, ownerId: row.actorId, transportedBy: actor.id, ...transport });
  await tx.db.query(sql`DELETE FROM field_data_media_upload_chunks WHERE "uploadId" = ${row.id}`);
  return present(await tx.db.one(sql`UPDATE field_data_media_uploads SET status = 'completed', "blobId" = ${blobId} WHERE id = ${row.id} RETURNING *`));
};
module.exports = { CHUNK, present, load, chunkBytes, putChunk, complete };
