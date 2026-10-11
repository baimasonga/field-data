// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
//
// Reversible asset merges and splits (K4): docs/field-intelligence/K4-asset-merge-split.md
//
// Observations are never changed. An operation records which asset each
// affected observation now belongs to (field_data_observation_owners resolves
// it); undoing it restores the previous ownership. Only the latest active
// operation involving an asset can be undone.

const { createHash } = require('crypto');
const { sql } = require('slonik');
const { Form } = require('../model/frames');
const { UUID_PATTERN } = require('../util/claim-versioning');
const { getOrNotFound } = require('../util/promise');
const Problem = require('../util/problem');
const { generateReverification } = require('../worker/field-data-reverification');

const MAX_SPLIT = 500;
const invalid = () => Problem.user.assetInvalid();
const state = (reason) => Problem.user.assetIdentityState({ reason });
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

const scope = async (container, auth, params, edit = false) => {
  if (!/^[1-9]\d*$/.test(params.projectId) || !Number.isSafeInteger(Number(params.projectId))) throw Problem.user.notFound();
  const project = await container.Projects.getById(Number(params.projectId)).then(getOrNotFound);
  try { await auth.canOrReject(edit ? 'project.update' : 'project.read', project); } catch (error) {
    if (error?.problemCode === Problem.user.insufficientRights.code) throw Problem.user.notFound();
    throw error;
  }
  return project;
};
const readForm = async (container, auth, projectId, xmlFormId) => {
  const form = await container.Forms.getByProjectAndXmlFormId(projectId, xmlFormId, Form.WithoutDef, Form.WithoutXml).then(getOrNotFound);
  try { await auth.canOrReject('submission.read', form); } catch (error) {
    if (error?.problemCode === Problem.user.insufficientRights.code) throw Problem.user.notFound();
    throw error;
  }
  return form;
};
const assetOf = async (container, auth, projectId, assetId) => {
  if (!UUID_PATTERN.test(assetId ?? '')) throw Problem.user.notFound();
  const [asset] = await container.db.any(sql`SELECT a.*, f."xmlFormId" FROM field_data_assets a
    JOIN forms f ON f.id = a."formId" AND f."deletedAt" IS NULL
    WHERE a.id = ${assetId} AND a."projectId" = ${projectId}`);
  if (asset == null) throw Problem.user.notFound();
  await readForm(container, auth, projectId, asset.xmlFormId);
  return asset;
};
// The caller must be able to read every source of the observations an operation moves.
const checkSources = async (container, auth, projectId, observationIds) => {
  if (observationIds.length === 0) return;
  const forms = await container.db.any(sql`SELECT DISTINCT f."xmlFormId" FROM field_data_asset_observations o
    JOIN field_data_claim_versions cv ON cv.id = o."claimVersionId"
    JOIN submission_defs sd ON sd.id = cv."submissionDefId"
    JOIN submissions s ON s.id = sd."submissionId"
    JOIN forms f ON f.id = s."formId"
    WHERE o.id = ANY(${sql.array(observationIds, 'uuid')})`);
  await Promise.all(forms.map(({ xmlFormId }) => readForm(container, auth, projectId, xmlFormId)));
};
const ownedBy = async (db, assetId) => (await db.any(sql`SELECT "observationId" FROM field_data_observation_owners
  WHERE "assetId" = ${assetId}`)).map((row) => row.observationId);
const revisionOf = (headers) => {
  if (headers['if-match'] == null) throw Problem.user.assetRevisionRequired();
  const matched = /^"asset-([1-9]\d*)"$/.exec(headers['if-match']);
  if (matched == null || !Number.isSafeInteger(Number(matched[1]))) throw invalid();
  return Number(matched[1]);
};
// Lock the assets involved, in a fixed order, and return them by ID.
const lockAssets = async (db, ids) => {
  const rows = await db.any(sql`SELECT * FROM field_data_assets WHERE id = ANY(${sql.array(ids, 'uuid')}) ORDER BY id FOR UPDATE`);
  return new Map(rows.map((row) => [row.id, row]));
};
const bump = (db, ids) => db.query(sql`UPDATE field_data_assets SET revision = revision + 1 WHERE id = ANY(${sql.array(ids, 'uuid')})`);
const audit = (db, actorId, formId, action, details) => db.query(sql`INSERT INTO audits
  ("actorId", action, "acteeId", details, "loggedAt", processed, failures)
  SELECT ${actorId}, ${action}, f."acteeId", ${JSON.stringify(details)}, clock_timestamp(), clock_timestamp(), 0
  FROM forms f WHERE f.id = ${formId}`);
// The latest operation involving any of these assets that has not been undone.
const latestActive = (db, ids) => db.maybeOne(sql`SELECT id FROM field_data_asset_operations
  WHERE "undoneAt" IS NULL AND ("assetId" = ANY(${sql.array(ids, 'uuid')}) OR "otherAssetId" = ANY(${sql.array(ids, 'uuid')}))
  ORDER BY sequence DESC LIMIT 1`);
const existing = async (db, projectId, requestId, requestHash) => {
  const [row] = await db.any(sql`SELECT * FROM field_data_asset_operations WHERE "projectId" = ${projectId} AND "requestId" = ${requestId}`);
  if (row != null && row.requestHash !== requestHash) throw invalid();
  return row ?? null;
};
const present = (op) => ({ id: op.id, kind: op.kind, assetId: op.assetId, otherAssetId: op.otherAssetId,
  reason: op.reason, createdAt: op.createdAt, undoneAt: op.undoneAt, undoReason: op.undoReason });

module.exports = (service, endpoint) => {
  const root = '/field-data/projects/:projectId/assets';

  const respond = (response, revision, replayed) => {
    response.set('Cache-Control', 'private, no-store');
    response.set('ETag', `"asset-${revision}"`);
    response.set('Idempotency-Status', replayed ? 'replayed' : 'created');
    response.status(201);
  };

  // Merge another asset into this one.
  service.post(`${root}/:assetId/merge`, endpoint(async (container, { auth, params, body, headers }, _, response) => {
    const project = await scope(container, auth, params, true);
    const kept = await assetOf(container, auth, project.id, params.assetId);
    const revision = revisionOf(headers);
    if (body == null || Object.keys(body).some((k) => !['requestId', 'mergedAssetId', 'reason'].includes(k))
      || !UUID_PATTERN.test(body.requestId ?? '') || !text(body.reason, 2000)) throw invalid();
    const merged = await assetOf(container, auth, project.id, body.mergedAssetId);
    if (merged.id === kept.id) throw state('an asset cannot be merged into itself');
    await checkSources(container, auth, project.id, await ownedBy(container.db, merged.id));
    const reason = body.reason.trim();
    const requestHash = hash({ kind: 'merge', assetId: kept.id, otherAssetId: merged.id, reason });
    const actorId = auth.actor.map((actor) => actor.id).orNull();
    const result = await container.transacting(async ({ db }) => {
      const locked = await lockAssets(db, [kept.id, merged.id]);
      const replay = await existing(db, project.id, body.requestId, requestHash);
      if (replay != null) return { op: replay, revision: locked.get(kept.id).revision, replayed: true };
      if (locked.get(kept.id).revision !== revision) throw Problem.user.assetRevisionStale();
      if (locked.get(kept.id).status !== 'active') throw state('the asset kept was itself merged into another');
      if (locked.get(merged.id).status !== 'active') throw state('the other asset was already merged');
      const op = await db.one(sql`INSERT INTO field_data_asset_operations
          ("projectId", "requestId", "requestHash", kind, "assetId", "otherAssetId", reason, "actorId")
        VALUES (${project.id}, ${body.requestId}, ${requestHash}, 'merge', ${kept.id}, ${merged.id}, ${reason}, ${actorId}) RETURNING *`);
      await db.query(sql`INSERT INTO field_data_asset_reassignments ("operationId", "observationId", "assetId")
        SELECT ${op.id}, "observationId", ${kept.id} FROM field_data_observation_owners WHERE "assetId" = ${merged.id}`);
      await db.query(sql`UPDATE field_data_assets SET status = 'merged', "mergedInto" = ${kept.id} WHERE id = ${merged.id}`);
      await bump(db, [kept.id, merged.id]);
      await audit(db, actorId, kept.formId, 'field_data.asset.merge', { operationId: op.id, assetId: kept.id, mergedAssetId: merged.id });
      await generateReverification(db, kept.id);
      return { op, revision: locked.get(kept.id).revision + 1, replayed: false };
    });
    respond(response, result.revision, result.replayed);
    return present(result.op);
  }));

  // Split chosen observations out of this asset into a new one.
  service.post(`${root}/:assetId/split`, endpoint(async (container, { auth, params, body, headers }, _, response) => {
    const project = await scope(container, auth, params, true);
    const source = await assetOf(container, auth, project.id, params.assetId);
    const revision = revisionOf(headers);
    if (body == null || Object.keys(body).some((k) => !['requestId', 'observationIds', 'name', 'assetType', 'externalId', 'reason'].includes(k))
      || !UUID_PATTERN.test(body.requestId ?? '') || !text(body.reason, 2000) || !text(body.name, 200)
      || !text(body.assetType, 100) || !text(body.externalId, 200) || !Array.isArray(body.observationIds)
      || body.observationIds.length === 0 || body.observationIds.length > MAX_SPLIT
      || body.observationIds.some((id) => !UUID_PATTERN.test(id ?? ''))) throw invalid();
    const observationIds = [...new Set(body.observationIds.map((id) => id.toLowerCase()))].sort();
    const data = { name: body.name.trim(), assetType: body.assetType.trim(), externalId: body.externalId.trim() };
    const reason = body.reason.trim();
    await checkSources(container, auth, project.id, observationIds);
    const requestHash = hash({ kind: 'split', assetId: source.id, observationIds, ...data, reason });
    const actorId = auth.actor.map((actor) => actor.id).orNull();
    const result = await container.transacting(async ({ db }) => {
      await db.query(sql`SELECT id FROM projects WHERE id = ${project.id} FOR UPDATE`);
      const locked = await lockAssets(db, [source.id]);
      const replay = await existing(db, project.id, body.requestId, requestHash);
      if (replay != null) return { op: replay, revision: locked.get(source.id).revision, replayed: true };
      if (locked.get(source.id).revision !== revision) throw Problem.user.assetRevisionStale();
      if (locked.get(source.id).status !== 'active') throw state('the asset was merged into another');
      const owned = new Set(await ownedBy(db, source.id));
      if (observationIds.some((id) => !owned.has(id))) throw invalid();
      if (observationIds.length === owned.size) throw state('at least one observation must stay with the asset');
      const duplicates = await db.any(sql`SELECT id FROM field_data_assets WHERE "projectId" = ${project.id} AND "externalId" = ${data.externalId}`);
      if (duplicates.length > 0) throw Problem.user.assetDuplicate();
      const created = await db.one(sql`INSERT INTO field_data_assets
          ("projectId", "formId", name, "assetType", "externalId", "requestId", "requestHash", "actorId")
        VALUES (${project.id}, ${source.formId}, ${data.name}, ${data.assetType}, ${data.externalId},
          gen_random_uuid(), ${hash({ ...data, formId: source.formId, splitFrom: source.id })}, ${actorId}) RETURNING id`);
      const op = await db.one(sql`INSERT INTO field_data_asset_operations
          ("projectId", "requestId", "requestHash", kind, "assetId", "otherAssetId", reason, "actorId")
        VALUES (${project.id}, ${body.requestId}, ${requestHash}, 'split', ${source.id}, ${created.id}, ${reason}, ${actorId}) RETURNING *`);
      await db.query(sql`INSERT INTO field_data_asset_reassignments ("operationId", "observationId", "assetId")
        SELECT ${op.id}, unnest(${sql.array(observationIds, 'uuid')}), ${created.id}`);
      await bump(db, [source.id]);
      await audit(db, actorId, source.formId, 'field_data.asset.split', { operationId: op.id, assetId: source.id, newAssetId: created.id });
      await generateReverification(db, source.id);
      await generateReverification(db, created.id);
      return { op, revision: locked.get(source.id).revision + 1, replayed: false };
    });
    respond(response, result.revision, result.replayed);
    return present(result.op);
  }));

  // The operations involving an asset, newest first.
  service.get(`${root}/:assetId/operations`, endpoint(async (container, { auth, params }, _, response) => {
    const project = await scope(container, auth, params);
    const asset = await assetOf(container, auth, project.id, params.assetId);
    const rows = await container.db.any(sql`SELECT op.*, a.name AS "assetName", a."externalId" AS "assetExternalId",
        o.name AS "otherName", o."externalId" AS "otherExternalId", actor."displayName" AS "actorName",
        undoer."displayName" AS "undoneByName",
        (SELECT count(*)::integer FROM field_data_asset_reassignments r WHERE r."operationId" = op.id) AS observations
      FROM field_data_asset_operations op
      JOIN field_data_assets a ON a.id = op."assetId" JOIN field_data_assets o ON o.id = op."otherAssetId"
      LEFT JOIN actors actor ON actor.id = op."actorId" LEFT JOIN actors undoer ON undoer.id = op."undoneBy"
      WHERE op."projectId" = ${project.id} AND (op."assetId" = ${asset.id} OR op."otherAssetId" = ${asset.id})
      ORDER BY op.sequence DESC LIMIT 200`);
    const undoable = await Promise.all(rows.map(async (op) => op.undoneAt == null
      && (await latestActive(container.db, [op.assetId, op.otherAssetId]))?.id === op.id));
    response.set('Cache-Control', 'private, no-store');
    return rows.map((op, i) => ({ ...present(op), sequence: Number(op.sequence),
      asset: { id: op.assetId, name: op.assetName, externalId: op.assetExternalId },
      otherAsset: { id: op.otherAssetId, name: op.otherName, externalId: op.otherExternalId },
      observations: op.observations, actorName: op.actorName, undoneByName: op.undoneByName,
      undoable: undoable[i] }));
  }));

  // Undo an operation: the previous ownership comes back; the history stays.
  service.post(`${root}/operations/:operationId/undo`, endpoint(async (container, { auth, params, body }, _, response) => {
    const project = await scope(container, auth, params, true);
    if (!UUID_PATTERN.test(params.operationId)) throw Problem.user.notFound();
    if (body == null || Object.keys(body).some((k) => k !== 'reason') || !text(body.reason, 2000)) throw invalid();
    const [found] = await container.db.any(sql`SELECT * FROM field_data_asset_operations WHERE id = ${params.operationId} AND "projectId" = ${project.id}`);
    if (found == null) throw Problem.user.notFound();
    await assetOf(container, auth, project.id, found.assetId);
    await assetOf(container, auth, project.id, found.otherAssetId);
    const actorId = auth.actor.map((actor) => actor.id).orNull();
    const ids = [found.assetId, found.otherAssetId];
    const result = await container.transacting(async ({ db }) => {
      const locked = await lockAssets(db, ids);
      const op = await db.one(sql`SELECT * FROM field_data_asset_operations WHERE id = ${found.id} FOR UPDATE`);
      if (op.undoneAt != null) throw state('it was already undone');
      if ((await latestActive(db, ids))?.id !== op.id) throw state('a later change involving these assets must be undone first');
      if (op.kind === 'split') {
        const recorded = await db.oneFirst(sql`SELECT count(*)::integer FROM field_data_asset_observations WHERE "assetId" = ${op.otherAssetId}`);
        if (recorded > 0) throw state('observations were recorded against the new asset since the split');
      }
      await db.query(sql`UPDATE field_data_asset_operations SET "undoneAt" = clock_timestamp(), "undoneBy" = ${actorId},
        "undoReason" = ${body.reason.trim()} WHERE id = ${op.id}`);
      // Undoing a merge restores the merged asset; undoing a split folds the
      // new asset back into the one it came from.
      if (op.kind === 'merge') await db.query(sql`UPDATE field_data_assets SET status = 'active', "mergedInto" = NULL WHERE id = ${op.otherAssetId}`);
      else await db.query(sql`UPDATE field_data_assets SET status = 'merged', "mergedInto" = ${op.assetId} WHERE id = ${op.otherAssetId}`);
      await bump(db, ids);
      await audit(db, actorId, locked.get(op.assetId).formId, 'field_data.asset.undo', { operationId: op.id, kind: op.kind });
      await generateReverification(db, op.assetId);
      await generateReverification(db, op.otherAssetId);
      return db.one(sql`SELECT * FROM field_data_asset_operations WHERE id = ${op.id}`);
    });
    response.set('Cache-Control', 'private, no-store');
    return present(result);
  }));
};
