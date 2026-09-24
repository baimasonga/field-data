// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

const { sql } = require('slonik');
const Problem = require('../../util/problem');

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

// Called inside a container transaction. The idempotency row serializes retries
// and the case row serializes competing reviewers.
const assignToSelf = ({ caseId, revision, actorId, projectId, formActeeId,
  key, requestHash }) => async ({ all, one, run }) => {
  const reserved = await all(sql`INSERT INTO field_data_idempotency_records
    ("projectId", "operationType", "idempotencyKey", "requestHash", status, "policyVersion")
    VALUES (${projectId}, 'review.case.assign', ${key}, ${requestHash}, 'in-progress', 'p0.5')
    ON CONFLICT ("projectId", "operationType", "idempotencyKey") DO NOTHING
    RETURNING id`);
  const record = await one(sql`SELECT "requestHash", status, "resourceId"
    FROM field_data_idempotency_records WHERE "projectId" = ${projectId}
      AND "operationType" = 'review.case.assign' AND "idempotencyKey" = ${key} FOR UPDATE`);
  if (record.requestHash !== requestHash) throw Problem.user.idempotencyKeyReused();
  if (reserved.length === 0) {
    if (record.status !== 'succeeded') throw Problem.user.idempotencyInProgress();
    return { id: record.resourceId, revision: revision + 1, replayed: true };
  }
  const rows = await all(sql`SELECT id, revision, status, "assignedTo"
    FROM field_data_review_cases WHERE id = ${caseId} FOR UPDATE`);
  if (rows.length === 0) throw Problem.user.notFound();
  const reviewCase = rows[0];
  if (reviewCase.revision !== revision) throw Problem.user.reviewRevisionStale();
  if (!['open', 'in-review'].includes(reviewCase.status))
    throw Problem.user.reviewCaseClosed();
  if (reviewCase.assignedTo != null && reviewCase.assignedTo !== actorId)
    throw Problem.user.reviewCaseAssigned();
  if (reviewCase.assignedTo === actorId) throw Problem.user.reviewCaseAssigned();
  await run(sql`UPDATE field_data_review_cases SET "assignedTo" = ${actorId},
    status = 'in-review', revision = revision + 1, "updatedAt" = clock_timestamp()
    WHERE id = ${caseId}`);
  await run(sql`INSERT INTO audits ("actorId", action, "acteeId", details,
    "loggedAt", processed, failures)
    VALUES (${actorId}, 'field_data.review.case.assign', ${formActeeId},
      ${JSON.stringify({ caseId, fromRevision: revision, assignedTo: actorId })},
      clock_timestamp(), clock_timestamp(), 0)`);
  await run(sql`UPDATE field_data_idempotency_records SET status = 'succeeded',
    "resourceId" = ${caseId}, "responseStatus" = 200, "completedAt" = clock_timestamp()
    WHERE "projectId" = ${projectId} AND "operationType" = 'review.case.assign'
      AND "idempotencyKey" = ${key}`);
  return { id: caseId, revision: revision + 1, replayed: false };
};

module.exports = { getCase, listDecisions, listCases, assignToSelf };
