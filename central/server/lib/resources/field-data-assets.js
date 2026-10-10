// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { createHash } = require('crypto');
const { sql } = require('slonik');
const { Form } = require('../model/frames');
const { UUID_PATTERN } = require('../util/claim-versioning');
const { getOrNotFound } = require('../util/promise');
const Problem = require('../util/problem');
const { timestamp, freshness, selectFacts } = require('../util/asset-freshness');
const { MAX_ASSETS, summarize } = require('../util/asset-projection');
const { generateReverification } = require('../worker/field-data-reverification');
const invalid = () => Problem.user.assetInvalid();
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const scope = async (container, auth, params, edit = false) => {
  if (!/^[1-9]\d*$/.test(params.projectId) || !Number.isSafeInteger(Number(params.projectId))) throw Problem.user.notFound();
  const project = await container.Projects.getById(Number(params.projectId)).then(getOrNotFound);
  try { await auth.canOrReject(edit ? 'project.update' : 'project.read', project); } catch (error) {
    if (error?.problemCode === Problem.user.insufficientRights.code) throw Problem.user.notFound();
    throw error;
  }
  return project;
};
const formFor = async (container, auth, projectId, xmlFormId) => {
  const form = await container.Forms.getByProjectAndXmlFormId(projectId, xmlFormId,
    Form.WithoutDef, Form.WithoutXml).then(getOrNotFound);
  try { await auth.canOrReject('submission.read', form); } catch (error) {
    if (error?.problemCode === Problem.user.insufficientRights.code) throw Problem.user.notFound();
    throw error;
  }
  return form;
};
const assetFor = async (container, auth, params) => {
  if (!UUID_PATTERN.test(params.assetId)) throw Problem.user.notFound();
  const [asset] = await container.db.any(sql`SELECT a.*, f."xmlFormId" FROM field_data_assets a
    JOIN forms f ON f.id = a."formId" AND f."deletedAt" IS NULL
    WHERE a.id = ${params.assetId} AND a."projectId" = ${Number(params.projectId)}`);
  if (asset == null) throw Problem.user.notFound();
  await formFor(container, auth, asset.projectId, asset.xmlFormId);
  return asset;
};
const historyFor = async (container, auth, asset) => {
  const history = await container.db.any(sql`SELECT o.*, f."xmlFormId", s."instanceId" AS "rootInstanceId",
    sd."instanceId", p.origin, p."capturedAt", p."integrityHash",
    CASE WHEN octet_length(sd.xml) <= 2097152 THEN
      p."integrityHash" = o."sourceHash" AND p."integrityHash" = encode(sha256(convert_to(sd.xml, 'UTF8')), 'hex')
      ELSE false END AS verified,
    s."deletedAt" AS "sourceDeletedAt", f."deletedAt" AS "formDeletedAt"
    FROM field_data_asset_observations o
    JOIN field_data_claim_versions cv ON cv.id = o."claimVersionId"
    JOIN submission_defs sd ON sd.id = cv."submissionDefId"
    JOIN submissions s ON s.id = sd."submissionId"
    JOIN forms f ON f.id = s."formId"
    LEFT JOIN field_data_submission_provenance p ON p."submissionDefId" = sd.id
    WHERE o."assetId" = ${asset.id} ORDER BY o.sequence DESC LIMIT 501`);
  if (history.length > 500) throw invalid();
  if (history.some(row => row.sourceDeletedAt != null || row.formDeletedAt != null)) throw Problem.user.notFound();
  await Promise.all([...new Set(history.map(row => row.xmlFormId))]
    .map(xmlFormId => formFor(container, auth, asset.projectId, xmlFormId)));
  return history.map(({ requestId, requestHash, sourceDeletedAt, formDeletedAt, ...row }) => ({ ...row,
    integrityStatus: row.verified === true ? 'verified' : 'unverified',
    sourceUrl: `/v1/field-data/claim-versions/${row.claimVersionId}` }));
};
const audit = (tx, actorId, formId, action, details) => tx.db.query(sql`INSERT INTO audits
  ("actorId", action, "acteeId", details, "loggedAt", processed, failures)
  SELECT ${actorId}, ${action}, f."acteeId", ${JSON.stringify(details)},
    clock_timestamp(), clock_timestamp(), 0 FROM forms f WHERE f.id = ${formId}`);
module.exports = (service, endpoint) => {
  const root = '/field-data/projects/:projectId/assets';
  service.get(root, endpoint(async (container, { auth, params, query }, request, response) => {
    const project = await scope(container, auth, params);
    if (query.cursor != null && (typeof query.cursor !== 'string' || !UUID_PATTERN.test(query.cursor))) throw invalid();
    const rows = await container.db.any(sql`SELECT a.id, a.name, a."assetType", a."externalId", a.revision,
      a."createdAt", f."xmlFormId" FROM field_data_assets a
      JOIN forms f ON f.id = a."formId" AND f."deletedAt" IS NULL
      WHERE a."projectId" = ${Number(params.projectId)}
        ${query.cursor == null ? sql`` : sql`AND a.id > ${query.cursor}::uuid`}
      ORDER BY a.id LIMIT 51`);
    const allowed = await Promise.all(rows.slice(0, 50).map(async row => {
      try { await formFor(container, auth, Number(params.projectId), row.xmlFormId); return row; } catch (error) {
        if (error?.problemCode === Problem.user.notFound.code) return null;
        throw error;
      }
    }));
    response.set('Cache-Control', 'private, no-store');
    return { items: allowed.filter(row => row != null), allowed: await auth.can('project.update', project),
      nextCursor: rows.length > 50 ? rows[49].id : null };
  }));
  service.post(root, endpoint(async (container, { auth, params, body }, request, response) => {
    await scope(container, auth, params, true);
    if (body == null || Object.keys(body).some(key => !['requestId', 'name', 'assetType', 'externalId', 'xmlFormId'].includes(key))
      || !UUID_PATTERN.test(body.requestId ?? '') || !text(body.name, 200) || !text(body.assetType, 100)
      || !text(body.externalId, 200) || !text(body.xmlFormId, 255)) throw invalid();
    const form = await formFor(container, auth, Number(params.projectId), body.xmlFormId);
    const actorId = auth.actor.map(actor => actor.id).orNull();
    const data = { name: body.name.trim(), assetType: body.assetType.trim(), externalId: body.externalId.trim(), formId: form.id };
    const requestHash = hash(data);
    const result = await container.transacting(async tx => {
      await tx.db.query(sql`SELECT id FROM projects WHERE id = ${Number(params.projectId)} FOR UPDATE`);
      const [existing] = await tx.db.any(sql`SELECT id, revision, "requestHash" FROM field_data_assets
        WHERE "projectId" = ${Number(params.projectId)} AND "requestId" = ${body.requestId}`);
      if (existing != null) {
        if (existing.requestHash !== requestHash) throw invalid();
        return { id: existing.id, revision: existing.revision, replayed: true };
      }
      const duplicates = await tx.db.any(sql`SELECT id FROM field_data_assets
        WHERE "projectId" = ${Number(params.projectId)} AND "externalId" = ${data.externalId}`);
      if (duplicates.length > 0) throw Problem.user.assetDuplicate();
      const asset = await tx.db.one(sql`INSERT INTO field_data_assets
        ("projectId", "formId", name, "assetType", "externalId", "requestId", "requestHash", "actorId")
        VALUES (${Number(params.projectId)}, ${form.id}, ${data.name}, ${data.assetType}, ${data.externalId},
          ${body.requestId}, ${requestHash}, ${actorId}) RETURNING id, revision`);
      await audit(tx, actorId, form.id, 'field_data.asset.register', { assetId: asset.id });
      return { ...asset, replayed: false };
    });
    response.set('Cache-Control', 'private, no-store');
    response.set('ETag', `"asset-${result.revision}"`);
    response.set('Idempotency-Status', result.replayed ? 'replayed' : 'created');
    response.status(201);
    return result;
  }));
  // K3: one predicate's current fact for every asset, chosen as the passport
  // chooses it (docs/field-intelligence/K3-asset-status-projection.md).
  service.get(`${root}/projection`, endpoint(async (container, { auth, params, query }, request, response) => {
    const project = await scope(container, auth, params);
    for (const key of ['at', 'knownAt']) if (query[key] != null && !timestamp(query[key])) throw invalid();
    for (const key of ['predicate', 'assetType']) if (query[key] != null && !text(query[key], 100)) throw invalid();
    const now = new Date();
    const at = query.at == null ? now : new Date(query.at);
    const knownAt = query.knownAt == null ? now : new Date(query.knownAt);
    response.set('Cache-Control', 'private, no-store');

    const forms = await container.db.any(sql`SELECT "xmlFormId" FROM forms WHERE "projectId" = ${project.id} AND "deletedAt" IS NULL`);
    const readable = (await Promise.all(forms.map(async ({ xmlFormId }) => {
      try { return (await formFor(container, auth, project.id, xmlFormId)).id; } catch (error) {
        if (error?.problemCode === Problem.user.notFound.code) return null;
        throw error;
      }
    }))).filter(id => id != null);
    const readableIds = sql.array(readable, 'int4');
    const predicates = (await container.db.any(sql`SELECT DISTINCT o.predicate FROM field_data_asset_observations o
      JOIN field_data_assets a ON a.id = o."assetId" AND a."projectId" = ${project.id} AND a."formId" = ANY(${readableIds})
      ORDER BY o.predicate LIMIT 200`)).map(row => row.predicate);
    const result = { predicate: query.predicate?.trim() ?? null, at: at.toISOString(), knownAt: knownAt.toISOString(), predicates };
    if (result.predicate == null) return { ...result, assets: [], summary: summarize([]), excluded: { notReadable: 0, sourceDeleted: 0 }, truncated: false };

    // As with a passport, an asset whose facts rest on a deleted submission or
    // on a form the caller may not read is left out.
    const rows = await container.db.any(sql`SELECT a.id, a.name, a."externalId", a."assetType", f."xmlFormId",
        count(*) OVER () AS total,
        EXISTS (SELECT 1 FROM field_data_asset_observations o JOIN field_data_claim_versions cv ON cv.id = o."claimVersionId"
          JOIN submission_defs sd ON sd.id = cv."submissionDefId" JOIN submissions s ON s.id = sd."submissionId"
          JOIN forms sf ON sf.id = s."formId"
          WHERE o."assetId" = a.id AND (s."deletedAt" IS NOT NULL OR sf."deletedAt" IS NOT NULL)) AS "sourceDeleted",
        EXISTS (SELECT 1 FROM field_data_asset_observations o JOIN field_data_claim_versions cv ON cv.id = o."claimVersionId"
          JOIN submission_defs sd ON sd.id = cv."submissionDefId" JOIN submissions s ON s.id = sd."submissionId"
          WHERE o."assetId" = a.id AND NOT (s."formId" = ANY(${readableIds}))) AS "notReadable"
      FROM field_data_assets a JOIN forms f ON f.id = a."formId" AND f."deletedAt" IS NULL
      WHERE a."projectId" = ${project.id} AND a."formId" = ANY(${readableIds})
        ${query.assetType == null ? sql`` : sql`AND a."assetType" = ${query.assetType.trim()}`}
      ORDER BY a.name, a.id LIMIT ${MAX_ASSETS}`);
    const shown = rows.filter(row => !row.sourceDeleted && !row.notReadable);
    const observations = shown.length === 0 ? [] : await container.db.any(sql`SELECT o.*,
        CASE WHEN octet_length(sd.xml) <= 2097152 THEN
          p."integrityHash" = o."sourceHash" AND p."integrityHash" = encode(sha256(convert_to(sd.xml, 'UTF8')), 'hex')
          ELSE false END AS verified
      FROM field_data_asset_observations o
      JOIN field_data_claim_versions cv ON cv.id = o."claimVersionId"
      JOIN submission_defs sd ON sd.id = cv."submissionDefId"
      LEFT JOIN field_data_submission_provenance p ON p."submissionDefId" = sd.id
      WHERE o."assetId" = ANY(${sql.array(shown.map(row => row.id), 'uuid')}) AND o.predicate = ${result.predicate}`);
    const byAsset = new Map();
    for (const { requestId, requestHash, verified, ...row } of observations) {
      if (!byAsset.has(row.assetId)) byAsset.set(row.assetId, []);
      byAsset.get(row.assetId).push({ ...row, integrityStatus: verified === true ? 'verified' : 'unverified' });
    }
    const assets = shown.map(({ total, sourceDeleted, notReadable, ...asset }) => {
      const [fact] = selectFacts(byAsset.get(asset.id) ?? [], at, knownAt);
      return { ...asset, fact: fact == null ? null : { value: fact.value, state: fact.state, validFrom: fact.validFrom,
        recordedAt: fact.recordedAt, claimVersionId: fact.claimVersionId, integrityStatus: fact.integrityStatus, freshness: fact.freshness } };
    });
    return { ...result, assets, summary: summarize(assets),
      excluded: { notReadable: rows.filter(row => row.notReadable).length, sourceDeleted: rows.filter(row => row.sourceDeleted && !row.notReadable).length },
      truncated: rows.length > 0 && Number(rows[0].total) > rows.length };
  }));
  service.get(`${root}/:assetId`, endpoint(async (container, { auth, params, query }, request, response) => {
    const project = await scope(container, auth, params);
    const asset = await assetFor(container, auth, params);
    for (const key of ['at', 'knownAt']) if (query[key] != null && !timestamp(query[key])) throw invalid();
    const now = new Date();
    const at = query.at == null ? now : new Date(query.at);
    const knownAt = query.knownAt == null ? now : new Date(query.knownAt);
    const history = await historyFor(container, auth, asset);
    const tasks = await container.db.any(sql`SELECT t.*, o.predicate, o."claimVersionId" FROM field_data_reverification_tasks t
      JOIN field_data_asset_observations o ON o.id = t."observationId"
      WHERE o."assetId" = ${asset.id} ORDER BY t."createdAt" DESC LIMIT 500`);
    response.set('Cache-Control', 'private, no-store');
    response.set('ETag', `"asset-${asset.revision}"`);
    const { requestId, requestHash, ...metadata } = asset;
    return { asset: metadata, history: history.filter(row => new Date(row.recordedAt) <= knownAt).map(row => ({ ...row, freshness: freshness(row, at) })),
      facts: selectFacts(history, at, knownAt),
      tasks: tasks.filter(task => new Date(task.createdAt) <= knownAt).map(task => ({ ...task,
        status: task.supersededAt != null && new Date(task.supersededAt) > knownAt ? 'queued' : task.status,
        supersededAt: task.supersededAt != null && new Date(task.supersededAt) > knownAt ? null : task.supersededAt })), at: at.toISOString(), knownAt: knownAt.toISOString(),
      allowed: await auth.can('project.update', project) };
  }));
  service.post(`${root}/:assetId/observations`, endpoint(async (container, { auth, params, body, headers }, request, response) => {
    await scope(container, auth, params, true);
    const asset = await assetFor(container, auth, params);
    await historyFor(container, auth, asset);
    if (headers['if-match'] == null) throw Problem.user.assetRevisionRequired();
    const matched = /^"asset-([1-9]\d*)"$/.exec(headers['if-match']);
    if (matched == null || !Number.isSafeInteger(Number(matched[1])) || body == null || Object.keys(body).some(key => !['requestId', 'claimVersionId', 'predicate', 'state', 'value', 'validFrom', 'validityDays', 'graceDays', 'note'].includes(key))
      || !UUID_PATTERN.test(body.requestId ?? '') || !UUID_PATTERN.test(body.claimVersionId ?? '')
      || !text(body.predicate, 100) || !['known', 'unknown', 'not-observed', 'not-applicable'].includes(body.state)
      || (body.state === 'known' ? typeof body.value !== 'string' || body.value.length > 2000 : body.value !== null)
      || !timestamp(body.validFrom) || !Number.isInteger(body.validityDays) || body.validityDays < 1 || body.validityDays > 3650
      || !Number.isInteger(body.graceDays) || body.graceDays < 0 || body.graceDays > 365 || !text(body.note, 2000)) throw invalid();
    const claim = await container.FieldDataClaims.getByVersionId(body.claimVersionId);
    if (claim == null || claim.scope.projectId !== asset.projectId) throw Problem.user.notFound();
    await formFor(container, auth, asset.projectId, claim.scope.xmlFormId);
    const { requestId, ...payload } = body;
    const data = { ...payload, predicate: body.predicate.trim(), note: body.note.trim(), validFrom: new Date(body.validFrom).toISOString() };
    const requestHash = hash(data);
    const actorId = auth.actor.map(actor => actor.id).orNull();
    const result = await container.transacting(async tx => {
      const locked = await tx.db.one(sql`SELECT revision FROM field_data_assets WHERE id = ${asset.id} FOR UPDATE`);
      const [existing] = await tx.db.any(sql`SELECT id, sequence, "requestHash" FROM field_data_asset_observations
        WHERE "assetId" = ${asset.id} AND "requestId" = ${requestId}`);
      if (existing != null) {
        if (existing.requestHash !== requestHash) throw invalid();
        return { id: existing.id, revision: locked.revision, replayed: true };
      }
      if (Number(matched[1]) !== locked.revision) throw Problem.user.assetRevisionStale();
      if (locked.revision > 500) throw invalid();
      const [source] = await tx.db.any(sql`SELECT p."integrityHash" FROM field_data_claim_versions cv
        JOIN submission_defs sd ON sd.id = cv."submissionDefId"
        JOIN submissions s ON s.id = sd."submissionId" AND s."deletedAt" IS NULL
        JOIN forms f ON f.id = s."formId" AND f."projectId" = ${asset.projectId} AND f."deletedAt" IS NULL
        JOIN field_data_submission_provenance p ON p."submissionDefId" = sd.id
        WHERE cv.id = ${body.claimVersionId}
          AND CASE WHEN octet_length(sd.xml) <= 2097152 THEN
            p."integrityHash" = encode(sha256(convert_to(sd.xml, 'UTF8')), 'hex') ELSE false END`);
      if (source == null) throw invalid();
      const [previous] = await tx.db.any(sql`SELECT id FROM field_data_asset_observations
        WHERE "assetId" = ${asset.id} AND predicate = ${data.predicate} ORDER BY sequence DESC LIMIT 1`);
      const inserted = await tx.db.one(sql`INSERT INTO field_data_asset_observations
        ("assetId", sequence, "previousObservationId", "claimVersionId", "sourceHash", predicate, state, value,
          "validFrom", "validityDays", "graceDays", "requestId", "requestHash", "actorId", note)
        VALUES (${asset.id}, ${locked.revision}, ${previous?.id ?? null}, ${body.claimVersionId}, ${source.integrityHash},
          ${data.predicate}, ${data.state}, ${data.value}, ${data.validFrom}, ${data.validityDays}, ${data.graceDays},
          ${requestId}, ${requestHash}, ${actorId}, ${data.note}) RETURNING id`);
      await tx.db.query(sql`UPDATE field_data_assets SET revision = revision + 1 WHERE id = ${asset.id}`);
      await audit(tx, actorId, asset.formId, 'field_data.asset.observe', { assetId: asset.id, observationId: inserted.id });
      return { id: inserted.id, revision: locked.revision + 1, replayed: false };
    });
    response.set('Cache-Control', 'private, no-store');
    response.set('ETag', `"asset-${result.revision}"`);
    response.set('Idempotency-Status', result.replayed ? 'replayed' : 'created');
    response.status(201);
    return result;
  }));
  service.post(`${root}/:assetId/refresh`, endpoint(async (container, { auth, params }, request, response) => {
    await scope(container, auth, params, true);
    const asset = await assetFor(container, auth, params);
    await historyFor(container, auth, asset);
    const tasks = await generateReverification(container.db, asset.id);
    response.set('Cache-Control', 'private, no-store');
    return { generated: tasks.length };
  }));
};
