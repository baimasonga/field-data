// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

const { Form } = require('../model/frames');
const { UUID_PATTERN } = require('../util/claim-versioning');
const { getOrNotFound } = require('../util/promise');
const Problem = require('../util/problem');

const toProblem = (error, submissionId = null) => {
  if (error?.isProblem === true) return error;
  if (error?.code === 'CLAIM_MAPPING_MISSING')
    return Problem.internal.claimMappingMissing({ submissionId });
  if (error?.code === 'CLAIM_LINEAGE_INVALID')
    return Problem.internal.claimLineageInvalid({ reason: error.message });
  if (error?.code === 'CLAIM_VERSION_ID_INVALID')
    return Problem.user.claimVersionIdInvalid({ value: error.details?.value });
  return error;
};

const authorizeWithoutDisclosure = async (auth, form) => {
  try {
    return await auth.canOrReject('submission.read', form);
  } catch (error) {
    if (error?.problemCode === Problem.user.insufficientRights.code)
      throw Problem.user.notFound();
    throw error;
  }
};

module.exports = (service, endpoint) => {
  service.get('/projects/:projectId/forms/:xmlFormId/submissions/:instanceId/claim',
    endpoint(async ({ FieldDataClaims, Forms, Submissions }, { auth, params }) => {
      const form = await Forms.getByProjectAndXmlFormId(
        params.projectId, params.xmlFormId, Form.WithoutDef, Form.WithoutXml
      ).then(getOrNotFound);
      await authorizeWithoutDisclosure(auth, form);
      const submission = await Submissions.getByIds(
        params.projectId, params.xmlFormId, params.instanceId, false
      ).then(getOrNotFound);
      try {
        const claim = await FieldDataClaims.getBySubmissionId(submission.id);
        if (claim == null)
          throw Problem.internal.claimMappingMissing({ submissionId: submission.id });
        return claim;
      } catch (error) {
        throw toProblem(error, submission.id);
      }
    }));

  service.get('/field-data/claim-versions/:claimVersionId',
    endpoint(async ({ FieldDataClaims, Forms }, { auth, params }) => {
      if (!UUID_PATTERN.test(params.claimVersionId))
        throw Problem.user.claimVersionIdInvalid({ value: params.claimVersionId });
      let result;
      try {
        result = await FieldDataClaims.getByVersionId(params.claimVersionId);
      } catch (error) {
        throw toProblem(error);
      }
      if (result == null) throw Problem.user.notFound();
      const form = await Forms.getByProjectAndXmlFormId(
        result.scope.projectId, result.scope.xmlFormId,
        Form.WithoutDef, Form.WithoutXml
      ).then(getOrNotFound);
      await authorizeWithoutDisclosure(auth, form);
      return result.body;
    }));
};
