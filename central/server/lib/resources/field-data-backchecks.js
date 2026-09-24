// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

const { createHash } = require('crypto');
const { sql } = require('slonik');
const { Form } = require('../model/frames');
const { UUID_PATTERN } = require('../util/claim-versioning');
const { getOrNotFound } = require('../util/promise');
const Problem = require('../util/problem');

const scopeFor = async (container, auth, caseId, edit = false) => {
  if (!UUID_PATTERN.test(caseId)) throw Problem.user.notFound();
  const reviewCase = await container.FieldDataReviews.getCase(caseId);
  if (reviewCase == null) throw Problem.user.notFound();
  const claim = await container.FieldDataClaims.getByVersionId(reviewCase.claimVersionId);
  if (claim == null) throw Problem.user.notFound();
  const form = await container.Forms.getByProjectAndXmlFormId(
    claim.scope.projectId, claim.scope.xmlFormId, Form.WithoutDef, Form.WithoutXml
  ).then(getOrNotFound);
  try { await auth.canOrReject(edit ? 'submission.update' : 'submission.read', form); } catch (error) {
    if (error?.problemCode === Problem.user.insufficientRights.code)
      throw Problem.user.notFound();
    throw error;
  }
  return { reviewCase, claim, form };
};

const matchRevision = (headers) => {
  if (headers['if-match'] == null) throw Problem.user.reviewRevisionRequired();
  const matched = /^"review-case-([1-9]\d*)"$/.exec(headers['if-match']);
  if (matched == null || !Number.isSafeInteger(Number(matched[1])))
    throw Problem.user.reviewAssignmentInvalid();
  return Number(matched[1]);
};

const hash = (body) => createHash('sha256').update(JSON.stringify(body)).digest('hex');

module.exports = (service, endpoint) => {
  service.get('/field-data/review-queue/:caseId/backcheck-assignees', endpoint(async (
    container, { params, auth }
  ) => {
    const { form, claim } = await scopeFor(container, auth, params.caseId, true);
    return container.db.any(sql`SELECT fk."actorId" AS id, a."displayName" AS name
      FROM field_keys fk JOIN actors a ON a.id = fk."actorId"
      WHERE fk."projectId" = ${claim.scope.projectId} AND a."deletedAt" IS NULL
        AND EXISTS (SELECT 1 FROM assignments ass JOIN roles r ON r.id = ass."roleId"
          WHERE ass."actorId" = a.id AND ass."acteeId" = ${form.acteeId}
            AND r.verbs ? 'submission.create')
      ORDER BY a."displayName", a.id`);
  }));

  service.get('/field-data/review-queue/:caseId/backchecks', endpoint(async (
    container, { params, auth }, request, response
  ) => {
    await scopeFor(container, auth, params.caseId);
    response.set('Cache-Control', 'private, no-store');
    return container.db.any(sql`SELECT b.id, b."caseId", b."claimVersionId",
      b.question, b."dueAt", b.status, b."assignedTo", a."displayName" AS "assigneeName",
      b."responseInstanceId", b."createdAt", b."linkedAt",
      p."capturedAt" AS "responseCapturedAt", p.degraded AS "responseDegraded",
      p."integrityHash" AS "responseIntegrityHash"
      FROM field_data_backchecks b
      LEFT JOIN actors a ON a.id = b."assignedTo"
      LEFT JOIN field_data_submission_provenance p
        ON p."submissionDefId" = b."responseSubmissionDefId"
      WHERE b."caseId" = ${params.caseId} ORDER BY b."createdAt", b.id`);
  }));

  service.post('/field-data/review-queue/:caseId/backchecks', endpoint(async (
    container, { params, auth, body, headers }, request, response
  ) => {
    const { reviewCase, claim, form } = await scopeFor(container, auth, params.caseId, true);
    const reviewerId = auth.actor.map((actor) => actor.id).orNull();
    const revision = matchRevision(headers);
    if (reviewerId == null || body == null || Object.keys(body).some((field) =>
      !['requestId', 'assignedTo', 'question', 'dueAt'].includes(field))
      || !UUID_PATTERN.test(body.requestId ?? '')
      || !Number.isSafeInteger(body.assignedTo) || body.assignedTo < 1
      || typeof body.question !== 'string' || body.question.trim().length === 0
      || body.question.length > 2000 || (body.dueAt != null
        && (typeof body.dueAt !== 'string' || Number.isNaN(Date.parse(body.dueAt)))))
      throw Problem.user.reviewAssignmentInvalid();
    const question = body.question.trim();
    const dueAt = body.dueAt ?? null;
    const requestHash = hash({ assignedTo: body.assignedTo, question, dueAt });
    const result = await container.transacting(async (tx) => {
      const [locked] = await tx.db.any(sql`SELECT c.revision, c.status, c."assignedTo",
        sd.current, s."submitterId" AS "originalSubmitterId"
        FROM field_data_review_cases c
        JOIN field_data_claim_versions v ON v.id = c."claimVersionId"
        JOIN submission_defs sd ON sd.id = v."submissionDefId"
        JOIN submissions s ON s.id = sd."submissionId"
        WHERE c.id = ${params.caseId} FOR UPDATE OF c`);
      if (locked == null) throw Problem.user.notFound();
      const [existing] = await tx.db.any(sql`SELECT id, "requestHash" FROM field_data_backchecks
        WHERE "caseId" = ${params.caseId} AND "requestId" = ${body.requestId}`);
      if (existing != null) {
        if (existing.requestHash !== requestHash) throw Problem.user.reviewAssignmentInvalid();
        return { id: existing.id, revision: locked.revision, replayed: true };
      }
      if (locked.revision !== revision) throw Problem.user.reviewRevisionStale();
      if (locked.status !== 'in-review' || locked.assignedTo !== reviewerId || !locked.current)
        throw Problem.user.reviewCaseClosed();
      if (body.assignedTo === locked.originalSubmitterId)
        throw Problem.user.reviewAssignmentInvalid();
      const assignee = await tx.db.any(sql`SELECT 1 FROM field_keys fk
        JOIN actors a ON a.id = fk."actorId" AND a."deletedAt" IS NULL
        JOIN assignments ass ON ass."actorId" = a.id AND ass."acteeId" = ${form.acteeId}
        JOIN roles r ON r.id = ass."roleId" AND r.verbs ? 'submission.create'
        WHERE fk."projectId" = ${claim.scope.projectId}
          AND fk."actorId" = ${body.assignedTo} LIMIT 1`);
      if (assignee.length === 0) throw Problem.user.reviewAssignmentInvalid();
      const pending = await tx.db.any(sql`SELECT id FROM field_data_backchecks
        WHERE "caseId" = ${params.caseId} AND status = 'requested' LIMIT 1`);
      if (pending.length > 0) throw Problem.user.reviewCaseClosed();
      const inserted = await tx.db.one(sql`INSERT INTO field_data_backchecks
        ("caseId", "claimVersionId", "requestId", "requestHash", "requestedBy",
          "assignedTo", question, "dueAt")
        VALUES (${params.caseId}, ${reviewCase.claimVersionId}, ${body.requestId},
          ${requestHash}, ${reviewerId}, ${body.assignedTo}, ${question}, ${dueAt})
        RETURNING id`);
      await tx.db.query(sql`UPDATE field_data_review_cases
        SET revision = revision + 1, "updatedAt" = clock_timestamp()
        WHERE id = ${params.caseId}`);
      await tx.db.query(sql`INSERT INTO audits ("actorId", action, "acteeId", details,
        "loggedAt", processed, failures)
        VALUES (${reviewerId}, 'field_data.backcheck.request', ${form.acteeId},
          ${JSON.stringify({ caseId: params.caseId, backcheckId: inserted.id,
    claimVersionId: reviewCase.claimVersionId, assignedTo: body.assignedTo })},
          clock_timestamp(), clock_timestamp(), 0)`);
      return { id: inserted.id, revision: locked.revision + 1, replayed: false };
    });
    response.set('ETag', `"review-case-${result.revision}"`);
    response.set('Cache-Control', 'private, no-store');
    response.set('Idempotency-Status', result.replayed ? 'replayed' : 'created');
    response.status(201);
    return { id: result.id, caseId: params.caseId, status: 'requested' };
  }));

  service.post('/field-data/review-queue/:caseId/backchecks/:backcheckId/link', endpoint(async (
    container, { params, auth, body, headers }, request, response
  ) => {
    const { reviewCase, claim, form } = await scopeFor(container, auth, params.caseId, true);
    if (!UUID_PATTERN.test(params.backcheckId) || body == null
      || Object.keys(body).some((field) => field !== 'instanceId')
      || typeof body.instanceId !== 'string' || body.instanceId.length < 1
      || body.instanceId.length > 255) throw Problem.user.reviewAssignmentInvalid();
    const reviewerId = auth.actor.map((actor) => actor.id).orNull();
    const revision = matchRevision(headers);
    const result = await container.transacting(async (tx) => {
      const [locked] = await tx.db.any(sql`SELECT revision, status, "assignedTo"
        FROM field_data_review_cases WHERE id = ${params.caseId} FOR UPDATE`);
      const [backcheck] = await tx.db.any(sql`SELECT id, status, "assignedTo",
        "responseInstanceId", "claimVersionId" FROM field_data_backchecks
        WHERE id = ${params.backcheckId} AND "caseId" = ${params.caseId} FOR UPDATE`);
      if (locked == null || backcheck == null) throw Problem.user.notFound();
      if (backcheck.status === 'linked' && backcheck.responseInstanceId === body.instanceId)
        return { revision: locked.revision, replayed: true };
      if (locked.revision !== revision) throw Problem.user.reviewRevisionStale();
      if (locked.status !== 'in-review' || locked.assignedTo !== reviewerId
        || reviewCase.claimVersionId !== backcheck.claimVersionId
        || backcheck.status !== 'requested') throw Problem.user.reviewCaseClosed();
      const [submitted] = await tx.db.any(sql`SELECT sd.id, s."submitterId"
        FROM submissions s JOIN submission_defs sd
          ON sd."submissionId" = s.id AND sd.current IS TRUE
        WHERE s."formId" = ${claim.scope.formId}
          AND s."instanceId" = ${body.instanceId}
          AND s."deletedAt" IS NULL AND s.draft IS FALSE`);
      if (submitted == null || submitted.submitterId !== backcheck.assignedTo
        || body.instanceId === claim.body.claim.rootInstanceId)
        throw Problem.user.reviewAssignmentInvalid();
      await tx.db.query(sql`UPDATE field_data_backchecks
        SET status = 'linked', "responseSubmissionDefId" = ${submitted.id},
          "responseInstanceId" = ${body.instanceId}, "linkedBy" = ${reviewerId},
          "linkedAt" = clock_timestamp()
        WHERE id = ${params.backcheckId}`);
      await tx.db.query(sql`UPDATE field_data_review_cases
        SET revision = revision + 1, "updatedAt" = clock_timestamp()
        WHERE id = ${params.caseId}`);
      await tx.db.query(sql`INSERT INTO audits ("actorId", action, "acteeId", details,
        "loggedAt", processed, failures)
        VALUES (${reviewerId}, 'field_data.backcheck.link', ${form.acteeId},
          ${JSON.stringify({ caseId: params.caseId, backcheckId: params.backcheckId,
    responseSubmissionDefId: submitted.id, instanceId: body.instanceId })},
          clock_timestamp(), clock_timestamp(), 0)`);
      return { revision: locked.revision + 1, replayed: false };
    });
    response.set('ETag', `"review-case-${result.revision}"`);
    response.set('Cache-Control', 'private, no-store');
    response.set('Idempotency-Status', result.replayed ? 'replayed' : 'created');
    return { id: params.backcheckId, status: 'linked', revision: result.revision };
  }));
};
