// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

const { Form } = require('../model/frames');
const { UUID_PATTERN } = require('../util/claim-versioning');
const { getOrNotFound } = require('../util/promise');
const Problem = require('../util/problem');
const { encodeCursor, decodeCursor } = require('../util/review-queue');
const { validateKey, hashReviewAssignment, hashReviewRelease,
  hashNeedsEvidence } = require('../util/idempotency');

const authorize = async (auth, form) => {
  try { await auth.canOrReject('submission.read', form); } catch (error) {
    if (error?.problemCode === Problem.user.insufficientRights.code)
      throw Problem.user.notFound();
    throw error;
  }
};

module.exports = (service, endpoint) => {
  service.post('/field-data/review-queue/:caseId/decisions', endpoint(async (
    container, { params, auth, body, headers }, request, response
  ) => {
    if (!UUID_PATTERN.test(params.caseId)) throw Problem.user.notFound();
    const reviewCase = await container.FieldDataReviews.getCase(params.caseId);
    if (reviewCase == null) throw Problem.user.notFound();
    const claim = await container.FieldDataClaims.getByVersionId(reviewCase.claimVersionId);
    if (claim == null) throw Problem.user.notFound();
    const form = await container.Forms.getByProjectAndXmlFormId(
      claim.scope.projectId, claim.scope.xmlFormId, Form.WithoutDef, Form.WithoutXml
    ).then(getOrNotFound);
    try { await auth.canOrReject('submission.update', form); } catch (error) {
      if (error?.problemCode === Problem.user.insufficientRights.code)
        throw Problem.user.notFound();
      throw error;
    }
    const actorId = auth.actor.map((actor) => actor.id).orNull();
    if (actorId == null || body == null || Object.keys(body).some((field) =>
      !['outcome', 'override', 'reasonCode', 'note', 'evidenceIds', 'integrityFindingIds'].includes(field))
      || body.outcome !== 'needs-evidence' || body.override !== false
      || typeof body.reasonCode !== 'string' || !reviewCase.reasonCodes.includes(body.reasonCode)
      || typeof body.note !== 'string' || body.note.trim().length < 1
      || body.note.length > 4000 || !Array.isArray(body.evidenceIds)
      || body.evidenceIds.length !== 0 || !Array.isArray(body.integrityFindingIds)
      || body.integrityFindingIds.length !== 0)
      throw Problem.user.reviewAssignmentInvalid();
    const match = headers['if-match'];
    if (match == null) throw Problem.user.reviewRevisionRequired();
    const parsed = /^"review-case-([1-9]\d*)"$/.exec(match);
    if (parsed == null || !Number.isSafeInteger(Number(parsed[1])))
      throw Problem.user.reviewAssignmentInvalid();
    let key;
    try { key = validateKey(headers['idempotency-key']); } catch (error) {
      throw error.code === 'IDEMPOTENCY_KEY_REQUIRED'
        ? Problem.user.idempotencyKeyRequired() : Problem.user.idempotencyKeyInvalid();
    }
    const revision = Number(parsed[1]);
    const { reasonCode } = body;
    const note = body.note.trim();
    const requestHash = hashNeedsEvidence({
      caseId: params.caseId, revision, actorId, reasonCode, note
    });
    const result = await container.transacting((tx) => tx.FieldDataReviews.decideNeedsEvidence({
      caseId: params.caseId, revision, actorId, projectId: claim.scope.projectId,
      formActeeId: form.acteeId, key, requestHash, reasonCode, note
    }));
    response.set('ETag', `"review-case-${result.revision}"`);
    response.set('Idempotency-Key', key);
    response.set('Idempotency-Status', result.replayed ? 'replayed' : 'created');
    response.set('Cache-Control', 'private, no-store');
    response.status(201);
    return { id: result.id, caseId: params.caseId, outcome: 'needs-evidence',
      status: 'open', revision: result.revision };
  }));

  service.patch('/field-data/review-queue/:caseId/assignment', endpoint(async (
    container, { params, auth, body, headers },
    request, response
  ) => {
    const { FieldDataReviews, FieldDataClaims, Forms } = container;
    if (!UUID_PATTERN.test(params.caseId)) throw Problem.user.notFound();
    const reviewCase = await FieldDataReviews.getCase(params.caseId);
    if (reviewCase == null) throw Problem.user.notFound();
    const claim = await FieldDataClaims.getByVersionId(reviewCase.claimVersionId);
    if (claim == null) throw Problem.user.notFound();
    const form = await Forms.getByProjectAndXmlFormId(
      claim.scope.projectId, claim.scope.xmlFormId, Form.WithoutDef, Form.WithoutXml
    ).then(getOrNotFound);
    try { await auth.canOrReject('submission.update', form); } catch (error) {
      if (error?.problemCode === Problem.user.insufficientRights.code)
        throw Problem.user.notFound();
      throw error;
    }
    const actorId = auth.actor.map((actor) => actor.id).orNull();
    const claiming = body?.assignedTo === actorId && body?.status === 'in-review';
    const releasing = body?.assignedTo === null && body?.status === 'open';
    if (actorId == null || (!claiming && !releasing)
      || Object.keys(body).length !== 2)
      throw Problem.user.reviewAssignmentInvalid();
    const match = headers['if-match'];
    if (match == null) throw Problem.user.reviewRevisionRequired();
    const parsed = /^"review-case-([1-9]\d*)"$/.exec(match);
    if (parsed == null || !Number.isSafeInteger(Number(parsed[1])))
      throw Problem.user.reviewAssignmentInvalid();
    let key;
    try { key = validateKey(headers['idempotency-key']); } catch (error) {
      throw error.code === 'IDEMPOTENCY_KEY_REQUIRED'
        ? Problem.user.idempotencyKeyRequired() : Problem.user.idempotencyKeyInvalid();
    }
    const revision = Number(parsed[1]);
    const requestHash = claiming
      ? hashReviewAssignment({ caseId: params.caseId, revision, assignedTo: actorId })
      : hashReviewRelease({ caseId: params.caseId, revision, actorId });
    const result = await container.transacting((tx) => tx.FieldDataReviews.assignToSelf({
      caseId: params.caseId, revision, actorId, projectId: claim.scope.projectId,
      formActeeId: form.acteeId, key, requestHash, releasing
    }));
    response.set('ETag', `"review-case-${result.revision}"`);
    response.set('Idempotency-Key', key);
    response.set('Idempotency-Status', result.replayed ? 'replayed' : 'created');
    response.set('Cache-Control', 'private, no-store');
    return { id: result.id, revision: result.revision,
      status: releasing ? 'open' : 'in-review', assignedTo: releasing ? null : actorId };
  }));

  service.get('/field-data/review-queue', endpoint(async (
    { FieldDataReviews, Forms }, { query, auth }, request, response
  ) => {
    const { projectId, xmlFormId, status = 'open', priority, reasonCode,
      cursor: rawCursor, limit: rawLimit = '50' } = query;
    if (!/^[1-9]\d*$/.test(projectId) || typeof xmlFormId !== 'string'
      || xmlFormId.length === 0 || !['open', 'in-review', 'resolved', 'superseded'].includes(status)
      || (priority != null && !['low', 'normal', 'high', 'urgent'].includes(priority))
      || (reasonCode != null && (typeof reasonCode !== 'string' || reasonCode.length > 100))
      || !/^\d+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 100)
      throw Problem.user.reviewQueueInvalid();
    let cursor = null;
    if (rawCursor != null) {
      try { cursor = decodeCursor(rawCursor); } catch (error) {
        throw Problem.user.reviewCursorInvalid();
      }
    }
    const form = await Forms.getByProjectAndXmlFormId(
      Number(projectId), xmlFormId, Form.WithoutDef, Form.WithoutXml
    ).then(getOrNotFound);
    await authorize(auth, form);
    const max = Number(rawLimit);
    const rows = await FieldDataReviews.listCases({ projectId: Number(projectId),
      xmlFormId, status, priority, reasonCode, cursor, limit: max });
    const page = rows.slice(0, max);
    const items = page.map((row) => ({ id: row.id, claimVersionId: row.claimVersionId,
      revision: row.revision, status: row.status, priority: row.priority,
      reasonCodes: row.reasonCodes, assignedTo: row.assignedTo,
      openedAt: row.openedAt, updatedAt: row.updatedAt,
      claim: { id: row.claimId, ordinal: row.ordinal, current: row.current,
        rootInstanceId: row.rootInstanceId },
      provenance: { origin: row.provenanceOrigin, degraded: row.provenanceDegraded },
      etag: `"review-case-${row.revision}"` }));
    const last = page.at(-1);
    response.set('Cache-Control', 'private, no-store');
    return { items, nextCursor: rows.length > max ? encodeCursor({
      rank: last.rank, openedAt: last.openedAt, id: last.id
    }) : null };
  }));

  service.get('/field-data/review-queue/:caseId', endpoint(async (
    { FieldDataReviews, FieldDataClaims, Forms }, { params, auth }, request, response
  ) => {
    if (!UUID_PATTERN.test(params.caseId)) throw Problem.user.notFound();
    const reviewCase = await FieldDataReviews.getCase(params.caseId);
    if (reviewCase == null) throw Problem.user.notFound();
    const claim = await FieldDataClaims.getByVersionId(reviewCase.claimVersionId);
    if (claim == null) throw Problem.user.notFound();
    const form = await Forms.getByProjectAndXmlFormId(
      claim.scope.projectId, claim.scope.xmlFormId, Form.WithoutDef, Form.WithoutXml
    ).then(getOrNotFound);
    await authorize(auth, form);
    const decisions = await FieldDataReviews.listDecisions(params.caseId);
    response.set('ETag', `"review-case-${reviewCase.revision}"`);
    response.set('Cache-Control', 'private, no-store');
    return { id: reviewCase.id, revision: reviewCase.revision,
      status: reviewCase.status, priority: reviewCase.priority,
      reasonCodes: reviewCase.reasonCodes, assignedTo: reviewCase.assignedTo,
      openedAt: reviewCase.openedAt, updatedAt: reviewCase.updatedAt,
      resolvedAt: reviewCase.resolvedAt, supersededByCaseId: reviewCase.supersededByCaseId,
      policyVersion: reviewCase.policyVersion,
      claim: claim.body, submissionReviewState: reviewCase.submissionReviewState,
      decisions };
  }));
};
