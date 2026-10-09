// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

const { sql } = require('slonik');

// One statement gives links, originals and decisions a consistent snapshot.
// Bound metadata before hashing. Large bytes remain explicitly unverified.
const read = (versionId) => ({ one }) => one(sql`
  WITH links AS MATERIALIZED (
    SELECT l.id, l."evidenceId", l.relation, l."createdAt", l."supersedesLinkId"
    FROM field_data_claim_evidence l WHERE l."claimVersionId" = ${versionId}
    ORDER BY l."createdAt", l.id LIMIT 501
  ), selected_links AS MATERIALIZED (
    SELECT * FROM links ORDER BY "createdAt", id LIMIT 500
  ), byte_budget AS MATERIALIZED (
    SELECT e.id, sum(CASE WHEN e."sourceKind" = 'submission-xml'
      AND octet_length(sd.xml) <= 2097152 THEN octet_length(sd.xml)
      WHEN e."sourceKind" <> 'submission-xml' AND octet_length(b.content) <= 2097152
        THEN octet_length(b.content) ELSE 0 END) OVER (ORDER BY e.id) AS used
    FROM field_data_evidence_records e
    JOIN submission_defs sd ON sd.id = e."submissionDefId"
    LEFT JOIN blobs b ON b.id = e."blobId"
    WHERE e.id IN (SELECT "evidenceId" FROM selected_links)
  ), originals AS MATERIALIZED (
    SELECT e.id, e."sourceKind", e."attachmentName" AS name, e."contentHash",
      e."receivedAt", e.degraded,
      CASE WHEN e."sourceKind" = 'submission-xml' THEN
        CASE WHEN budget.used <= 8388608 AND octet_length(sd.xml) <= 2097152 THEN
          e."contentHash" = 'sha256:' || encode(sha256(convert_to(sd.xml, 'UTF8')), 'hex')
          ELSE NULL END
        WHEN budget.used <= 8388608 AND b.content IS NOT NULL AND octet_length(b.content) <= 2097152 THEN
          e."contentHash" = 'sha256:' || encode(sha256(b.content), 'hex')
        ELSE NULL END AS "hashMatches",
      (e."sourceKind" <> 'submission-xml' AND e."blobId" IS NULL) AS missing,
      verification."verifiedAt", verification.basis AS "verificationBasis",
      verification."legacySha1Matched"
    FROM field_data_evidence_records e
    JOIN byte_budget budget ON budget.id = e.id
    JOIN submission_defs sd ON sd.id = e."submissionDefId"
    JOIN field_data_claim_versions v ON v."submissionDefId" = sd.id AND v.id = ${versionId}
    LEFT JOIN blobs b ON b.id = e."blobId"
    LEFT JOIN field_data_evidence_verifications verification ON verification."evidenceId" = e.id
    WHERE e.id IN (SELECT "evidenceId" FROM selected_links)
  ), derived AS MATERIALIZED (
    SELECT d.id, d."evidenceId", d.kind, d.algorithm, d."algorithmVersion", d."createdAt"
    FROM field_data_evidence_derivations d
    WHERE d."evidenceId" IN (SELECT id FROM originals)
    ORDER BY d."createdAt", d.id LIMIT 501
  ), decisions AS MATERIALIZED (
    SELECT d.id, d."caseId", d."previousDecisionId", d.sequence, d.outcome,
      d.override, d."reasonCode", d.note, d."reviewerId", d."createdAt",
      d."policyVersion", d."evidenceSnapshotHash"
    FROM field_data_review_decisions d WHERE d."claimVersionId" = ${versionId}
    ORDER BY d."createdAt", d.id LIMIT 501
  )
  SELECT statement_timestamp() AS "generatedAt",
    COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l."createdAt", l.id)
      FROM selected_links l), '[]'::jsonb) AS links,
    COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e."receivedAt", e.id)
      FROM originals e), '[]'::jsonb) AS originals,
    COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d."createdAt", d.id)
      FROM (SELECT * FROM derived ORDER BY "createdAt", id LIMIT 500) d), '[]'::jsonb) AS derived,
    COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d."createdAt", d.id)
      FROM (SELECT * FROM decisions ORDER BY "createdAt", id LIMIT 500) d), '[]'::jsonb) AS decisions,
    jsonb_build_object('links', (SELECT count(*) <= 500 FROM links),
      'derivations', (SELECT count(*) <= 500 FROM derived),
      'decisions', (SELECT count(*) <= 500 FROM decisions)) AS completeness`);

module.exports = { read };
