// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

const { createHash } = require('crypto');

const REASONS = Object.freeze([
  'provenance-degraded', 'evidence-missing', 'evidence-mismatch',
  'integrity-unresolved', 'legacy-review-state', 'manual-referral'
]);
const OUTCOMES = Object.freeze(['accepted', 'needs-evidence', 'returned-for-correction', 'rejected']);

const reviewReasons = ({ provenanceDegraded = false, evidenceMissing = false,
  evidenceMismatch = false, integrityUnresolved = false, legacyHasIssues = false,
  manualReferral = false } = {}) => [
  provenanceDegraded && 'provenance-degraded',
  evidenceMissing && 'evidence-missing',
  evidenceMismatch && 'evidence-mismatch',
  integrityUnresolved && 'integrity-unresolved',
  legacyHasIssues && 'legacy-review-state',
  manualReferral && 'manual-referral'
].filter(Boolean);

// Only JSON values are allowed. A stable byte representation prevents object insertion
// order from changing a decision's digest; limits prevent unbounded audit payloads.
const canonicalJson = (value, depth = 0) => {
  if (depth > 12) throw new Error('Review snapshot is too deep.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item, depth + 1)).join(',')}]`;
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map((key) => {
      if (['__proto__', 'constructor', 'prototype'].includes(key))
        throw new Error('Unsafe review snapshot key.');
      return `${JSON.stringify(key)}:${canonicalJson(value[key], depth + 1)}`;
    }).join(',')}}`;
  }
  throw new Error('Review snapshot must contain only JSON values.');
};

const snapshotDigest = (items) => {
  if (!Array.isArray(items) || items.length > 100)
    throw new Error('Review snapshot must be an array of at most 100 items.');
  const canonical = canonicalJson(items);
  if (Buffer.byteLength(canonical, 'utf8') > 65536)
    throw new Error('Review snapshot exceeds 64 KiB.');
  return { canonical, hash: `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}` };
};

const validateDecision = ({ outcome, override = false, reasonCode, note }, allowedOverrideReasons = []) => {
  if (!OUTCOMES.includes(outcome)) throw new Error('Invalid review outcome.');
  if (typeof override !== 'boolean') throw new Error('Invalid override flag.');
  if (typeof reasonCode !== 'string' || (!REASONS.includes(reasonCode)
    && !(override && allowedOverrideReasons.includes(reasonCode))))
    throw new Error('Invalid review reason code.');
  if (override && (!allowedOverrideReasons.includes(reasonCode)
    || typeof note !== 'string' || !note.trim()))
    throw Object.assign(new Error('Override requires an allowed reason and note.'),
      { code: 'REVIEW_OVERRIDE_REASON_REQUIRED' });
  return { outcome, override, reasonCode, note: typeof note === 'string' ? note.trim() : null };
};

const nextCaseStatus = ({ status, current }, outcome) => {
  if (!current || status === 'superseded')
    throw Object.assign(new Error('Claim version has been superseded.'),
      { code: 'REVIEW_CLAIM_SUPERSEDED' });
  if (!['open', 'in-review', 'resolved'].includes(status) || !OUTCOMES.includes(outcome))
    throw new Error('Invalid review transition.');
  return ['accepted', 'rejected'].includes(outcome) ? 'resolved' : 'open';
};

module.exports = { reviewReasons, canonicalJson, snapshotDigest, validateDecision, nextCaseStatus };
