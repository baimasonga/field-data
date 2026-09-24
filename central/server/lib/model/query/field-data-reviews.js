// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

const { sql } = require('slonik');
const { v4: uuid } = require('uuid');
const Problem = require('../../util/problem');
const { snapshotDigest } = require('../../util/review-surface');

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
  key, requestHash, releasing = false }) => async ({ all, one, run }) => {
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
  if (releasing ? (reviewCase.status !== 'in-review' || reviewCase.assignedTo !== actorId)
    : reviewCase.assignedTo != null)
    throw Problem.user.reviewCaseAssigned();
  await run(sql`UPDATE field_data_review_cases SET "assignedTo" = ${releasing ? null : actorId},
    status = ${releasing ? 'open' : 'in-review'}, revision = revision + 1,
    "updatedAt" = clock_timestamp()
    WHERE id = ${caseId}`);
  await run(sql`INSERT INTO audits ("actorId", action, "acteeId", details,
    "loggedAt", processed, failures)
    VALUES (${actorId}, ${releasing ? 'field_data.review.case.release' : 'field_data.review.case.assign'},
      ${formActeeId},
      ${JSON.stringify({ caseId, fromRevision: revision, assignedTo: releasing ? null : actorId })},
      clock_timestamp(), clock_timestamp(), 0)`);
  await run(sql`UPDATE field_data_idempotency_records SET status = 'succeeded',
    "resourceId" = ${caseId}, "responseStatus" = 200, "completedAt" = clock_timestamp()
    WHERE "projectId" = ${projectId} AND "operationType" = 'review.case.assign'
      AND "idempotencyKey" = ${key}`);
  return { id: caseId, revision: revision + 1, replayed: false };
};

const recordDecision = ({ caseId, revision, actorId, projectId, formActeeId,
  key, requestHash, reasonCode, note, outcome }) => async ({ all, one, run }) => {
  const reserved = await all(sql`INSERT INTO field_data_idempotency_records
    ("projectId", "operationType", "idempotencyKey", "requestHash", status, "policyVersion")
    VALUES (${projectId}, 'review.case.decide', ${key}, ${requestHash}, 'in-progress', 'p0.5')
    ON CONFLICT ("projectId", "operationType", "idempotencyKey") DO NOTHING RETURNING id`);
  const ledger = await one(sql`SELECT "requestHash", status, "resourceId"
    FROM field_data_idempotency_records WHERE "projectId" = ${projectId}
      AND "operationType" = 'review.case.decide' AND "idempotencyKey" = ${key} FOR UPDATE`);
  if (ledger.requestHash !== requestHash) throw Problem.user.idempotencyKeyReused();
  if (reserved.length === 0) {
    if (ledger.status !== 'succeeded') throw Problem.user.idempotencyInProgress();
    return { id: ledger.resourceId, revision: revision + 1, replayed: true };
  }
  const rows = await all(sql`SELECT c.id, c.revision, c.status, c."assignedTo",
    c."claimVersionId", c."reasonCodes", v."claimId", v."submissionDefId",
    v.degraded AS "claimDegraded", p.degraded AS "provenanceDegraded",
    sd.current, claim."submissionId", s."instanceId", s."formId"
    FROM field_data_review_cases c
    JOIN field_data_claim_versions v ON v.id = c."claimVersionId"
    JOIN submission_defs sd ON sd.id = v."submissionDefId"
    JOIN field_data_claims claim ON claim.id = v."claimId"
    JOIN submissions s ON s.id = claim."submissionId" AND s."deletedAt" IS NULL
    JOIN forms f ON f.id = s."formId" AND f."projectId" = ${projectId}
    LEFT JOIN field_data_submission_provenance p ON p."submissionDefId" = sd.id
    WHERE c.id = ${caseId} FOR UPDATE OF c`);
  if (rows.length === 0) throw Problem.user.notFound();
  const reviewCase = rows[0];
  if (reviewCase.revision !== revision) throw Problem.user.reviewRevisionStale();
  if (!reviewCase.current || reviewCase.status === 'superseded')
    throw Problem.user.reviewCaseClosed();
  if (reviewCase.status !== 'in-review' || reviewCase.assignedTo !== actorId)
    throw Problem.user.reviewCaseAssigned();
  if (!reviewCase.reasonCodes.includes(reasonCode))
    throw Problem.user.reviewAssignmentInvalid();
  if (outcome !== 'needs-evidence') {
    const pending = await all(sql`SELECT id FROM field_data_backchecks
      WHERE "caseId" = ${caseId} AND status = 'requested' LIMIT 1`);
    if (pending.length > 0) throw Problem.user.reviewAcceptanceBlocked();
  }
  // The FK key-share lock taken by link insertion conflicts with this row
  // lock, so no new evidence link can appear between the snapshot and commit.
  await one(sql`SELECT id FROM field_data_claim_versions
    WHERE id = ${reviewCase.claimVersionId} FOR UPDATE`);
  const currentDef = await one(sql`SELECT current FROM submission_defs
    WHERE id = ${reviewCase.submissionDefId} FOR SHARE`);
  if (!currentDef.current) throw Problem.user.reviewCaseClosed();
  const evidence = await all(sql`SELECT e.id, l.relation, e."sourceKind",
    e."contentHash", e."policyVersion",
    CASE WHEN e."sourceKind" = 'submission-xml' THEN
      e."contentHash" = 'sha256:' || encode(sha256(convert_to(sd.xml, 'UTF8')), 'hex')
      WHEN b.content IS NOT NULL THEN
        e."contentHash" = 'sha256:' || encode(sha256(b.content), 'hex')
      ELSE NULL END AS "hashMatches"
    FROM field_data_claim_evidence l
    JOIN field_data_evidence_records e ON e.id = l."evidenceId"
    JOIN submission_defs sd ON sd.id = e."submissionDefId"
    LEFT JOIN blobs b ON b.id = e."blobId"
    WHERE l."claimVersionId" = ${reviewCase.claimVersionId}
      AND e."submissionDefId" = ${reviewCase.submissionDefId}
    ORDER BY e.id, l.relation`);
  const totalLinks = await one(sql`SELECT count(*)::integer AS count
    FROM field_data_claim_evidence WHERE "claimVersionId" = ${reviewCase.claimVersionId}`);
  if (totalLinks.count !== evidence.length) throw Problem.user.reviewAssignmentInvalid();
  const findings = await all(sql`SELECT id, rule, "ruleVersion", outcome, status,
    evidence, decision FROM field_data_integrity_flags
    WHERE "formId" = ${reviewCase.formId} AND
      ("instanceId" = ${reviewCase.instanceId}
        OR "relatedInstanceId" = ${reviewCase.instanceId})
    ORDER BY id FOR SHARE`);
  if (outcome === 'accepted' && (evidence.length === 0
    || evidence.some((item) => item.hashMatches !== true || item.relation === 'contradicts')
    || findings.some((item) => item.status !== 'resolved')
    || reviewCase.claimDegraded != null || reviewCase.provenanceDegraded != null))
    throw Problem.user.reviewAcceptanceBlocked();
  let snapshot;
  try {
    snapshot = snapshotDigest(evidence.map((e) => ({
      id: e.id, relation: e.relation, sourceKind: e.sourceKind,
      contentHash: e.contentHash, policyVersion: e.policyVersion,
      integrityStatus: e.hashMatches === true ? 'verified'
        : e.hashMatches === false ? 'mismatch' : 'unverified'
    })));
    snapshotDigest(findings);
  } catch (error) { throw Problem.user.reviewAssignmentInvalid(); }
  const previous = await all(sql`SELECT id, sequence FROM field_data_review_decisions
    WHERE "caseId" = ${caseId} ORDER BY sequence DESC LIMIT 1`);
  const decisionId = uuid();
  await run(sql`INSERT INTO field_data_review_decisions
    (id, "caseId", "claimVersionId", "previousDecisionId", sequence,
      outcome, override, "reasonCode", note, "evidenceSnapshot",
      "evidenceSnapshotHash", "integritySnapshot", "reviewerId")
    VALUES (${decisionId}, ${caseId}, ${reviewCase.claimVersionId},
      ${previous[0]?.id ?? null}, ${(previous[0]?.sequence ?? 0) + 1},
      ${outcome}, false, ${reasonCode}, ${note},
      ${JSON.stringify(evidence.map((e) => ({
    id: e.id, relation: e.relation, sourceKind: e.sourceKind,
    contentHash: e.contentHash, policyVersion: e.policyVersion,
    integrityStatus: e.hashMatches === true ? 'verified'
      : e.hashMatches === false ? 'mismatch' : 'unverified'
  })))}, ${snapshot.hash}, ${JSON.stringify(findings)}, ${actorId})`);
  await run(sql`UPDATE field_data_review_cases
    SET status = ${outcome === 'needs-evidence' ? 'open' : 'resolved'},
    "resolvedAt" = ${outcome === 'needs-evidence' ? null : sql`clock_timestamp()`},
    "assignedTo" = NULL, revision = revision + 1, "updatedAt" = clock_timestamp()
    WHERE id = ${caseId}`);
  await run(sql`INSERT INTO audits ("actorId", action, "acteeId", details,
    "loggedAt", processed, failures)
    VALUES (${actorId}, 'field_data.review.case.decide', ${formActeeId},
      ${JSON.stringify({ submissionId: reviewCase.submissionId,
    submissionDefId: reviewCase.submissionDefId, claimId: reviewCase.claimId,
    claimVersionId: reviewCase.claimVersionId, caseId, decisionId,
    outcome, override: false, reasonCode })},
      clock_timestamp(), clock_timestamp(), 0)`);
  await run(sql`UPDATE field_data_idempotency_records SET status = 'succeeded',
    "resourceId" = ${decisionId}, "responseStatus" = 201,
    "completedAt" = clock_timestamp()
    WHERE "projectId" = ${projectId} AND "operationType" = 'review.case.decide'
      AND "idempotencyKey" = ${key}`);
  return { id: decisionId, revision: revision + 1, replayed: false };
};

module.exports = { getCase, listDecisions, listCases, assignToSelf, recordDecision };
