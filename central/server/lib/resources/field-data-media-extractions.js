// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { randomUUID } = require('node:crypto');
const { sql } = require('slonik');
const { Form } = require('../model/frames');
const { getOrNotFound } = require('../util/promise');
const { UUID_PATTERN } = require('../util/claim-versioning');
const { blobContent } = require('../util/blob');
const { lockReviewer } = require('../util/capture-assessments');
const media = require('../util/media-extraction');
const Problem = require('../util/problem');
const conflict = () => Problem.user.mediaExtractionConflict();
const scope = async (c, auth, params, write = false) => {
  const form = await c.Forms.getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.WithoutDef, Form.WithoutXml).then(getOrNotFound);
  try { await auth.canOrReject('submission.read', form); if (write) await auth.canOrReject('submission.update', form); } catch (error) {
    if (error?.problemCode === Problem.user.insufficientRights.code) throw Problem.user.notFound(); throw error;
  }
  if (write && auth.actor.orNull()?.type !== 'user') throw Problem.user.notFound();
  await c.Submissions.getByIds(params.projectId, params.xmlFormId, params.instanceId, false).then(getOrNotFound);
  return form;
};
const permissionLock = async (tx, id, form) => {
  const actor = await lockReviewer(tx, id, form);
  const read = await tx.db.maybeOne(sql`WITH RECURSIVE implied(id) AS (
    (SELECT ${form.acteeId}::varchar) UNION (SELECT unnest(ARRAY[parent, species]) FROM actees JOIN implied ON implied.id = actees.id))
    SELECT ass."actorId" FROM assignments ass JOIN implied ON implied.id = ass."acteeId" JOIN roles r ON r.id = ass."roleId"
    WHERE ass."actorId" = ${id} AND r.verbs ? 'submission.read' LIMIT 1 FOR SHARE OF ass, r`);
  if (!read) throw Problem.user.notFound(); return actor;
};
const source = (db, form, params, defId = null, lock = false) => db.maybeOne(sql`SELECT sd.id, sd.current, s.id AS "submissionId", p.archived, fd."keyId"
  FROM submission_defs sd JOIN submissions s ON s.id = sd."submissionId" AND s."deletedAt" IS NULL AND s.draft = FALSE
  JOIN forms f ON f.id = s."formId" AND f."deletedAt" IS NULL JOIN projects p ON p.id = f."projectId" AND p."deletedAt" IS NULL
  JOIN form_defs fd ON fd.id = sd."formDefId"
  WHERE f.id = ${form.id} AND s."instanceId" = ${params.instanceId} AND ${defId == null ? sql`sd.current` : sql`sd.id = ${defId}`}
  ${lock ? sql`FOR SHARE OF sd, f, p FOR UPDATE OF s` : sql``}`);
const attachment = (db, row, name, lock = false) => db.maybeOne(sql`SELECT sa."blobId", b."contentType" FROM submission_attachments sa
  LEFT JOIN blobs b ON b.id = sa."blobId" WHERE sa."submissionDefId" = ${row.id} AND sa.name = ${name} ${lock ? sql`FOR SHARE OF sa` : sql``}`);
const bytesFor = async (c, row) => {
  if (row.blobId == null) throw Problem.user.evidenceBytesMissing();
  const blob = (await c.Blobs.getById(row.blobId)).orNull();
  const bytes = blob && await blobContent(c.s3, blob);
  if (!media.validBytes(bytes, row.contentType)) throw Problem.user.mediaExtractionInvalid();
  if (row.contentHash && media.hash(bytes) !== row.contentHash) throw Problem.user.evidenceHashMismatch();
  return bytes;
};
const record = async (db, form, params, id) => {
  if (!UUID_PATTERN.test(id ?? '')) throw Problem.user.notFound();
  const row = await db.maybeOne(sql`SELECT e.* FROM field_data_media_extractions e JOIN submission_defs sd ON sd.id = e."submissionDefId"
    JOIN submissions s ON s.id = sd."submissionId" WHERE e.id = ${id} AND s."formId" = ${form.id} AND s."instanceId" = ${params.instanceId}`);
  if (!row) throw Problem.user.notFound(); return row;
};
const present = async (db, row) => {
  const bindingCurrent = await db.oneFirst(sql`SELECT EXISTS (SELECT 1 FROM submission_defs sd JOIN submission_attachments sa
    ON sa."submissionDefId" = sd.id WHERE sd.id = ${row.submissionDefId} AND sd.current AND sa.name = ${row.name} AND sa."blobId" = ${row.blobId})`);
  const reviews = await db.any(sql`SELECT id, sequence, action, text, reason, "actorId", "actorName", "reviewedAt"
    FROM field_data_media_extraction_reviews WHERE "extractionId" = ${row.id} ORDER BY sequence`);
  const interrupted = row.status === 'processing' && Date.now() - Date.parse(row.requestedAt) >= 120000;
  return { id: row.id, name: row.name, submissionDefId: row.submissionDefId, contentHash: row.contentHash, contentType: row.contentType,
    kind: row.kind, provider: 'OpenAI', model: row.model, actorId: row.actorId, actorName: row.actorName, requestedAt: row.requestedAt,
    finishedAt: row.finishedAt, status: interrupted ? 'interrupted' : row.status, failure: row.failure, proposal: row.proposal,
    bindingCurrent, revision: reviews.length, reviews, decision: !bindingCurrent ? 'outdated' : reviews.at(-1)?.action ?? 'unreviewed' };
};
module.exports = (service, endpoint) => {
  const root = '/projects/:projectId/forms/:xmlFormId/submissions/:instanceId/media-extractions';
  service.get(root, endpoint(async (c, { auth, params }, _, response) => {
    const form = await scope(c, auth, params); const current = await source(c.db, form, params); if (!current) throw Problem.user.notFound();
    const files = current.keyId != null ? [] : await c.db.any(sql`SELECT sa.name, b."contentType" FROM submission_attachments sa JOIN blobs b ON b.id = sa."blobId"
      WHERE sa."submissionDefId" = ${current.id} ORDER BY sa.name LIMIT 101`);
    const rows = await c.db.any(sql`SELECT e.* FROM field_data_media_extractions e JOIN submission_defs sd ON sd.id = e."submissionDefId"
      WHERE sd."submissionId" = ${current.submissionId} ORDER BY e."requestedAt" DESC, e.id LIMIT 20`);
    const items = await Promise.all(rows.map(row => present(c.db, row)));
    const canWrite = auth.actor.orNull()?.type === 'user' && (await auth.verbsOn(form)).includes('submission.update');
    response.set('Cache-Control', 'private, no-store');
    return { enabled: media.setup().enabled, canRequest: canWrite && !current.archived && current.keyId == null && rows.length < 20,
      canReview: canWrite, media: files.slice(0, 100).filter(file => media.types[file.contentType]).map(file => ({ ...file, kind: media.types[file.contentType] })),
      mediaOmitted: Math.max(0, files.length - 100), items };
  }));
  service.post(root, endpoint(async (c, { auth, params, body }, _, response) => {
    const form = await scope(c, auth, params, true); const data = media.checked(body); const actor = auth.actor.get();
    const digest = media.hash({ actorId: actor.id, name: data.name, allowExternalProcessing: true });
    const reservation = await c.transacting(async tx => {
      const reviewer = await permissionLock(tx, actor.id, form); const target = await source(tx.db, form, params, null, true);
      if (!target) throw Problem.user.notFound();
      const prior = await tx.db.maybeOne(sql`SELECT e.* FROM field_data_media_extractions e JOIN submission_defs sd ON sd.id = e."submissionDefId"
        WHERE sd."submissionId" = ${target.submissionId} AND e."requestId" = ${data.requestId}`);
      if (prior) { if (prior.requestHash !== digest) throw conflict(); return { row: prior, replayed: true }; }
      const config = media.setup(); if (!config.enabled) throw Problem.internal.mediaExtractionNotConfigured();
      if (target.archived || target.keyId != null) throw conflict();
      const count = await tx.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_media_extractions e JOIN submission_defs sd ON sd.id = e."submissionDefId" WHERE sd."submissionId" = ${target.submissionId}`);
      if (count >= 20) throw conflict();
      const file = await attachment(tx.db, target, data.name, true); if (!file?.blobId) throw Problem.user.notFound();
      const kind = media.types[file.contentType]; if (!kind) throw Problem.user.mediaExtractionInvalid();
      const bytes = await bytesFor(tx, file); const model = kind === 'photo' ? config.photoModel : config.audioModel;
      if (!/^[a-zA-Z0-9._:-]{1,100}$/.test(model)) throw Problem.internal.mediaExtractionNotConfigured();
      const row = await tx.db.one(sql`INSERT INTO field_data_media_extractions
        (id, "submissionDefId", name, "blobId", "contentHash", "contentType", kind, model, "requestId", "requestHash", "actorId", "actorName")
        VALUES (${randomUUID()}, ${target.id}, ${data.name}, ${file.blobId}, ${media.hash(bytes)}, ${file.contentType}, ${kind}, ${model}, ${data.requestId}, ${digest}, ${actor.id}, ${reviewer.displayName}) RETURNING *`);
      await tx.Audits.log(actor, 'field_data.media.extraction.requested', form, { extractionId: row.id, contentHash: row.contentHash, model, externalProcessingAllowed: true });
      return { row, bytes, replayed: false };
    });
    let { row } = reservation;
    if (!reservation.replayed) {
      const output = await media.extract({ ...row, bytes: reservation.bytes });
      row = await c.transacting(async tx => {
        await permissionLock(tx, actor.id, form);
        if (!await source(tx.db, form, params, row.submissionDefId, true)) throw Problem.user.notFound();
        const saved = await tx.db.maybeOne(sql`UPDATE field_data_media_extractions SET status = ${output.ok ? 'ready' : 'failed'},
          proposal = ${output.ok ? output.text : null}, failure = ${output.ok ? null : output.reason}, "finishedAt" = clock_timestamp()
          WHERE id = ${row.id} AND status = 'processing' AND "requestedAt" > clock_timestamp() - interval '2 minutes' RETURNING *`);
        if (!saved) return row;
        await tx.Audits.log(actor, 'field_data.media.extraction.finished', form, { extractionId: row.id, status: saved.status }); return saved;
      });
    }
    response.set('Cache-Control', 'private, no-store'); response.set('Idempotency-Status', reservation.replayed ? 'replayed' : 'created');
    return { item: await present(c.db, row), replayed: reservation.replayed };
  }));
  service.get(`${root}/:extractionId/source`, endpoint(async (c, { auth, params }, _, response) => {
    const form = await scope(c, auth, params); const row = await record(c.db, form, params, params.extractionId);
    if (!await source(c.db, form, params, row.submissionDefId)) throw Problem.user.notFound();
    const bytes = await bytesFor(c, row);
    await c.Audits.log(auth.actor, 'field_data.media.extraction.source.read', form, { extractionId: row.id, contentHash: row.contentHash });
    response.set('Cache-Control', 'private, no-store'); response.set('Content-Type', row.contentType); response.set('Content-Disposition', 'attachment'); return bytes;
  }));
  service.post(`${root}/:extractionId/reviews`, endpoint(async (c, { auth, params, body }, _, response) => {
    const form = await scope(c, auth, params, true); const actor = auth.actor.get(); const data = media.checkedReview(body);
    const digest = media.hash({ actorId: actor.id, requestId: data.requestId, revision: data.revision, action: data.action, text: data.text, reason: data.reason, reviewedOriginal: true });
    const result = await c.transacting(async tx => {
      const reviewer = await permissionLock(tx, actor.id, form); const initial = await record(tx.db, form, params, params.extractionId);
      const target = await source(tx.db, form, params, initial.submissionDefId, true); if (!target) throw Problem.user.notFound();
      const file = await attachment(tx.db, target, initial.name, true);
      const row = await tx.db.one(sql`SELECT * FROM field_data_media_extractions WHERE id = ${initial.id} FOR UPDATE`);
      const prior = await tx.db.maybeOne(sql`SELECT "requestHash" FROM field_data_media_extraction_reviews WHERE "extractionId" = ${row.id} AND "requestId" = ${data.requestId}`);
      if (prior) { if (prior.requestHash !== digest) throw conflict(); return { item: await present(tx.db, row), replayed: true }; }
      const state = await present(tx.db, row);
      if (row.status !== 'ready' || state.revision !== data.revision || state.revision >= 20 ||
          (data.action === 'approve' && (!target.current || target.archived || file?.blobId !== row.blobId || row.blobId == null))) throw conflict();
      await bytesFor(tx, row);
      await tx.db.query(sql`INSERT INTO field_data_media_extraction_reviews (id, "extractionId", sequence, action, text, reason, "actorId", "actorName", "requestId", "requestHash")
        VALUES (${randomUUID()}, ${row.id}, ${state.revision + 1}, ${data.action}, ${data.text}, ${data.reason}, ${actor.id}, ${reviewer.displayName}, ${data.requestId}, ${digest})`);
      await tx.Audits.log(actor, 'field_data.media.extraction.reviewed', form, { extractionId: row.id, sequence: state.revision + 1, action: data.action });
      return { item: await present(tx.db, row), replayed: false };
    });
    response.set('Cache-Control', 'private, no-store'); response.set('Idempotency-Status', result.replayed ? 'replayed' : 'created'); return result;
  }));
};
