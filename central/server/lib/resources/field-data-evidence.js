// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

const { Form } = require('../model/frames');
const { UUID_PATTERN } = require('../util/claim-versioning');
const { getOrNotFound } = require('../util/promise');
const Problem = require('../util/problem');

const metadata = (row) => ({
  id: row.id,
  sourceKind: row.sourceKind,
  relation: row.relation,
  mimeType: row.mimeType,
  byteSize: Number(row.byteSize),
  contentHash: row.contentHash,
  receivedAt: row.receivedAt,
  integrityStatus: row.hashMatches ? 'verified' : 'mismatch',
  degraded: row.degraded,
  downloadUrl: `/v1/field-data/evidence/${row.id}/content`,
  derivations: []
});

const authorize = async (row, Forms, auth) => {
  const form = await Forms.getByProjectAndXmlFormId(
    row.projectId, row.xmlFormId, Form.WithoutDef, Form.WithoutXml
  ).then(getOrNotFound);
  try {
    await auth.canOrReject('submission.read', form);
  } catch (error) {
    if (error?.problemCode === Problem.user.insufficientRights.code)
      throw Problem.user.notFound();
    throw error;
  }
};

module.exports = (service, endpoint) => {
  service.get('/field-data/claim-versions/:claimVersionId/evidence',
    endpoint(async ({ FieldDataClaims, FieldDataEvidence, Forms }, { params, auth }) => {
      if (!UUID_PATTERN.test(params.claimVersionId))
        throw Problem.user.claimVersionIdInvalid({ value: params.claimVersionId });
      const claim = await FieldDataClaims.getByVersionId(params.claimVersionId);
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
      const rows = await FieldDataEvidence.listByVersionId(params.claimVersionId);
      return { items: rows.map(metadata), nextCursor: null };
    }));

  const getEvidence = async ({ FieldDataEvidence, Forms }, { params, auth }, includeXml) => {
    if (!UUID_PATTERN.test(params.evidenceId)) throw Problem.user.notFound();
    const row = await FieldDataEvidence.getById(params.evidenceId, includeXml);
    if (row == null) throw Problem.user.notFound();
    await authorize(row, Forms, auth);
    return row;
  };

  service.get('/field-data/evidence/:evidenceId',
    endpoint(async (container, context) => metadata(await getEvidence(container, context, false))));

  service.get('/field-data/evidence/:evidenceId/content',
    endpoint(async (container, context, request, response) => {
      const row = await getEvidence(container, context, true);
      if (!row.hashMatches) throw Problem.user.evidenceHashMismatch();
      response.set('Content-Type', 'application/xml; charset=utf-8');
      response.set('Cache-Control', 'no-store');
      return row.xml;
    }));
};
