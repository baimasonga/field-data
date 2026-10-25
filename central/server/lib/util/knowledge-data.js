// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { sql } = require('slonik');
const { Form } = require('../model/frames');
const { getOrNotFound } = require('./promise');
const Problem = require('./problem');
const { timestamp, freshness } = require('./asset-freshness');
const invalid = reason => Problem.user.unexpectedValue({ field: 'knowledge', reason });
const MAX_ASSETS = 1000;
const checkedSnapshot = (body = {}) => {
  if (!body || Array.isArray(body) || Object.keys(body).some(key => !['predicates', 'at', 'knownAt'].includes(key))) throw invalid('Use predicates, at and knownAt.');
  const predicates = body.predicates ?? [];
  if (!Array.isArray(predicates) || predicates.length > 12 || predicates.some(value => typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 100) || new Set(predicates).size !== predicates.length) throw invalid('Choose at most 12 distinct fact names.');
  for (const key of ['at', 'knownAt']) if (body[key] != null && !timestamp(body[key])) throw invalid('Use complete ISO timestamps.');
  const now = new Date(); const at = body.at == null ? now : new Date(body.at); const knownAt = body.knownAt == null ? now : new Date(body.knownAt);
  if (knownAt.valueOf() > now.valueOf() + 1000) throw invalid('The knowledge cutoff cannot be in the future.');
  return { predicates, at, knownAt };
};
const lockGrant = async (db, actorId, acteeId, verb) => {
  const grant = await db.maybeOne(sql`WITH RECURSIVE implied(id) AS (
    (SELECT ${acteeId}::varchar) UNION (SELECT unnest(ARRAY[parent,species]) FROM actees JOIN implied ON implied.id=actees.id))
    SELECT ass."actorId" FROM assignments ass JOIN implied ON implied.id=ass."acteeId" JOIN roles r ON r.id=ass."roleId"
    WHERE ass."actorId"=${actorId} AND r.verbs ? ${verb} LIMIT 1 FOR SHARE OF ass,r`);
  if (!grant) throw Problem.user.notFound();
};
const scope = async (c, auth, projectId, write = false) => {
  if (!/^[1-9]\d*$/.test(String(projectId)) || !Number.isSafeInteger(Number(projectId))) throw Problem.user.notFound();
  const project = await c.Projects.getById(Number(projectId)).then(getOrNotFound);
  await auth.canOrReject(write ? 'project.update' : 'project.read', project);
  const current = await c.db.maybeOne(sql`SELECT id,archived FROM projects WHERE id=${project.id} AND "deletedAt" IS NULL FOR SHARE`);
  if (!current) throw Problem.user.notFound();
  if (write && (current.archived || auth.actor.orNull()?.type !== 'user')) throw invalid('An active project and manager account are required.');
  await lockGrant(c.db, auth.actor.get().id, project.acteeId, write ? 'project.update' : 'project.read');
  return project;
};
const readableForms = async (c, auth, projectId) => {
  const rows = await c.db.any(sql`SELECT "xmlFormId" FROM forms WHERE "projectId"=${projectId} AND "deletedAt" IS NULL ORDER BY id`);
  const readable = [];
  for (const row of rows) {
    // Grants remain held for the complete request transaction, including historical reads.
    // eslint-disable-next-line no-await-in-loop
    const form = (await c.Forms.getByProjectAndXmlFormId(projectId, row.xmlFormId, Form.WithoutDef, Form.WithoutXml)).orNull();
    // eslint-disable-next-line no-await-in-loop
    if (form && await auth.can('submission.read', form)) {
      // eslint-disable-next-line no-await-in-loop
      await lockGrant(c.db, auth.actor.get().id, form.acteeId, 'submission.read'); readable.push(form.id);
    }
  }
  return readable;
};
// Rebuild ownership as it was known then, including operations undone later.
const ownersSql = knownAt => sql`SELECT o.id AS "observationId",COALESCE(moved."assetId",o."assetId") AS "assetId"
  FROM field_data_asset_observations o LEFT JOIN LATERAL (
    SELECT r."assetId" FROM field_data_asset_reassignments r JOIN field_data_asset_operations op ON op.id=r."operationId"
    WHERE r."observationId"=o.id AND op."createdAt"<=${knownAt.toISOString()}
      AND (op."undoneAt" IS NULL OR op."undoneAt">${knownAt.toISOString()}) ORDER BY op.sequence DESC LIMIT 1
  ) moved ON true WHERE o."recordedAt"<=${knownAt.toISOString()}`;
const snapshot = async (c, auth, projectId, body) => {
  const options = checkedSnapshot(body); const { at, knownAt, predicates } = options;
  const project = await scope(c, auth, projectId); const readable = await readableForms(c, auth, project.id);
  const ids = sql.array(readable, 'int4');
  const rows = await c.db.any(sql`WITH owners AS (${ownersSql(knownAt)})
    SELECT a.id,a.name,a."externalId",a."assetType",f."xmlFormId",count(*) OVER() AS total,
      EXISTS (SELECT 1 FROM owners ow JOIN field_data_asset_observations o ON o.id=ow."observationId"
        JOIN field_data_claim_versions cv ON cv.id=o."claimVersionId" JOIN submission_defs sd ON sd.id=cv."submissionDefId"
        JOIN submissions s ON s.id=sd."submissionId" JOIN forms sf ON sf.id=s."formId"
        WHERE ow."assetId"=a.id AND (s."deletedAt" IS NOT NULL OR sf."deletedAt" IS NOT NULL OR NOT(s."formId"=ANY(${ids})))) AS withheld
    FROM field_data_assets a JOIN forms f ON f.id=a."formId" AND f."deletedAt" IS NULL
    WHERE a."projectId"=${project.id} AND a."formId"=ANY(${ids}) AND a."createdAt"<=${knownAt.toISOString()}
      AND NOT EXISTS (SELECT 1 FROM field_data_asset_operations op WHERE op.kind='merge' AND op."otherAssetId"=a.id
        AND op."createdAt"<=${knownAt.toISOString()} AND (op."undoneAt" IS NULL OR op."undoneAt">${knownAt.toISOString()}))
    ORDER BY a.name,a.id LIMIT ${MAX_ASSETS}`);
  const shown = rows.filter(row => !row.withheld); const assetIds = sql.array(shown.map(row => row.id), 'uuid');
  const available = await c.db.any(sql`WITH owners AS (${ownersSql(knownAt)}) SELECT DISTINCT o.predicate
    FROM owners ow JOIN field_data_asset_observations o ON o.id=ow."observationId"
    WHERE ow."assetId"=ANY(${assetIds}) ORDER BY o.predicate LIMIT 200`);
  const observations = predicates.length === 0 || !shown.length ? [] : await c.db.any(sql`WITH owners AS (${ownersSql(knownAt)})
    SELECT DISTINCT ON (ow."assetId",o.predicate) o.*,ow."assetId" AS "ownerId",sf."xmlFormId",s."instanceId",
      CASE WHEN octet_length(sd.xml)<=2097152 THEN p."integrityHash"=o."sourceHash" AND p."integrityHash"=encode(sha256(convert_to(sd.xml,'UTF8')),'hex') ELSE false END AS verified
    FROM owners ow JOIN field_data_asset_observations o ON o.id=ow."observationId"
    JOIN field_data_claim_versions cv ON cv.id=o."claimVersionId" JOIN submission_defs sd ON sd.id=cv."submissionDefId"
    JOIN submissions s ON s.id=sd."submissionId" JOIN forms sf ON sf.id=s."formId"
    LEFT JOIN field_data_submission_provenance p ON p."submissionDefId"=sd.id
    WHERE ow."assetId"=ANY(${assetIds}) AND o.predicate=ANY(${sql.array(predicates, 'text')})
      AND o."validFrom"<=${at.toISOString()} AND o."recordedAt"<=${knownAt.toISOString()}
    ORDER BY ow."assetId",o.predicate,o."validFrom" DESC,o."recordedAt" DESC,o.sequence DESC,o.id`);
  const byAsset = new Map(shown.map(row => [row.id, Object.create(null)]));
  for (const row of observations) {
    const integrityStatus = row.verified === true ? 'verified' : 'unverified';
    byAsset.get(row.ownerId)[row.predicate] = { id: row.id, predicate: row.predicate, state: row.state, value: row.value,
      validFrom: row.validFrom, recordedAt: row.recordedAt, freshness: freshness({ ...row, integrityStatus }, at), integrityStatus,
      source: { integrityHash: row.sourceHash, claimVersionId: row.claimVersionId, xmlFormId: row.xmlFormId, instanceId: row.instanceId, url: `/v1/field-data/claim-versions/${row.claimVersionId}` } };
  }
  return { projectId: project.id, method: 'knowledge-snapshot@1', at: at.toISOString(), knownAt: knownAt.toISOString(), rebuiltAt: new Date().toISOString(),
    predicates, availablePredicates: available.map(row => row.predicate), assets: shown.map(({ total, withheld, ...row }) => ({ ...row, facts: byAsset.get(row.id) })),
    withheldAssets: rows.filter(row => row.withheld).length, truncated: rows.length > 0 && Number(rows[0].total) > rows.length, limit: MAX_ASSETS };
};
const usable = fact => fact?.state === 'known' && fact.integrityStatus === 'verified' && fact.freshness?.status === 'fresh';
module.exports = { invalid, scope, readableForms, lockGrant, ownersSql, checkedSnapshot, snapshot, usable };
