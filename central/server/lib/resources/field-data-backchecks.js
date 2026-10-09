// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

const { createHash } = require('crypto');
const { sql } = require('slonik');
const { Form } = require('../model/frames');
const { UUID_PATTERN } = require('../util/claim-versioning');
const { getOrNotFound } = require('../util/promise');
const Problem = require('../util/problem');
const { answers, compareAnswers, compareMappedAnswers, validatePairs, MAX_BYTES } = require('../util/backcheck-comparison');
const { trackReviewWrite, observeReviewConflicts } = require('../util/review-conflicts');

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

const responseFormFor = async (container, auth, projectId, xmlFormId) => {
  const form = await container.Forms.getByProjectAndXmlFormId(
    projectId, xmlFormId, Form.WithoutDef, Form.WithoutXml
  ).then(getOrNotFound);
  try { await auth.canOrReject('submission.read', form); } catch (error) {
    if (error?.problemCode === Problem.user.insufficientRights.code) throw Problem.user.notFound();
    throw error;
  }
  return form;
};

const matchRevision = (headers) => {
  if (headers['if-match'] == null) throw Problem.user.reviewRevisionRequired();
  const matched = /^"review-case-([1-9]\d*)"$/.exec(headers['if-match']);
  if (matched == null || !Number.isSafeInteger(Number(matched[1])))
    throw Problem.user.reviewAssignmentInvalid();
  return Number(matched[1]);
};

const hash = (body) => createHash('sha256').update(JSON.stringify(body)).digest('hex');

const pinnedSources = async (container, auth, params, claim) => {
  if (!UUID_PATTERN.test(params.backcheckId)) throw Problem.user.notFound();
  // Fetch both pinned versions in one snapshot, with both deletion and form
  // boundaries checked before returning either source or any answer text.
  const sources = await container.db.any(sql`SELECT src.kind,
      sd.id AS "submissionDefId", sd."instanceId", sd.current,
      s."instanceId" AS "rootInstanceId", f."xmlFormId", v.id AS "claimVersionId", fd.version AS "formVersion",
      p.origin, p."capturedAt", p."receivedAt", p.degraded, p."integrityHash",
      octet_length(sd.xml) > ${MAX_BYTES} AS "tooLarge",
      CASE WHEN octet_length(sd.xml) <= ${MAX_BYTES} THEN sd.xml ELSE NULL END AS xml,
      CASE WHEN octet_length(sd.xml) <= ${MAX_BYTES} THEN
        p."integrityHash" = encode(sha256(convert_to(sd.xml, 'UTF8')), 'hex') ELSE NULL END AS "hashMatches"
      FROM field_data_backchecks b
      JOIN field_data_review_cases c ON c.id = b."caseId" AND c."claimVersionId" = b."claimVersionId"
      JOIN field_data_claim_versions original ON original.id = c."claimVersionId"
      JOIN submission_defs original_def ON original_def.id = original."submissionDefId"
      JOIN submissions original_submission ON original_submission.id = original_def."submissionId"
        AND original_submission."deletedAt" IS NULL
      JOIN submission_defs response_def ON response_def.id = b."responseSubmissionDefId"
      JOIN submissions response_submission ON response_submission.id = response_def."submissionId"
        AND response_submission."deletedAt" IS NULL
        AND response_submission."formId" = COALESCE(b."responseFormId", original_submission."formId")
      CROSS JOIN LATERAL (VALUES ('original', original_def.id), ('backcheck', response_def.id)) src(kind, id)
      JOIN submission_defs sd ON sd.id = src.id
      JOIN submissions s ON s.id = sd."submissionId"
      JOIN forms f ON f.id = s."formId" AND f."projectId" = ${claim.scope.projectId}
      JOIN form_defs fd ON fd.id = sd."formDefId"
      LEFT JOIN field_data_claim_versions v ON v."submissionDefId" = sd.id
      LEFT JOIN field_data_submission_provenance p ON p."submissionDefId" = sd.id
      WHERE b.id = ${params.backcheckId} AND b."caseId" = ${params.caseId} AND b.status = 'linked'`);
  if (sources.length !== 2) throw Problem.user.notFound();
  await Promise.all(sources.map(source =>
    responseFormFor(container, auth, claim.scope.projectId, source.xmlFormId)));
  return sources;
};
const mappingHistory = (container, backcheckId) => container.db.any(sql`SELECT m.id, m.revision,
  m."actorId", a."displayName" AS "actorName", m.note, m.pairs, m."createdAt",
  m."originalSubmissionDefId", m."backcheckSubmissionDefId", m."originalHash", m."backcheckHash"
  FROM field_data_backcheck_mappings m LEFT JOIN actors a ON a.id = m."actorId"
  WHERE m."backcheckId" = ${backcheckId} ORDER BY m.revision DESC LIMIT 100`);
const mappingAllowed = async (container, auth, claim, form) => {
  const project = await container.Projects.getById(claim.scope.projectId).then(getOrNotFound);
  return (await auth.can('project.update', project)) && auth.can('submission.update', form);
};

module.exports = (service, endpoint) => {
  service.get('/field-data/review-queue/:caseId/backcheck-forms', endpoint(async (
    container, { params, auth }, request, response
  ) => {
    const { claim } = await scopeFor(container, auth, params.caseId, true);
    const forms = await container.db.any(sql`SELECT f.id, f."xmlFormId", fd.name
      FROM forms f JOIN form_defs fd ON fd.id = f."currentDefId"
      WHERE f."projectId" = ${claim.scope.projectId} AND f."deletedAt" IS NULL
        AND f.state = 'open' ORDER BY f."xmlFormId"`);
    const available = await Promise.all(forms.map(async (candidate) => {
      try { await responseFormFor(container, auth, claim.scope.projectId, candidate.xmlFormId); } catch (error) {
        if (error?.problemCode === Problem.user.notFound.code) return null;
        throw error;
      }
      const assignees = await container.db.any(sql`SELECT a.id, a."displayName" AS name
        FROM field_keys fk JOIN actors a ON a.id = fk."actorId"
        JOIN forms f ON f.id = ${candidate.id}
        WHERE fk."projectId" = ${claim.scope.projectId} AND a."deletedAt" IS NULL
          AND EXISTS (SELECT 1 FROM assignments ass JOIN roles r ON r.id = ass."roleId"
            WHERE ass."actorId" = a.id AND ass."acteeId" = f."acteeId"
              AND r.verbs ? 'submission.create') ORDER BY a."displayName", a.id`);
      return { ...candidate, assignees };
    }));
    response.set('Cache-Control', 'private, no-store');
    return available.filter(candidate => candidate != null);
  }));

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
    const { claim } = await scopeFor(container, auth, params.caseId);
    response.set('Cache-Control', 'private, no-store');
    const backchecks = await container.db.any(sql`SELECT b.id, b."caseId", b."claimVersionId",
      rf."xmlFormId" AS "responseXmlFormId", rf.id AS "responseFormId",
      b.question, b."dueAt", b."seenAt", b.status, b."assignedTo", a."displayName" AS "assigneeName",
      b."responseInstanceId", b."createdAt", b."linkedAt",
      b."cancelledAt", b."cancelledBy", b."cancellationReason",
      p."capturedAt" AS "responseCapturedAt", p.degraded AS "responseDegraded",
      p."integrityHash" AS "responseIntegrityHash"
      FROM field_data_backchecks b
      JOIN field_data_claim_versions cv ON cv.id = b."claimVersionId"
      JOIN submission_defs osd ON osd.id = cv."submissionDefId"
      JOIN submissions os ON os.id = osd."submissionId"
      JOIN forms rf ON rf.id = COALESCE(b."responseFormId", os."formId")
      LEFT JOIN actors a ON a.id = b."assignedTo"
      LEFT JOIN field_data_submission_provenance p
        ON p."submissionDefId" = b."responseSubmissionDefId"
      WHERE b."caseId" = ${params.caseId} ORDER BY b."createdAt", b.id`);
    await Promise.all([...new Set(backchecks.map(b => b.responseXmlFormId))]
      .map(xmlFormId => responseFormFor(container, auth, claim.scope.projectId, xmlFormId)));
    return backchecks;
  }));

  service.get('/field-data/review-queue/:caseId/backchecks/:backcheckId/comparison', endpoint(async (
    container, { params, auth }, request, response
  ) => {
    const { claim, form } = await scopeFor(container, auth, params.caseId);
    if (!UUID_PATTERN.test(params.backcheckId)) throw Problem.user.notFound();
    const sources = await pinnedSources(container, auth, params, claim);
    const original = sources.find((source) => source.kind === 'original');
    const backcheck = sources.find((source) => source.kind === 'backcheck');
    const sourceMetadata = (source) => ({
      submissionDefId: source.submissionDefId, claimVersionId: source.claimVersionId,
      instanceId: source.instanceId, rootInstanceId: source.rootInstanceId,
      current: source.current, xmlFormId: source.xmlFormId, formVersion: source.formVersion,
      provenance: { origin: source.origin, capturedAt: source.capturedAt,
        receivedAt: source.receivedAt, degraded: source.degraded, integrityHash: source.integrityHash },
      integrityStatus: source.hashMatches === true ? 'verified'
        : source.hashMatches === false ? 'mismatch' : 'unverified',
      xmlDownloadUrl: `/v1/projects/${claim.scope.projectId}/forms/${encodeURIComponent(source.xmlFormId)}`
        + `/submissions/${encodeURIComponent(source.rootInstanceId)}/versions/${encodeURIComponent(source.instanceId)}.xml`
    });
    const history = await mappingHistory(container, params.backcheckId);
    const revision = history[0]?.revision ?? 0;
    const mapping = { revision, etag: `"backcheck-mapping-${revision}"`, history,
      allowed: await mappingAllowed(container, auth, claim, form) };
    const configured = history.length > 0;
    const explicit = configured || original.xmlFormId !== backcheck.xmlFormId;
    const result = { algorithmVersion: explicit ? 'backcheck-mapped-text@1' : 'backcheck-text@1',
      mapping, comparisonMode: configured ? 'mapped' : explicit ? 'unmapped' : 'exact-path', original: sourceMetadata(original),
      backcheck: sourceMetadata(backcheck) };
    let comparison;
    if (sources.some((source) => source.tooLarge)) comparison = { unavailableReason: 'size-limit' };
    else if (sources.some((source) => source.hashMatches !== true))
      comparison = { unavailableReason: 'source-integrity' };
    else {
      try {
        comparison = explicit ? compareMappedAnswers(original.xml, backcheck.xml, history[0]?.pairs ?? [])
          : compareAnswers(original.xml, backcheck.xml);
        comparison.availablePaths = { original: [...answers(original.xml).keys()].sort(),
          backcheck: [...answers(backcheck.xml).keys()].sort() };
      } catch (error) {
        if (error.reason == null) throw error;
        comparison = { unavailableReason: error.reason };
      }
    }
    response.set('Cache-Control', 'private, no-store');
    return { ...result, ...comparison };
  }));

  service.post('/field-data/review-queue/:caseId/backchecks/:backcheckId/mapping', endpoint(async (
    container, { params, auth, body, headers }, request, response
  ) => {
    const { claim, form } = await scopeFor(container, auth, params.caseId);
    if (!await mappingAllowed(container, auth, claim, form)) throw Problem.user.insufficientRights();
    if (!UUID_PATTERN.test(params.backcheckId)) throw Problem.user.notFound();
    if (headers['if-match'] == null) throw Problem.user.reviewRevisionRequired();
    const matched = /^"backcheck-mapping-(0|[1-9]\d*)"$/.exec(headers['if-match']);
    if (matched == null || !Number.isSafeInteger(Number(matched[1])) || body == null
      || Object.keys(body).some(key => !['requestId', 'note', 'pairs'].includes(key))
      || !UUID_PATTERN.test(body.requestId ?? '') || typeof body.note !== 'string'
      || body.note.trim().length === 0 || body.note.length > 2000 || !Array.isArray(body.pairs)
      || body.pairs.length > 100 || Buffer.byteLength(JSON.stringify(body.pairs)) > 65536)
      throw Problem.user.reviewAssignmentInvalid();
    const actorId = auth.actor.map(actor => actor.id).orNull();
    if (actorId == null) throw Problem.user.insufficientRights();
    const requestHash = hash({ pairs: body.pairs, note: body.note.trim() });
    const result = await container.transacting(async (tx) => {
      const locked = await tx.db.any(sql`SELECT id FROM field_data_backchecks
        WHERE id = ${params.backcheckId} AND "caseId" = ${params.caseId}
          AND status = 'linked' FOR UPDATE`);
      if (locked.length === 0) throw Problem.user.notFound();
      const sources = await pinnedSources(tx, auth, params, claim);
      const [existing] = await tx.db.any(sql`SELECT revision, "requestHash"
        FROM field_data_backcheck_mappings WHERE "backcheckId" = ${params.backcheckId}
          AND "requestId" = ${body.requestId}`);
      if (existing != null) {
        if (existing.requestHash !== requestHash) throw Problem.user.reviewAssignmentInvalid();
        return { revision: existing.revision, replayed: true };
      }
      const history = await mappingHistory(tx, params.backcheckId);
      const revision = history[0]?.revision ?? 0;
      if (revision !== Number(matched[1])) throw Problem.user.reviewRevisionStale();
      if (sources.some(source => source.tooLarge || source.hashMatches !== true))
        throw Problem.user.reviewAssignmentInvalid();
      const original = sources.find(source => source.kind === 'original');
      const backcheck = sources.find(source => source.kind === 'backcheck');
      try {
        if (!validatePairs(body.pairs, answers(original.xml), answers(backcheck.xml)))
          throw Problem.user.reviewAssignmentInvalid();
        compareMappedAnswers(original.xml, backcheck.xml, body.pairs);
      } catch (error) {
        if (error.reason != null) throw Problem.user.reviewAssignmentInvalid();
        throw error;
      }
      const inserted = await tx.db.one(sql`INSERT INTO field_data_backcheck_mappings
        ("backcheckId", revision, "requestId", "requestHash", "actorId", note, pairs,
          "originalSubmissionDefId", "backcheckSubmissionDefId", "originalHash", "backcheckHash")
        VALUES (${params.backcheckId}, ${revision + 1}, ${body.requestId}, ${requestHash}, ${actorId},
          ${body.note.trim()}, ${JSON.stringify(body.pairs)}, ${original.submissionDefId},
          ${backcheck.submissionDefId}, ${original.integrityHash}, ${backcheck.integrityHash}) RETURNING id`);
      await tx.db.query(sql`INSERT INTO audits ("actorId", action, "acteeId", details,
        "loggedAt", processed, failures) VALUES (${actorId}, 'field_data.backcheck.mapping',
        ${form.acteeId}, ${JSON.stringify({ caseId: params.caseId, backcheckId: params.backcheckId,
  mappingId: inserted.id, revision: revision + 1 })}, clock_timestamp(), clock_timestamp(), 0)`);
      return { revision: revision + 1, replayed: false };
    });
    response.set('ETag', `"backcheck-mapping-${result.revision}"`);
    response.set('Cache-Control', 'private, no-store');
    response.set('Idempotency-Status', result.replayed ? 'replayed' : 'created');
    response.status(201);
    return result;
  }));

  service.post('/field-data/review-queue/:caseId/backchecks', endpoint(observeReviewConflicts(async (
    container, { params, auth, body, headers }, request, response
  ) => {
    const { reviewCase, claim, form } = await scopeFor(container, auth, params.caseId, true);
    const reviewerId = auth.actor.map((actor) => actor.id).orNull();
    const revision = matchRevision(headers);
    if (reviewerId == null || body == null || Object.keys(body).some((field) =>
      !['requestId', 'assignedTo', 'question', 'dueAt', 'responseXmlFormId'].includes(field))
      || (body.responseXmlFormId != null && (typeof body.responseXmlFormId !== 'string'
        || body.responseXmlFormId.length === 0 || body.responseXmlFormId.length > 255))
      || !UUID_PATTERN.test(body.requestId ?? '')
      || !Number.isSafeInteger(body.assignedTo) || body.assignedTo < 1
      || typeof body.question !== 'string' || body.question.trim().length === 0
      || body.question.length > 2000 || (body.dueAt != null
        && (typeof body.dueAt !== 'string' || Number.isNaN(Date.parse(body.dueAt)))))
      throw Problem.user.reviewAssignmentInvalid();
    const question = body.question.trim();
    const dueAt = body.dueAt ?? null;
    const responseForm = await responseFormFor(container, auth, claim.scope.projectId,
      body.responseXmlFormId ?? claim.scope.xmlFormId);
    // Preserve the legacy hash for requests without an explicit response form.
    const requestHash = hash({ assignedTo: body.assignedTo, question, dueAt,
      ...(body.responseXmlFormId == null ? {} : { responseXmlFormId: body.responseXmlFormId }) });
    const result = await trackReviewWrite({ caseId: params.caseId, actorId: reviewerId,
      formActeeId: form.acteeId }, 'backcheck-request', () => container.transacting(async (tx) => {
      const [locked] = await tx.db.any(sql`SELECT c.revision, c.status, c."assignedTo",
        sd.current, s."submitterId" AS "originalSubmitterId"
        FROM field_data_review_cases c
        JOIN field_data_claim_versions v ON v.id = c."claimVersionId"
        JOIN submission_defs sd ON sd.id = v."submissionDefId"
        JOIN submissions s ON s.id = sd."submissionId"
        WHERE c.id = ${params.caseId} FOR UPDATE OF c`);
      if (locked == null) throw Problem.user.notFound();
      const [existing] = await tx.db.any(sql`SELECT id, status, "requestHash" FROM field_data_backchecks
        WHERE "caseId" = ${params.caseId} AND "requestId" = ${body.requestId}`);
      if (existing != null) {
        if (existing.requestHash !== requestHash) throw Problem.user.reviewAssignmentInvalid();
        return { id: existing.id, status: existing.status, revision: locked.revision, replayed: true };
      }
      if (locked.revision !== revision) throw Problem.user.reviewRevisionStale();
      if (locked.status !== 'in-review' || locked.assignedTo !== reviewerId || !locked.current)
        throw Problem.user.reviewCaseClosed();
      if (body.assignedTo === locked.originalSubmitterId)
        throw Problem.user.reviewAssignmentInvalid();
      const eligibleForm = await tx.db.any(sql`SELECT id FROM forms
        WHERE id = ${responseForm.id} AND "deletedAt" IS NULL
          AND "currentDefId" IS NOT NULL AND state = 'open'`);
      if (eligibleForm.length === 0) throw Problem.user.reviewAssignmentInvalid();
      const assignee = await tx.db.any(sql`SELECT 1 FROM field_keys fk
        JOIN actors a ON a.id = fk."actorId" AND a."deletedAt" IS NULL
        JOIN assignments ass ON ass."actorId" = a.id AND ass."acteeId" = ${responseForm.acteeId}
        JOIN roles r ON r.id = ass."roleId" AND r.verbs ? 'submission.create'
        WHERE fk."projectId" = ${claim.scope.projectId}
          AND fk."actorId" = ${body.assignedTo} LIMIT 1`);
      if (assignee.length === 0) throw Problem.user.reviewAssignmentInvalid();
      const pending = await tx.db.any(sql`SELECT id FROM field_data_backchecks
        WHERE "caseId" = ${params.caseId} AND status = 'requested' LIMIT 1`);
      if (pending.length > 0) throw Problem.user.reviewCaseClosed();
      const inserted = await tx.db.one(sql`INSERT INTO field_data_backchecks
        ("caseId", "claimVersionId", "requestId", "requestHash", "requestedBy",
          "assignedTo", question, "dueAt", "responseFormId")
        VALUES (${params.caseId}, ${reviewCase.claimVersionId}, ${body.requestId},
          ${requestHash}, ${reviewerId}, ${body.assignedTo}, ${question}, ${dueAt}, ${responseForm.id})
        RETURNING id`);
      await tx.db.query(sql`UPDATE field_data_review_cases
        SET revision = revision + 1, "updatedAt" = clock_timestamp()
        WHERE id = ${params.caseId}`);
      await tx.db.query(sql`INSERT INTO audits ("actorId", action, "acteeId", details,
        "loggedAt", processed, failures)
        VALUES (${reviewerId}, 'field_data.backcheck.request', ${form.acteeId},
          ${JSON.stringify({ caseId: params.caseId, backcheckId: inserted.id,
    claimVersionId: reviewCase.claimVersionId, assignedTo: body.assignedTo, responseFormId: responseForm.id })},
          clock_timestamp(), NULL, 0)`);
      return { id: inserted.id, status: 'requested', revision: locked.revision + 1, replayed: false };
    }));
    response.set('ETag', `"review-case-${result.revision}"`);
    response.set('Cache-Control', 'private, no-store');
    response.set('Idempotency-Status', result.replayed ? 'replayed' : 'created');
    response.status(201);
    return { id: result.id, caseId: params.caseId, status: result.status };
  })));

  service.post('/field-data/review-queue/:caseId/backchecks/:backcheckId/cancel', endpoint(observeReviewConflicts(async (
    container, { params, auth, body, headers }, request, response
  ) => {
    const { form } = await scopeFor(container, auth, params.caseId, true);
    const reviewerId = auth.actor.map((actor) => actor.id).orNull();
    const revision = matchRevision(headers);
    if (reviewerId == null || !UUID_PATTERN.test(params.backcheckId) || body == null
      || Object.keys(body).some((field) => !['requestId', 'reason'].includes(field))
      || !UUID_PATTERN.test(body.requestId ?? '') || typeof body.reason !== 'string'
      || body.reason.trim().length === 0 || body.reason.length > 2000)
      throw Problem.user.reviewAssignmentInvalid();
    const reason = body.reason.trim();
    const result = await trackReviewWrite({ caseId: params.caseId, actorId: reviewerId,
      formActeeId: form.acteeId }, 'backcheck-cancel', () => container.transacting(async (tx) => {
      const [locked] = await tx.db.any(sql`SELECT c.revision, c.status, c."assignedTo", sd.current
        FROM field_data_review_cases c
        JOIN field_data_claim_versions v ON v.id = c."claimVersionId"
        JOIN submission_defs sd ON sd.id = v."submissionDefId"
        WHERE c.id = ${params.caseId} FOR UPDATE OF c`);
      const [backcheck] = await tx.db.any(sql`SELECT id, status, "cancelledBy",
        "cancellationRequestId", "cancellationReason" FROM field_data_backchecks
        WHERE id = ${params.backcheckId} AND "caseId" = ${params.caseId} FOR UPDATE`);
      if (locked == null || backcheck == null) throw Problem.user.notFound();
      if (backcheck.cancellationRequestId === body.requestId) {
        if (backcheck.cancelledBy !== reviewerId || backcheck.cancellationReason !== reason)
          throw Problem.user.reviewAssignmentInvalid();
        return { revision: locked.revision, replayed: true };
      }
      if (locked.revision !== revision) throw Problem.user.reviewRevisionStale();
      if (locked.status !== 'in-review' || locked.assignedTo !== reviewerId || !locked.current
        || backcheck.status !== 'requested') throw Problem.user.reviewCaseClosed();
      await tx.db.query(sql`UPDATE field_data_backchecks SET status = 'cancelled',
        "cancelledAt" = clock_timestamp(), "cancelledBy" = ${reviewerId},
        "cancellationRequestId" = ${body.requestId}, "cancellationReason" = ${reason}
        WHERE id = ${params.backcheckId}`);
      await tx.db.query(sql`UPDATE field_data_review_cases
        SET revision = revision + 1, "updatedAt" = clock_timestamp() WHERE id = ${params.caseId}`);
      await tx.db.query(sql`INSERT INTO audits ("actorId", action, "acteeId", details,
        "loggedAt", processed, failures)
        VALUES (${reviewerId}, 'field_data.backcheck.cancel', ${form.acteeId},
          ${JSON.stringify({ caseId: params.caseId, backcheckId: params.backcheckId, reason })},
          clock_timestamp(), NULL, 0)`);
      return { revision: locked.revision + 1, replayed: false };
    }));
    response.set('ETag', `"review-case-${result.revision}"`);
    response.set('Cache-Control', 'private, no-store');
    response.set('Idempotency-Status', result.replayed ? 'replayed' : 'created');
    return { id: params.backcheckId, status: 'cancelled', revision: result.revision };
  })));

  service.post('/field-data/review-queue/:caseId/backchecks/:backcheckId/link', endpoint(observeReviewConflicts(async (
    container, { params, auth, body, headers }, request, response
  ) => {
    const { reviewCase, claim, form } = await scopeFor(container, auth, params.caseId, true);
    if (!UUID_PATTERN.test(params.backcheckId) || body == null
      || Object.keys(body).some((field) => field !== 'instanceId')
      || typeof body.instanceId !== 'string' || body.instanceId.length < 1
      || body.instanceId.length > 255) throw Problem.user.reviewAssignmentInvalid();
    const reviewerId = auth.actor.map((actor) => actor.id).orNull();
    const revision = matchRevision(headers);
    const result = await trackReviewWrite({ caseId: params.caseId, actorId: reviewerId,
      formActeeId: form.acteeId }, 'backcheck-link', () => container.transacting(async (tx) => {
      const [locked] = await tx.db.any(sql`SELECT revision, status, "assignedTo"
        FROM field_data_review_cases WHERE id = ${params.caseId} FOR UPDATE`);
      const [backcheck] = await tx.db.any(sql`SELECT id, status, "assignedTo",
        "responseInstanceId", "claimVersionId", "responseFormId" FROM field_data_backchecks
        WHERE id = ${params.backcheckId} AND "caseId" = ${params.caseId} FOR UPDATE`);
      if (locked == null || backcheck == null) throw Problem.user.notFound();
      const [target] = await tx.db.any(sql`SELECT "xmlFormId" FROM forms
        WHERE id = ${backcheck.responseFormId ?? claim.scope.formId}
          AND "projectId" = ${claim.scope.projectId} AND "deletedAt" IS NULL`);
      if (target == null) throw Problem.user.notFound();
      await responseFormFor(tx, auth, claim.scope.projectId, target.xmlFormId);
      if (backcheck.status === 'linked' && backcheck.responseInstanceId === body.instanceId)
        return { revision: locked.revision, replayed: true };
      if (locked.revision !== revision) throw Problem.user.reviewRevisionStale();
      if (locked.status !== 'in-review' || locked.assignedTo !== reviewerId
        || reviewCase.claimVersionId !== backcheck.claimVersionId
        || backcheck.status !== 'requested') throw Problem.user.reviewCaseClosed();
      const [submitted] = await tx.db.any(sql`SELECT sd.id, s."submitterId"
        FROM submissions s JOIN submission_defs sd
          ON sd."submissionId" = s.id AND sd.current IS TRUE
        WHERE s."formId" = ${backcheck.responseFormId ?? claim.scope.formId}
          AND s."instanceId" = ${body.instanceId}
          AND s."deletedAt" IS NULL AND s.draft IS FALSE`);
      if (submitted == null || submitted.submitterId !== backcheck.assignedTo
        || ((backcheck.responseFormId ?? claim.scope.formId) === claim.scope.formId
          && body.instanceId === claim.body.claim.rootInstanceId))
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
          clock_timestamp(), NULL, 0)`);
      return { revision: locked.revision + 1, replayed: false };
    }));
    response.set('ETag', `"review-case-${result.revision}"`);
    response.set('Cache-Control', 'private, no-store');
    response.set('Idempotency-Status', result.replayed ? 'replayed' : 'created');
    return { id: params.backcheckId, status: 'linked', revision: result.revision };
  })));
};
