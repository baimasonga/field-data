// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

const { sql } = require('slonik');

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

module.exports = { getCase, listDecisions };
