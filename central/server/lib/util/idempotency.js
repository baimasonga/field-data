// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

const { createHash } = require('crypto');
const { UUID_PATTERN } = require('./claim-versioning');

const validateKey = (key) => {
  if (key == null) throw Object.assign(new Error('Idempotency-Key is required.'),
    { code: 'IDEMPOTENCY_KEY_REQUIRED' });
  if (typeof key !== 'string' || key.length < 1 || key.length > 200
    || !/^[\x21-\x7e]+$/.test(key))
    throw Object.assign(new Error('Idempotency-Key must be 1–200 printable ASCII characters.'),
      { code: 'IDEMPOTENCY_KEY_INVALID' });
  return key;
};

const hashEvidenceLink = ({ claimVersionId, evidenceId, relation, supersedesLinkId = null }) => {
  if (![claimVersionId, evidenceId].every((value) => typeof value === 'string'
    && UUID_PATTERN.test(value))) throw new Error('Evidence links require UUID identifiers.');
  if (!['supports', 'contradicts', 'context'].includes(relation))
    throw new Error('Evidence relation is invalid.');
  if (supersedesLinkId != null && !UUID_PATTERN.test(supersedesLinkId))
    throw new Error('Superseded link ID must be a UUID.');
  // Fixed-field JSON for this constrained string/null schema: equivalent
  // requests have identical bytes regardless of input object key order.
  const canonical = JSON.stringify({ claimVersionId: claimVersionId.toLowerCase(),
    evidenceId: evidenceId.toLowerCase(), relation,
    supersedesLinkId: supersedesLinkId?.toLowerCase() ?? null });
  return `sha256:${createHash('sha256')
    .update(`p0.4\nevidence.link.create\n${canonical}`, 'utf8').digest('hex')}`;
};

const hashReviewAssignment = ({ caseId, revision, assignedTo }) => {
  if (typeof caseId !== 'string' || !UUID_PATTERN.test(caseId)
    || !Number.isSafeInteger(revision) || revision < 1
    || !Number.isSafeInteger(assignedTo) || assignedTo < 1)
    throw new Error('Invalid review assignment.');
  const canonical = JSON.stringify({ caseId: caseId.toLowerCase(), revision, assignedTo });
  return `sha256:${createHash('sha256')
    .update(`p0.5\nreview.case.assign\n${canonical}`, 'utf8').digest('hex')}`;
};

module.exports = { validateKey, hashEvidenceLink, hashReviewAssignment };
