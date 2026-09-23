// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

const { sql } = require('slonik');

// Recompute from stored XML on every read so a stale digest cannot masquerade
// as verified evidence. XML is text in Central's submission_defs table.
const select = (condition, includeXml = false) => ({ all }) => all(sql`
  SELECT e.id, e."sourceKind", COALESCE(e."contentHash", verification."contentHash") AS "contentHash",
    e."mimeType", CASE WHEN e."contentHash" IS NULL THEN verification."byteSize"
      ELSE e."byteSize" END AS "byteSize",
    e."receivedAt", e.degraded, e."attachmentName", e."blobId", link.relation,
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
  JOIN submissions s ON s.id = sd."submissionId" AND s."deletedAt" IS NULL
  JOIN forms ON forms.id = s."formId"
  WHERE ${condition}
  ORDER BY e."createdAt", e.id`);

const listByVersionId = (versionId) => select(sql`v.id = ${versionId}`);
const getById = (evidenceId, includeXml = false) => (container) =>
  select(sql`e.id = ${evidenceId}`, includeXml)(container).then((rows) => rows[0] ?? null);

module.exports = { listByVersionId, getById };
