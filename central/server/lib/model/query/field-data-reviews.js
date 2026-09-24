// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

const { sql } = require('slonik');

const listCases = ({ projectId, xmlFormId, status, priority, reasonCode, cursor, limit }) =>
  ({ all }) => all(sql`
    WITH queue AS (
      SELECT c.id, c."claimVersionId", c.status, c.priority, c."reasonCodes",
        c."assignedTo", c.revision,
        date_trunc('milliseconds', c."openedAt") AS "openedAt", c."updatedAt",
        v."claimId", v.ordinal, sd.current, s."instanceId" AS "rootInstanceId",
        CASE c.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1
          WHEN 'normal' THEN 2 ELSE 3 END AS rank,
        p.origin AS "provenanceOrigin", p.degraded AS "provenanceDegraded"
      FROM field_data_review_cases c
      JOIN field_data_claim_versions v ON v.id = c."claimVersionId"
      JOIN submission_defs sd ON sd.id = v."submissionDefId"
      JOIN field_data_claims claim ON claim.id = v."claimId"
      JOIN submissions s ON s.id = claim."submissionId" AND s."deletedAt" IS NULL
      JOIN forms f ON f.id = s."formId"
      LEFT JOIN field_data_submission_provenance p ON p."submissionDefId" = sd.id
      WHERE f."projectId" = ${projectId} AND f."xmlFormId" = ${xmlFormId}
        AND c.status = ${status}
        AND ${priority == null ? sql`TRUE` : sql`c.priority = ${priority}`}
        AND ${reasonCode == null ? sql`TRUE` : sql`c."reasonCodes" @> ${JSON.stringify([reasonCode])}::jsonb`}
    )
    SELECT * FROM queue
    WHERE ${cursor == null ? sql`TRUE` : sql`(rank, "openedAt", id) >
      (${cursor.rank}, ${cursor.openedAt}::timestamptz, ${cursor.id}::uuid)`}
    ORDER BY rank, "openedAt", id LIMIT ${limit + 1}`);

const getCase = (caseId) => ({ all }) => all(sql`
  SELECT c.id, c."claimVersionId", c.status, c.priority, c."reasonCodes",
    c."assignedTo", c.revision, c."openedAt", c."updatedAt", c."resolvedAt",
    c."supersededByCaseId", c."policyVersion", s."reviewState" AS "submissionReviewState"
  FROM field_data_review_cases c
  JOIN field_data_claim_versions v ON v.id = c."claimVersionId"
  JOIN field_data_claims claim ON claim.id = v."claimId"
  JOIN submissions s ON s.id = claim."submissionId" AND s."deletedAt" IS NULL
  WHERE c.id = ${caseId}`).then((rows) => rows[0] ?? null);

const listDecisions = (caseId) => ({ all }) => all(sql`
  SELECT id, "previousDecisionId", sequence, outcome, override, "reasonCode",
    note, "evidenceSnapshot", "evidenceSnapshotHash", "integritySnapshot",
    "reviewerId", "policyVersion", "createdAt"
  FROM field_data_review_decisions WHERE "caseId" = ${caseId}
  ORDER BY sequence`);

module.exports = { getCase, listDecisions, listCases };
