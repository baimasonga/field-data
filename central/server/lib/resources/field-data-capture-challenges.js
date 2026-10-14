/* eslint-disable no-await-in-loop */
// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { randomBytes } = require('node:crypto');
const { sql } = require('slonik');
const { Form } = require('../model/frames');
const { getOrNotFound } = require('../util/promise');
const { UUID_PATTERN } = require('../util/claim-versioning');
const { present } = require('../util/capture-challenges');
const target = require('../util/media-upload-target');
const Problem = require('../util/problem');
const actorFor = auth => {
  const actor = auth.actor.orNull();
  if (actor?.type !== 'field_key') throw Problem.user.insufficientRights();
  return actor;
};
const checked = body => {
  const keys = ['id', 'xmlFormId', 'instanceId', 'name'];
  const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && !Array.from(value).some(c => c.charCodeAt(0) < 32);
  if (body == null || Object.keys(body).length !== keys.length || Object.keys(body).some(k => !keys.includes(k)) || !UUID_PATTERN.test(body.id ?? '') ||
    !text(body.xmlFormId, 1000) || !text(body.instanceId, 1000) || !text(body.name, 255) || /[/\\]/.test(body.name)) throw Problem.user.captureChallengeInvalid();
  return body;
};
const sourceFor = (tx, actor, row) => target(tx, actor, row, { ...row, status: row.status === 'bound' ? 'completed' : row.status });
module.exports = (service, endpoint) => {
  const root = '/field-data/app-user/capture-challenges';
  service.post(root, endpoint(async (container, { auth, body }, _, response) => {
    const actor = actorFor(auth); const manifest = checked(body);
    const result = await container.transacting(async tx => {
      await tx.db.query(sql`SELECT pg_advisory_xact_lock(74147)`);
      const previous = await tx.db.maybeOne(sql`SELECT *, "expiresAt" > clock_timestamp() AS active FROM field_data_capture_challenges WHERE id = ${manifest.id} FOR UPDATE`);
      if (previous != null) {
        if (previous.actorId !== actor.id) throw Problem.user.notFound();
        if (['xmlFormId', 'instanceId', 'name'].some(key => previous[key] !== manifest[key]) || previous.status === 'cancelled' || (previous.status === 'issued' && !previous.active)) throw Problem.user.captureChallengeConflict();
        await sourceFor(tx, actor, previous); return present(previous, true);
      }
      await tx.db.query(sql`UPDATE field_data_capture_challenges SET status = 'cancelled' WHERE status = 'issued' AND "expiresAt" <= clock_timestamp()`);
      await tx.db.query(sql`DELETE FROM field_data_capture_challenges WHERE status = 'cancelled' AND "issuedAt" < clock_timestamp() - interval '24 hours'`);
      const source = await target(tx, actor, manifest);
      const counts = await tx.db.one(sql`SELECT count(*) FILTER (WHERE "actorId" = ${actor.id} AND status = 'issued')::integer AS own,
        count(*) FILTER (WHERE status = 'issued')::integer AS active,
        count(*) FILTER (WHERE "actorId" = ${actor.id} AND "issuedAt" > clock_timestamp() - interval '24 hours')::integer AS daily,
        count(*) FILTER (WHERE "issuedAt" > clock_timestamp() - interval '24 hours')::integer AS total FROM field_data_capture_challenges WHERE "issuedAt" > clock_timestamp() - interval '24 hours'`);
      if (counts.own >= 20 || counts.active >= 1000 || counts.daily >= 100 || counts.total >= 10000) throw Problem.user.captureChallengeConflict();
      if (await tx.db.maybeOne(sql`SELECT id FROM field_data_capture_challenges WHERE "submissionDefId" = ${source.id} AND name = ${manifest.name} AND status = 'issued'`)) throw Problem.user.captureChallengeConflict();
      const row = await tx.db.one(sql`INSERT INTO field_data_capture_challenges (id, "actorId", "projectId", "submissionDefId", "xmlFormId", "instanceId", name, nonce)
        VALUES (${manifest.id}, ${actor.id}, ${source.projectId}, ${source.id}, ${manifest.xmlFormId}, ${manifest.instanceId}, ${manifest.name}, ${randomBytes(32).toString('hex')}) RETURNING *`);
      await tx.Audits.log(actor, 'field_data.capture.issued', new Form({ id: source.formId, acteeId: source.acteeId }),
        { challengeId: row.id, submissionDefId: source.id, name: row.name, expiresAt: row.expiresAt });
      return present(row, true);
    });
    response.set('Cache-Control', 'private, no-store'); return result;
  }));
  service.get(root, endpoint(async (container, { auth }, _, response) => {
    const actor = actorFor(auth);
    const rows = await container.db.any(sql`SELECT * FROM field_data_capture_challenges WHERE "actorId" = ${actor.id}
      AND (status = 'bound' OR (status = 'issued' AND "expiresAt" > clock_timestamp())) ORDER BY "issuedAt" DESC LIMIT 20`);
    const items = [];
    for (const row of rows) {
      try { await container.transacting(tx => sourceFor(tx, actor, row)); items.push(present(row, true)); } catch (error) {
        if (![Problem.user.notFound.code, Problem.user.mediaUploadConflict.code].includes(error?.problemCode)) throw error;
      }
    }
    response.set('Cache-Control', 'private, no-store'); return { items };
  }));
  service.delete(`${root}/:id`, endpoint(async (container, { auth, params }) => {
    const actor = actorFor(auth);
    if (!UUID_PATTERN.test(params.id ?? '')) throw Problem.user.notFound();
    return container.transacting(async tx => {
      const row = await tx.db.maybeOne(sql`SELECT * FROM field_data_capture_challenges WHERE id = ${params.id} AND "actorId" = ${actor.id} FOR UPDATE`);
      if (row == null) throw Problem.user.notFound();
      if (row.status === 'bound') throw Problem.user.captureChallengeConflict();
      if (row.status !== 'cancelled') {
        await tx.db.query(sql`UPDATE field_data_capture_challenges SET status = 'cancelled' WHERE id = ${row.id}`);
        await tx.Audits.log(actor, 'field_data.capture.cancelled', null, { challengeId: row.id, projectId: row.projectId });
      }
      return { cancelled: true };
    });
  }));
  service.get('/projects/:projectId/forms/:xmlFormId/submissions/:instanceId/capture-challenges', endpoint(async (container, { auth, params }, _, response) => {
    const form = await container.Forms.getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.WithoutDef, Form.WithoutXml).then(getOrNotFound);
    try { await auth.canOrReject('submission.read', form); } catch (error) {
      if (error?.problemCode === Problem.user.insufficientRights.code) throw Problem.user.notFound();
      throw error;
    }
    const submission = await container.Submissions.getByIds(params.projectId, params.xmlFormId, params.instanceId, false).then(getOrNotFound);
    const rows = await container.db.any(sql`SELECT c.*, (c.status = 'bound' AND c."blobId" IS NOT NULL AND sa."blobId" = c."blobId") AS "bindingCurrent"
      FROM field_data_capture_challenges c JOIN submission_defs sd ON sd.id = c."submissionDefId" AND sd.current
      LEFT JOIN submission_attachments sa ON sa."submissionDefId" = sd.id AND sa.name = c.name
      WHERE sd."submissionId" = ${submission.id} ORDER BY c."issuedAt" DESC LIMIT 20`);
    await container.Audits.log(auth.actor, 'field_data.capture.read', form, { submissionId: submission.id });
    response.set('Cache-Control', 'private, no-store');
    return { items: rows.map(row => ({ ...present(row), bindingCurrent: row.bindingCurrent === true })) };
  }));
};
