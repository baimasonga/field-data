// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { sql } = require('slonik');
const Problem = require('./problem');
const ALLOCATION_LOCK = 74143;
const requestBackcheck = async (db, { caseId, claimVersionId, projectId, formActeeId,
  responseForm, reviewerId, revision, requestId, requestHash, assignedTo, question, dueAt }) => {
  // Acquire before the case lock: manual requests and automatic allocation
  // share capacity serialization without changing manual override behavior.
  await db.query(sql`SELECT pg_advisory_xact_lock(${ALLOCATION_LOCK}, ${projectId})`);
  const [locked] = await db.any(sql`SELECT c.revision, c.status, c."assignedTo",
    sd.current, s."submitterId" AS "originalSubmitterId"
    FROM field_data_review_cases c
    JOIN field_data_claim_versions v ON v.id = c."claimVersionId"
    JOIN submission_defs sd ON sd.id = v."submissionDefId"
    JOIN submissions s ON s.id = sd."submissionId"
    WHERE c.id = ${caseId} FOR UPDATE OF c`);
  if (locked == null) throw Problem.user.notFound();
  const [existing] = await db.any(sql`SELECT id, status, "requestHash" FROM field_data_backchecks
    WHERE "caseId" = ${caseId} AND "requestId" = ${requestId}`);
  if (existing != null) {
    if (existing.requestHash !== requestHash) throw Problem.user.reviewAssignmentInvalid();
    return { id: existing.id, status: existing.status, revision: locked.revision, replayed: true };
  }
  if (locked.revision !== revision) throw Problem.user.reviewRevisionStale();
  if (locked.status !== 'in-review' || locked.assignedTo !== reviewerId || !locked.current)
    throw Problem.user.reviewCaseClosed();
  if (assignedTo === locked.originalSubmitterId)
    throw Problem.user.reviewAssignmentInvalid();
  const eligibleForm = await db.any(sql`SELECT id FROM forms
    WHERE id = ${responseForm.id} AND "deletedAt" IS NULL
      AND "currentDefId" IS NOT NULL AND state = 'open'`);
  if (eligibleForm.length === 0) throw Problem.user.reviewAssignmentInvalid();
  const assignee = await db.any(sql`SELECT 1 FROM field_keys fk
    JOIN actors a ON a.id = fk."actorId" AND a."deletedAt" IS NULL
    JOIN assignments ass ON ass."actorId" = a.id AND ass."acteeId" = ${responseForm.acteeId}
    JOIN roles r ON r.id = ass."roleId" AND r.verbs ? 'submission.create'
    WHERE fk."projectId" = ${projectId}
      AND fk."actorId" = ${assignedTo} LIMIT 1`);
  if (assignee.length === 0) throw Problem.user.reviewAssignmentInvalid();
  const pending = await db.any(sql`SELECT id FROM field_data_backchecks
    WHERE "caseId" = ${caseId} AND status = 'requested' LIMIT 1`);
  if (pending.length > 0) throw Problem.user.reviewCaseClosed();
  const inserted = await db.one(sql`INSERT INTO field_data_backchecks
    ("caseId", "claimVersionId", "requestId", "requestHash", "requestedBy",
      "assignedTo", question, "dueAt", "responseFormId")
    VALUES (${caseId}, ${claimVersionId}, ${requestId},
      ${requestHash}, ${reviewerId}, ${assignedTo}, ${question}, ${dueAt}, ${responseForm.id})
    RETURNING id`);
  await db.query(sql`UPDATE field_data_review_cases
    SET revision = revision + 1, "updatedAt" = clock_timestamp()
    WHERE id = ${caseId}`);
  await db.query(sql`INSERT INTO audits ("actorId", action, "acteeId", details,
    "loggedAt", processed, failures)
    VALUES (${reviewerId}, 'field_data.backcheck.request', ${formActeeId},
      ${JSON.stringify({ caseId, backcheckId: inserted.id,
    claimVersionId, assignedTo, responseFormId: responseForm.id })},
      clock_timestamp(), NULL, 0)`);
  return { id: inserted.id, status: 'requested', revision: locked.revision + 1, replayed: false };
};
module.exports = { requestBackcheck, ALLOCATION_LOCK };
