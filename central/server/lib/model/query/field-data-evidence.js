// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

const { sql } = require('slonik');
const { v4: uuid } = require('uuid');
const Problem = require('../../util/problem');

// Recompute from stored XML on every read so a stale digest cannot masquerade
// as verified evidence. XML is text in Central's submission_defs table.
const select = (condition, includeXml = false) => ({ all }) => all(sql`
  SELECT e.id, e."sourceKind", COALESCE(e."contentHash", verification."contentHash") AS "contentHash",
    e."mimeType", CASE WHEN e."contentHash" IS NULL THEN verification."byteSize"
      ELSE e."byteSize" END AS "byteSize",
    e."receivedAt", e.degraded, e."attachmentName", e."blobId", link.relation,
    COALESCE(derivations.items, '[]'::jsonb) AS derivations,
    verification."verifiedAt", verification."basis" AS "verificationBasis",
    verification."legacySha1Matched",
    CASE WHEN e."sourceKind" = 'submission-xml' THEN
      e."contentHash" = 'sha256:' || encode(sha256(convert_to(sd.xml, 'UTF8')), 'hex')
    WHEN e."blobId" IS NULL OR e."contentHash" IS NULL OR b.content IS NULL THEN NULL
    ELSE e."contentHash" = 'sha256:' || encode(sha256(b.content), 'hex') END
      AS "hashMatches",
    ${includeXml ? sql`CASE WHEN e."sourceKind" = 'submission-xml' THEN sd.xml ELSE NULL END` : sql`NULL::text`} AS xml,
    b.s3_status AS "s3Status", b.sha AS "blobSha",
    ${includeXml ? sql`b.content` : sql`NULL::bytea`} AS content,
    forms."projectId", forms."xmlFormId"
  FROM field_data_evidence_records e
  JOIN field_data_claim_evidence link ON link."evidenceId" = e.id
  JOIN field_data_claim_versions v ON v.id = link."claimVersionId"
  JOIN submission_defs sd ON sd.id = e."submissionDefId" AND sd.id = v."submissionDefId"
  LEFT JOIN blobs b ON b.id = e."blobId"
  LEFT JOIN field_data_evidence_verifications verification ON verification."evidenceId" = e.id
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind,
      'algorithm', d.algorithm, 'algorithmVersion', d."algorithmVersion",
      'createdAt', d."createdAt") ORDER BY d."createdAt", d.id) AS items
    FROM field_data_evidence_derivations d WHERE d."evidenceId" = e.id
  ) derivations ON TRUE
  JOIN submissions s ON s.id = sd."submissionId" AND s."deletedAt" IS NULL
  JOIN forms ON forms.id = s."formId"
  WHERE ${condition}
  ORDER BY e."createdAt", e.id`);

const listByVersionId = (versionId) => select(sql`v.id = ${versionId}`);
const getById = (evidenceId, includeXml = false) => (container) =>
  select(sql`e.id = ${evidenceId}`, includeXml)(container).then((rows) => rows[0] ?? null);

const getDerivation = (evidenceId, derivationId) => ({ all }) => all(sql`
  SELECT id, "evidenceId", kind, algorithm, "algorithmVersion", "outputJson",
    "contentHash", "createdAt",
    ("contentHash" = 'sha256:' || encode(sha256(convert_to("outputJson"::text, 'UTF8')), 'hex'))
      AS "hashMatches"
  FROM field_data_evidence_derivations WHERE id = ${derivationId}
    AND "evidenceId" = ${evidenceId}`).then((rows) => rows[0] ?? null);

const createLink = ({ projectId, claimVersionId, evidenceId, relation,
  supersedesLinkId, key, requestHash, actorId }) => async ({ all, one, run }) => {
  const reserved = await all(sql`INSERT INTO field_data_idempotency_records
    ("projectId", "operationType", "idempotencyKey", "requestHash", status)
    VALUES (${projectId}, 'evidence.link.create', ${key}, ${requestHash}, 'in-progress')
    ON CONFLICT ("projectId", "operationType", "idempotencyKey") DO NOTHING
    RETURNING id`);
  const record = await one(sql`SELECT "requestHash", status, "resourceId"
    FROM field_data_idempotency_records WHERE "projectId" = ${projectId}
      AND "operationType" = 'evidence.link.create' AND "idempotencyKey" = ${key}
    FOR UPDATE`);
  if (record.requestHash !== requestHash) throw Problem.user.idempotencyKeyReused();
  if (reserved.length === 0) {
    if (record.status !== 'succeeded') throw Problem.user.idempotencyInProgress();
    return { id: record.resourceId, created: false, replayed: true };
  }
  const eligible = await all(sql`SELECT e.id FROM field_data_evidence_records e
    JOIN field_data_claim_versions v ON v."submissionDefId" = e."submissionDefId"
    WHERE e.id = ${evidenceId} AND v.id = ${claimVersionId}`);
  if (eligible.length === 0) throw Problem.user.evidenceScopeInvalid();
  if (supersedesLinkId != null) {
    const old = await all(sql`SELECT id FROM field_data_claim_evidence
      WHERE id = ${supersedesLinkId} AND "claimVersionId" = ${claimVersionId}`);
    if (old.length === 0) throw Problem.user.evidenceScopeInvalid();
  }
  const inserted = await all(sql`INSERT INTO field_data_claim_evidence
    (id, "claimVersionId", "evidenceId", relation, "createdBy", "supersedesLinkId")
    VALUES (${uuid()}, ${claimVersionId}, ${evidenceId}, ${relation}, ${actorId},
      ${supersedesLinkId})
    ON CONFLICT ("claimVersionId", "evidenceId", relation) DO NOTHING RETURNING id`);
  const linkId = inserted.length > 0 ? inserted[0].id : (await one(sql`
    SELECT id FROM field_data_claim_evidence WHERE "claimVersionId" = ${claimVersionId}
      AND "evidenceId" = ${evidenceId} AND relation = ${relation}`)).id;
  await run(sql`UPDATE field_data_idempotency_records SET status = 'succeeded',
    "resourceId" = ${linkId}, "responseStatus" = 201, "completedAt" = clock_timestamp()
    WHERE "projectId" = ${projectId} AND "operationType" = 'evidence.link.create'
      AND "idempotencyKey" = ${key}`);
  return { id: linkId, created: inserted.length > 0, replayed: false };
};

module.exports = { listByVersionId, getById, getDerivation, createLink };
