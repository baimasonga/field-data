// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

const { Form } = require('../model/frames');
const { UUID_PATTERN } = require('../util/claim-versioning');
const { getOrNotFound } = require('../util/promise');
const Problem = require('../util/problem');

module.exports = (service, endpoint) => {
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
    try {
      await auth.canOrReject('submission.read', form);
    } catch (error) {
      if (error?.problemCode === Problem.user.insufficientRights.code)
        throw Problem.user.notFound();
      throw error;
    }
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
