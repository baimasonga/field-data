// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// Pure validation and response shaping for P0.2 claim lineage. Persistence,
// locking, and authorization belong to the query and resource layers; keeping
// those concerns out of this module makes the lineage rules usable by live
// writes, backfills, and reads without giving any path a different definition
// of a valid chain.

const { validateEnvelope } = require('./provenance');

const SCHEMA_VERSION = 'p0.2';
const LINEAGE_BASES = Object.freeze(['created', 'backfill-id-order']);

// Accept the UUID shape rather than one UUID version. The application creates
// the values today, but the contract should remain compatible with a future
// move from random UUIDs to time-ordered UUIDs without weakening validation.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const invalid = (code, reason, details = {}) => Object.assign(new Error(reason), {
  code,
  claimLineageInvalid: true,
  details
});

const isRecord = (value) => value != null && typeof value === 'object' && !Array.isArray(value);
const isPositiveInteger = (value) => Number.isInteger(value) && value > 0;

const requireUuid = (value, field) => {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw invalid(
      'CLAIM_VERSION_ID_INVALID',
      `${field} must be a UUID.`,
      { field }
    );
  }
};

const validateClaimVersion = (version) => {
  if (!isRecord(version)) {
    throw invalid('CLAIM_LINEAGE_INVALID', 'A claim version must be an object.');
  }

  requireUuid(version.id, 'id');
  requireUuid(version.claimId, 'claimId');
  if (!isPositiveInteger(version.submissionDefId)) {
    throw invalid(
      'CLAIM_LINEAGE_INVALID',
      'submissionDefId must be a positive integer.',
      { field: 'submissionDefId' }
    );
  }
  if (!isPositiveInteger(version.ordinal)) {
    throw invalid(
      'CLAIM_LINEAGE_INVALID',
      'Claim version ordinal must be a positive integer.',
      { field: 'ordinal' }
    );
  }
  if (version.previousVersionId != null)
    requireUuid(version.previousVersionId, 'previousVersionId');
  if (!LINEAGE_BASES.includes(version.lineageBasis)) {
    throw invalid(
      'CLAIM_LINEAGE_INVALID',
      `lineageBasis must be one of: ${LINEAGE_BASES.join(', ')}.`,
      { field: 'lineageBasis' }
    );
  }
  if (version.degraded != null && !isRecord(version.degraded)) {
    throw invalid(
      'CLAIM_LINEAGE_INVALID',
      'degraded must be an object or null.',
      { field: 'degraded' }
    );
  }
  if (version.schemaVersion !== SCHEMA_VERSION) {
    throw invalid(
      'CLAIM_LINEAGE_INVALID',
      `schemaVersion must be ${SCHEMA_VERSION}.`,
      { field: 'schemaVersion' }
    );
  }

  return version;
};

// Returns a new array in lineage order. Callers can safely pass query results
// without this function mutating them or silently trusting database order.
const validateClaimChain = (versions) => {
  if (!Array.isArray(versions) || versions.length === 0) {
    throw invalid(
      'CLAIM_MAPPING_MISSING',
      'At least one claim version is required for a mapped claim.'
    );
  }

  versions.forEach(validateClaimVersion);
  const ordered = [...versions].sort((a, b) => a.ordinal - b.ordinal);
  const [{ claimId }] = ordered;
  const versionIds = new Set();
  const submissionDefIds = new Set();
  let createdLineageSeen = false;

  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index];
    const previous = index === 0 ? null : ordered[index - 1];
    const expectedOrdinal = index + 1;

    if (current.claimId !== claimId) {
      throw invalid(
        'CLAIM_LINEAGE_INVALID',
        'Every version in a chain must belong to the same claim.',
        { versionId: current.id }
      );
    }
    if (versionIds.has(current.id)) {
      throw invalid(
        'CLAIM_LINEAGE_INVALID',
        'A claim chain cannot contain the same version twice.',
        { versionId: current.id }
      );
    }
    if (submissionDefIds.has(current.submissionDefId)) {
      throw invalid(
        'CLAIM_LINEAGE_INVALID',
        'A Submission version can map to only one position in a claim chain.',
        { submissionDefId: current.submissionDefId }
      );
    }
    if (current.ordinal !== expectedOrdinal) {
      throw invalid(
        'CLAIM_LINEAGE_INVALID',
        `Claim version ordinals must be contiguous from 1; expected ${expectedOrdinal}.`,
        { versionId: current.id, ordinal: current.ordinal }
      );
    }
    if (previous == null && current.previousVersionId != null) {
      throw invalid(
        'CLAIM_LINEAGE_INVALID',
        'The first claim version cannot have a predecessor.',
        { versionId: current.id }
      );
    }
    if (previous != null && current.previousVersionId !== previous.id) {
      throw invalid(
        'CLAIM_LINEAGE_INVALID',
        'Each claim version must point to the immediately preceding version.',
        { versionId: current.id, expectedPreviousVersionId: previous.id }
      );
    }
    if (createdLineageSeen && current.lineageBasis === 'backfill-id-order') {
      throw invalid(
        'CLAIM_LINEAGE_INVALID',
        'A backfilled version cannot follow a version created under the live policy.',
        { versionId: current.id }
      );
    }

    if (current.lineageBasis === 'created') createdLineageSeen = true;
    versionIds.add(current.id);
    submissionDefIds.add(current.submissionDefId);
  }

  return ordered;
};

const shapeProvenance = (provenance) => {
  if (!isRecord(provenance)) {
    throw invalid(
      'CLAIM_MAPPING_MISSING',
      'The claim version has no P0.1 provenance mapping.'
    );
  }
  try {
    validateEnvelope(provenance);
  } catch (cause) {
    throw invalid(
      'CLAIM_LINEAGE_INVALID',
      'The claim version carries an invalid P0.1 provenance envelope.',
      { reason: cause.message }
    );
  }
  return {
    origin: provenance.origin,
    sourceRef: provenance.sourceRef ?? null,
    capturedAt: provenance.capturedAt ?? null,
    receivedAt: provenance.receivedAt,
    integrityHash: provenance.integrityHash,
    transformVersion: provenance.transformVersion,
    policyVersion: provenance.policyVersion,
    degraded: provenance.degraded ?? null
  };
};

const shapeClaimVersion = (version) => {
  validateClaimVersion(version);
  if (typeof version.instanceId !== 'string' || version.instanceId === '') {
    throw invalid(
      'CLAIM_LINEAGE_INVALID',
      'A claim version response requires its Submission instanceId.',
      { versionId: version.id }
    );
  }
  if (typeof version.current !== 'boolean' || typeof version.root !== 'boolean') {
    throw invalid(
      'CLAIM_LINEAGE_INVALID',
      'A claim version response requires boolean current and root flags.',
      { versionId: version.id }
    );
  }

  return {
    id: version.id,
    ordinal: version.ordinal,
    previousVersionId: version.previousVersionId ?? null,
    instanceId: version.instanceId,
    formVersion: version.formVersion ?? null,
    current: version.current,
    root: version.root,
    lineageBasis: version.lineageBasis,
    degraded: version.degraded ?? null,
    provenance: shapeProvenance(version.provenance)
  };
};

const shapeClaim = ({ claim, submission, versions }) => {
  if (!isRecord(claim)) {
    throw invalid('CLAIM_MAPPING_MISSING', 'The Submission has no claim mapping.');
  }
  requireUuid(claim.id, 'claim.id');
  if (!isPositiveInteger(claim.submissionId)) {
    throw invalid(
      'CLAIM_LINEAGE_INVALID',
      'A claim must reference a positive submissionId.',
      { field: 'submissionId' }
    );
  }
  if (claim.schemaVersion !== SCHEMA_VERSION) {
    throw invalid(
      'CLAIM_LINEAGE_INVALID',
      `Claim schemaVersion must be ${SCHEMA_VERSION}.`,
      { field: 'schemaVersion' }
    );
  }
  if (!isRecord(submission)) {
    throw invalid('CLAIM_MAPPING_MISSING', 'The claim has no logical Submission.');
  }
  if (submission.id != null && submission.id !== claim.submissionId) {
    throw invalid(
      'CLAIM_LINEAGE_INVALID',
      'The claim and logical Submission do not match.',
      { claimId: claim.id }
    );
  }

  const rootInstanceId = submission.rootInstanceId ?? submission.instanceId;
  if (typeof rootInstanceId !== 'string' || rootInstanceId === '') {
    throw invalid(
      'CLAIM_LINEAGE_INVALID',
      'The logical Submission requires a root instanceId.',
      { claimId: claim.id }
    );
  }

  const ordered = validateClaimChain(versions);
  if (ordered.some((version) => version.claimId !== claim.id)) {
    throw invalid(
      'CLAIM_LINEAGE_INVALID',
      'The claim mapping and version chain do not match.',
      { claimId: claim.id }
    );
  }

  const currentVersions = ordered.filter((version) => version.current === true);
  const rootVersions = ordered.filter((version) => version.root === true);
  if (currentVersions.length !== 1) {
    throw invalid(
      'CLAIM_LINEAGE_INVALID',
      'A claim response requires exactly one current Submission version.',
      { claimId: claim.id, currentVersionCount: currentVersions.length }
    );
  }
  if (rootVersions.length !== 1 || rootVersions[0].ordinal !== 1) {
    throw invalid(
      'CLAIM_LINEAGE_INVALID',
      'A claim response requires exactly one root at ordinal 1.',
      { claimId: claim.id, rootVersionCount: rootVersions.length }
    );
  }
  if (rootVersions[0].instanceId !== rootInstanceId) {
    throw invalid(
      'CLAIM_LINEAGE_INVALID',
      'The root claim version does not match the logical Submission instanceId.',
      { claimId: claim.id }
    );
  }

  return {
    id: claim.id,
    submissionId: claim.submissionId,
    rootInstanceId,
    currentVersionId: currentVersions[0].id,
    versions: ordered.map(shapeClaimVersion)
  };
};

module.exports = {
  SCHEMA_VERSION,
  LINEAGE_BASES,
  UUID_PATTERN,
  validateClaimVersion,
  validateClaimChain,
  shapeClaimVersion,
  shapeClaim
};
