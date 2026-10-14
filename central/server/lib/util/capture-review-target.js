// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { createHash } = require('node:crypto');
const { sql } = require('slonik');
const { Form } = require('../model/frames');
const { blobContent } = require('./blob');
const { getOrNotFound } = require('./promise');
const { UUID_PATTERN } = require('./claim-versioning');
const Problem = require('./problem');
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
module.exports = { scope, source, attachment, isCurrent, image };
