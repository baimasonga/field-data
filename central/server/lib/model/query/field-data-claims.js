// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

const { sql } = require('slonik');
const { shapeClaim } = require('../../util/claim-versioning');

const selectClaim = (condition) => ({ all }) => all(sql`
  SELECT claims.id AS "claimId", claims."submissionId",
    claims."schemaVersion" AS "claimSchemaVersion",
    submissions."instanceId" AS "rootInstanceId",
    forms.id AS "formId", forms."projectId", forms."xmlFormId",
    versions.id AS "claimVersionId", versions."claimId" AS "versionClaimId",
    versions."submissionDefId", versions.ordinal, versions."previousVersionId",
    versions."lineageBasis", versions.degraded,
    versions."schemaVersion" AS "versionSchemaVersion",
    submission_defs."instanceId", submission_defs.current, submission_defs.root,
    form_defs.version AS "formVersion",
    provenance.origin AS "provenanceOrigin",
    provenance."sourceRef" AS "provenanceSourceRef",
    provenance."capturedAt" AS "provenanceCapturedAt",
    provenance."receivedAt" AS "provenanceReceivedAt",
    provenance."integrityHash" AS "provenanceIntegrityHash",
    provenance."transformVersion" AS "provenanceTransformVersion",
    provenance."policyVersion" AS "provenancePolicyVersion",
    provenance.degraded AS "provenanceDegraded"
  FROM field_data_claims claims
  JOIN submissions ON submissions.id = claims."submissionId"
  JOIN forms ON forms.id = submissions."formId"
  JOIN field_data_claim_versions versions ON versions."claimId" = claims.id
  JOIN submission_defs ON submission_defs.id = versions."submissionDefId"
    AND submission_defs."submissionId" = submissions.id
  JOIN form_defs ON form_defs.id = submission_defs."formDefId"
  LEFT JOIN field_data_submission_provenance provenance
    ON provenance."submissionDefId" = submission_defs.id
  WHERE ${condition} AND submissions."deletedAt" IS NULL
  ORDER BY versions.ordinal ASC`);

const rowsToClaim = (rows) => {
  if (rows.length === 0) return null;
  const first = rows[0];
  return shapeClaim({
    claim: { id: first.claimId, submissionId: first.submissionId,
      schemaVersion: first.claimSchemaVersion },
    submission: { id: first.submissionId, rootInstanceId: first.rootInstanceId },
    versions: rows.map((row) => ({
      id: row.claimVersionId, claimId: row.versionClaimId,
      submissionDefId: row.submissionDefId, ordinal: row.ordinal,
      previousVersionId: row.previousVersionId,
      lineageBasis: row.lineageBasis, degraded: row.degraded,
      schemaVersion: row.versionSchemaVersion, instanceId: row.instanceId,
      formVersion: row.formVersion, current: row.current === true,
      root: row.root === true,
      provenance: row.provenanceOrigin == null ? null : {
        origin: row.provenanceOrigin, sourceRef: row.provenanceSourceRef,
        capturedAt: row.provenanceCapturedAt, receivedAt: row.provenanceReceivedAt,
        integrityHash: row.provenanceIntegrityHash,
        transformVersion: row.provenanceTransformVersion,
        policyVersion: row.provenancePolicyVersion, degraded: row.provenanceDegraded
      }
    }))
  });
};

const getBySubmissionId = (submissionId) => (container) =>
  selectClaim(sql`claims."submissionId" = ${submissionId}`)(container).then(rowsToClaim);

const getByVersionId = (claimVersionId) => (container) =>
  selectClaim(sql`claims.id = (
    SELECT "claimId" FROM field_data_claim_versions WHERE id = ${claimVersionId}
  )`)(container).then((rows) => {
    if (rows.length === 0) return null;
    const claim = rowsToClaim(rows);
    const target = claim.versions.find((version) => version.id === claimVersionId);
    return {
      scope: { projectId: rows[0].projectId, formId: rows[0].formId,
        xmlFormId: rows[0].xmlFormId },
      body: {
        ...target,
        claim: { id: claim.id, rootInstanceId: claim.rootInstanceId,
          currentVersionId: claim.currentVersionId },
        project: { id: rows[0].projectId },
        form: { id: rows[0].formId, xmlFormId: rows[0].xmlFormId }
      }
    };
  });

const health = () => ({ one }) => one(sql`
  SELECT
    (SELECT count(*)::integer FROM submissions s
      LEFT JOIN field_data_claims c ON c."submissionId" = s.id
      WHERE c.id IS NULL) AS "missingClaims",
    (SELECT count(*)::integer FROM submission_defs sd
      LEFT JOIN field_data_claim_versions v ON v."submissionDefId" = sd.id
      WHERE v.id IS NULL) AS "missingVersions",
    (SELECT count(*)::integer FROM field_data_claim_versions v
      LEFT JOIN field_data_claim_versions p ON p.id = v."previousVersionId"
      WHERE (v.ordinal = 1 AND v."previousVersionId" IS NOT NULL)
        OR (v.ordinal > 1 AND (p.id IS NULL OR p."claimId" <> v."claimId"
          OR p.ordinal <> v.ordinal - 1))) AS "lineageConflicts"`);

module.exports = { getBySubmissionId, getByVersionId, health, rowsToClaim };
