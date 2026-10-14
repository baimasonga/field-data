/* eslint-disable no-await-in-loop */
// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { createHash } = require('node:crypto');
const { sql } = require('slonik');
const { Blob, Form } = require('../model/frames');
const { blobContent } = require('../util/blob');
const Problem = require('../util/problem');
const { UUID_PATTERN } = require('../util/claim-versioning');
const CHUNK = 262144; const MAX_FILE = 20 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const invalid = () => Problem.user.mediaUploadInvalid();
const conflict = () => Problem.user.mediaUploadConflict();
const manifestFor = body => {
  const keys = ['id', 'xmlFormId', 'instanceId', 'name', 'size', 'sha256', 'contentType', 'priority'];
  const text = (s, max) => typeof s === 'string' && s.length > 0 && s.length <= max && !Array.from(s).some(c => c.charCodeAt(0) < 32);
  if (body == null || Object.keys(body).some(k => !keys.includes(k)) || !UUID_PATTERN.test(body.id ?? '')
    || !text(body.xmlFormId, 1000) || !text(body.instanceId, 1000) || !text(body.name, 255) || /[/\\]/.test(body.name)
    || !Number.isSafeInteger(body.size) || body.size < 1 || body.size > MAX_FILE || !/^[a-f0-9]{64}$/.test(body.sha256 ?? '')
    || !text(body.contentType, 150) || !/^(?:image|audio|video)\/[a-zA-Z0-9.+-]+$|^application\/octet-stream$/.test(body.contentType)
    || ![1, 2, 3].includes(body.priority)) throw invalid();
  return Object.fromEntries(keys.map(k => [k, body[k]]));
};
const identity = async auth => {
  const actor = auth.actor.orNull();
  if (actor?.type !== 'field_key') throw Problem.user.insufficientRights();
  return actor;
};
const present = row => ({ ...row.manifest, offset: row.offset, status: row.status, expiresAt: row.expiresAt, chunkSize: CHUNK });
// Match the existing attachment endpoint's create-only rule: the App User's
// unedited current root submission, an expected attachment, and no overwrite.
const target = async (tx, actor, manifest, existing, lockAttachment = false) => {
  const row = await tx.db.maybeOne(sql`SELECT sd.id, f.id AS "formId", f."acteeId", f."projectId"
    FROM field_keys fk JOIN actors a ON a.id = fk."actorId" AND a."deletedAt" IS NULL
    JOIN projects p ON p.id = fk."projectId" AND p."deletedAt" IS NULL AND p.archived IS NOT TRUE
    JOIN forms f ON f."projectId" = p.id AND f."xmlFormId" = ${manifest.xmlFormId} AND f."deletedAt" IS NULL AND f.state = 'open'
    JOIN submissions s ON s."formId" = f.id AND s."instanceId" = ${manifest.instanceId} AND s."deletedAt" IS NULL AND s.draft = FALSE
    JOIN submission_defs sd ON sd."submissionId" = s.id AND sd.current AND sd.root AND sd."submitterId" = ${actor.id}
    WHERE fk."actorId" = ${actor.id} AND EXISTS (SELECT 1 FROM assignments ass JOIN roles r ON r.id = ass."roleId"
      WHERE ass."actorId" = ${actor.id} AND ass."acteeId" = f."acteeId" AND r.verbs ? 'submission.create')
    FOR SHARE OF fk, a, p, f, s, sd`);
  if (row == null) throw Problem.user.notFound();
  // Hold a live grant while accepting a chunk or finalizing its attachment.
  const grant = await tx.db.maybeOne(sql`SELECT ass."actorId" FROM assignments ass JOIN roles r ON r.id = ass."roleId"
    WHERE ass."actorId" = ${actor.id} AND ass."acteeId" = ${row.acteeId} AND r.verbs ? 'submission.create'
    LIMIT 1 FOR SHARE OF ass, r`);
  if (grant == null) throw Problem.user.notFound();
  if (existing != null && (existing.submissionDefId !== row.id || existing.projectId !== row.projectId)) throw conflict();
  const attachment = await tx.db.maybeOne(sql`SELECT "blobId" FROM submission_attachments
    WHERE "submissionDefId" = ${row.id} AND name = ${manifest.name} ${lockAttachment ? sql`FOR UPDATE` : sql``}`);
  if (attachment == null) throw Problem.user.notFound();
  if (existing?.status === 'completed' && (existing.blobId == null || attachment.blobId !== existing.blobId)) throw conflict();
  if (attachment.blobId != null && attachment.blobId !== existing?.blobId) throw conflict();
  return { ...row, attachmentBlobId: attachment.blobId };
};
const load = async (tx, actor, id) => {
  if (!UUID_PATTERN.test(id ?? '')) throw Problem.user.notFound();
  const row = await tx.db.maybeOne(sql`SELECT * FROM field_data_media_uploads
    WHERE id = ${id} AND "actorId" = ${actor.id} AND "expiresAt" > clock_timestamp() FOR UPDATE`);
  if (row == null) throw Problem.user.notFound();
  await target(tx, actor, row.manifest, row);
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
module.exports = (service, endpoint) => {
  const root = '/field-data/app-user/media-uploads';
  service.post(root, endpoint(async (container, { auth, body }, _, response) => {
    const actor = await identity(auth); const manifest = manifestFor(body);
    const result = await container.transacting(async tx => {
      // Serialize quota reservation globally, without holding a lock while bytes arrive.
      await tx.db.query(sql`SELECT pg_advisory_xact_lock(74144)`);
      await tx.db.query(sql`DELETE FROM field_data_media_uploads WHERE "expiresAt" <= clock_timestamp()`);
      const existing = await tx.db.maybeOne(sql`SELECT * FROM field_data_media_uploads WHERE id = ${manifest.id} FOR UPDATE`);
      if (existing != null) {
        if (existing.actorId !== actor.id) throw Problem.user.notFound();
        if (JSON.stringify(manifest) !== JSON.stringify(manifestFor(existing.manifest))) throw conflict();
        await target(tx, actor, manifest, existing); return present(existing);
      }
      const source = await target(tx, actor, manifest);
      const stats = await tx.db.one(sql`SELECT count(*) FILTER (WHERE "actorId" = ${actor.id})::integer AS count,
        COALESCE(sum((manifest->>'size')::bigint) FILTER (WHERE "actorId" = ${actor.id}), 0)::bigint AS own,
        COALESCE(sum((manifest->>'size')::bigint), 0)::bigint AS total FROM field_data_media_uploads WHERE status = 'pending'`);
      if (stats.count >= 10 || Number(stats.own) + manifest.size > 100 * 1024 * 1024 || Number(stats.total) + manifest.size > 256 * 1024 * 1024)
        throw Problem.user.mediaUploadQuota();
      const row = await tx.db.one(sql`INSERT INTO field_data_media_uploads (id, "actorId", "projectId", "submissionDefId", manifest)
        VALUES (${manifest.id}, ${actor.id}, ${source.projectId}, ${source.id}, ${JSON.stringify(manifest)}) RETURNING *`);
      await tx.Audits.log(auth.actor, 'field_data.media.upload.start', new Form({ id: source.formId, acteeId: source.acteeId }),
        { uploadId: row.id, submissionDefId: source.id, name: manifest.name, size: manifest.size, sha256: manifest.sha256 });
      return present(row);
    });
    response.set('Cache-Control', 'private, no-store'); return result;
  }));
  service.get(root, endpoint(async (container, { auth }, _, response) => {
    const actor = await identity(auth);
    const rows = await container.db.any(sql`SELECT id FROM field_data_media_uploads WHERE "actorId" = ${actor.id}
      AND "expiresAt" > clock_timestamp() ORDER BY status DESC, (manifest->>'priority')::integer, "createdAt" DESC LIMIT 50`);
    const items = [];
    for (const row of rows) {
      try { items.push(await container.transacting(async tx => present(await load(tx, actor, row.id)))); } catch (error) {
        if (![Problem.user.notFound.code, Problem.user.insufficientRights.code, Problem.user.mediaUploadConflict.code].includes(error?.problemCode)) throw error;
      }
    }
    response.set('Cache-Control', 'private, no-store'); return { items };
  }));
  service.get(`${root}/:id`, endpoint(async (container, { auth, params }, _, response) => {
    const actor = await identity(auth);
    const result = await container.transacting(async tx => present(await load(tx, actor, params.id)));
    response.set('Cache-Control', 'private, no-store'); return result;
  }));
  service.put(`${root}/:id/chunks/:offset`, endpoint(async (container, { auth, params, headers }, request, response) => {
    const actor = await identity(auth);
    if (!/^(0|[1-9]\d{0,8})$/.test(params.offset) || !/^[a-f0-9]{64}$/.test(headers['x-chunk-sha256'] ?? '')) throw invalid();
    const bytes = await chunkBytes(request); const digest = hash(bytes);
    if (digest !== headers['x-chunk-sha256']) throw invalid();
    const at = Number(params.offset);
    const result = await container.transacting(async tx => {
      const row = await load(tx, actor, params.id);
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
    });
    response.set('Cache-Control', 'private, no-store'); return result;
  }));
  service.post(`${root}/:id/complete`, endpoint(async (container, { auth, params }, _, response) => {
    const actor = await identity(auth);
    const result = await container.transacting(async tx => {
      // Bound memory during whole-file assembly and storage verification.
      await tx.db.query(sql`SELECT pg_advisory_xact_lock(74145)`);
      const row = await load(tx, actor, params.id);
      if (row.status === 'completed') return present(row);
      if (row.offset !== row.manifest.size) throw conflict();
      const chunks = await tx.db.any(sql`SELECT bytes FROM field_data_media_upload_chunks WHERE "uploadId" = ${row.id} ORDER BY "offset"`);
      const bytes = Buffer.concat(chunks.map(chunk => chunk.bytes));
      if (bytes.length !== row.manifest.size || hash(bytes) !== row.manifest.sha256) throw invalid();
      const blobId = await tx.Blobs.ensure(Blob.fromBuffer(bytes, row.manifest.contentType));
      const storedBlob = (await tx.Blobs.getById(blobId)).orNull();
      const storedBytes = storedBlob == null ? null : await blobContent(tx.s3, storedBlob);
      if (!Buffer.isBuffer(storedBytes) || storedBytes.length !== bytes.length || hash(storedBytes) !== row.manifest.sha256) throw invalid();
      const source = await target(tx, actor, row.manifest, { ...row, blobId }, true);
      if (source.attachmentBlobId == null) {
        await tx.SubmissionAttachments.attach(row.submissionDefId, row.manifest.name, blobId);
        await tx.Audits.log(auth.actor, 'submission.attachment.update', new Form({ id: source.formId, acteeId: source.acteeId }),
          { instanceId: row.manifest.instanceId, submissionDefId: row.submissionDefId, name: row.manifest.name, oldBlobId: null, newBlobId: blobId,
            uploadId: row.id, sha256: row.manifest.sha256 });
      }
      await tx.Audits.log(auth.actor, 'field_data.media.upload.complete', new Form({ id: source.formId, acteeId: source.acteeId }),
        { uploadId: row.id, submissionDefId: row.submissionDefId, sha256: row.manifest.sha256, alreadyAttached: source.attachmentBlobId != null });
      await tx.db.query(sql`DELETE FROM field_data_media_upload_chunks WHERE "uploadId" = ${row.id}`);
      return present(await tx.db.one(sql`UPDATE field_data_media_uploads SET status = 'completed', "blobId" = ${blobId} WHERE id = ${row.id} RETURNING *`));
    });
    response.set('Cache-Control', 'private, no-store'); return result;
  }));
  service.delete(`${root}/:id`, endpoint(async (container, { auth, params }) => {
    const actor = await identity(auth);
    return container.transacting(async tx => {
      if (!UUID_PATTERN.test(params.id ?? '')) throw Problem.user.notFound();
      const row = await tx.db.maybeOne(sql`SELECT * FROM field_data_media_uploads WHERE id = ${params.id} AND "actorId" = ${actor.id} FOR UPDATE`);
      if (row == null) throw Problem.user.notFound();
      if (row.status !== 'pending') throw conflict();
      await tx.db.query(sql`DELETE FROM field_data_media_uploads WHERE id = ${row.id}`);
      await tx.Audits.log(auth.actor, 'field_data.media.upload.cancel', null, { uploadId: row.id, projectId: row.projectId });
      return { cancelled: true };
    });
  }));
};
