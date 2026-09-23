// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

const { Form } = require('../model/frames');
const { createHash } = require('crypto');
const { UUID_PATTERN } = require('../util/claim-versioning');
const { getOrNotFound } = require('../util/promise');
const { blobContent } = require('../util/blob');
const Problem = require('../util/problem');

const metadata = (row) => ({
  id: row.id,
  sourceKind: row.sourceKind,
  relation: row.relation,
  mimeType: row.mimeType,
  byteSize: row.contentHash == null ? null : Number(row.byteSize),
  contentHash: row.contentHash,
  name: row.attachmentName ?? null,
  receivedAt: row.receivedAt,
  verifiedAt: row.verifiedAt ?? null,
  verificationBasis: row.verificationBasis ?? null,
  integrityStatus: row.blobId == null && row.sourceKind !== 'submission-xml' ? 'missing'
    : row.legacySha1Matched === false ? 'mismatch'
      : row.legacySha1Matched === true ? 'verified'
        : row.hashMatches == null ? 'unverified' : row.hashMatches ? 'verified' : 'mismatch',
  degraded: row.degraded,
  downloadUrl: `/v1/field-data/evidence/${row.id}/content`,
  derivations: row.derivations
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
      const items = rows.map(metadata);
      const summary = { verified: 0, missing: 0, unverified: 0, mismatch: 0 };
      for (const item of items) summary[item.integrityStatus] += 1;
      return { items, summary, nextCursor: null };
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

  service.get('/field-data/evidence/:evidenceId/derivations/:derivationId/content',
    endpoint(async (container, context) => {
      await getEvidence(container, context, false);
      if (!UUID_PATTERN.test(context.params.derivationId)) throw Problem.user.notFound();
      const derivative = await container.FieldDataEvidence.getDerivation(
        context.params.evidenceId, context.params.derivationId
      );
      if (derivative == null) throw Problem.user.notFound();
      if (!derivative.hashMatches) throw Problem.user.evidenceHashMismatch();
      return { id: derivative.id, evidenceId: derivative.evidenceId,
        kind: derivative.kind, algorithm: derivative.algorithm,
        algorithmVersion: derivative.algorithmVersion, output: derivative.outputJson,
        contentHash: derivative.contentHash, createdAt: derivative.createdAt };
    }));

  service.get('/field-data/evidence/:evidenceId/content',
    endpoint(async (container, context, request, response) => {
      const row = await getEvidence(container, context, true);
      if (row.sourceKind !== 'submission-xml') {
        if (row.blobId == null || (row.content == null && row.s3Status !== 'uploaded'))
          throw Problem.user.evidenceBytesMissing();
        if (row.contentHash == null) throw Problem.user.evidenceUnverified();
        if (row.legacySha1Matched === false) throw Problem.user.evidenceHashMismatch();
        const bytes = await blobContent(container.s3, {
          id: row.blobId, sha: row.blobSha, s3_status: row.s3Status, content: row.content
        });
        if (bytes == null) throw Problem.user.evidenceBytesMissing();
        const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
        if (digest !== row.contentHash)
          throw Problem.user.evidenceHashMismatch();
        response.set('Content-Type', row.mimeType);
        response.set('Content-Disposition', 'attachment');
        response.set('Cache-Control', 'no-store');
        return bytes;
      }
      if (!row.hashMatches) throw Problem.user.evidenceHashMismatch();
      response.set('Content-Type', 'application/xml; charset=utf-8');
      response.set('Cache-Control', 'no-store');
      return row.xml;
    }));
};
