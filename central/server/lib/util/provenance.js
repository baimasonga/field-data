// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// Where a Submission version came from. See
// docs/field-intelligence/P0.1-provenance-envelope.md for the contract; this
// file is its implementation and the error table there is the specification
// for validateEnvelope.

const { createHash } = require('crypto');

const ORIGINS = ['collected', 'imported', 'migrated', 'api'];
const POLICY_VERSION = 'p0.1';

// Clocks on field devices are wrong more often than anyone expects, so a
// little skew is tolerated silently and anything beyond it is recorded rather
// than corrected. Five minutes is enough for ordinary drift and short of the
// range where a timestamp is telling you something.
const CLOCK_SKEW_MS = 5 * 60 * 1000;

// Over the exact bytes that are stored. A hash taken over a re-serialized or
// re-encoded copy answers a different question than "is this still what
// arrived", which is the only question this field exists to answer.
const canonicalHash = (xml) => createHash('sha256')
  .update(Buffer.isBuffer(xml) ? xml : Buffer.from(String(xml), 'utf8'))
  .digest('hex');

const parseInstant = (value) => {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? undefined : date;
};

const buildEnvelope = ({ origin, sourceRef = null, capturedAt = null, xml, transformVersion, now = new Date() }) => {
  const degraded = {};

  // Null is the honest answer when the observation time is unknown, and the
  // marker says so. Substituting the receipt time would turn "we do not know"
  // into a fact, which is the failure this whole envelope exists to prevent.
  let captured = parseInstant(capturedAt);
  if (captured === undefined) {
    degraded.capturedAt = 'unparseable';
    captured = null;
  } else if (captured == null) {
    degraded.capturedAt = 'unknown';
  } else if (captured.valueOf() > now.valueOf() + CLOCK_SKEW_MS) {
    // Recorded, not corrected. A reviewer can judge a device with a wrong
    // clock; they cannot judge a timestamp somebody quietly moved.
    degraded.capturedAt = 'implausible';
  }

  return {
    origin,
    sourceRef,
    capturedAt: captured,
    receivedAt: now,
    integrityHash: canonicalHash(xml),
    transformVersion,
    policyVersion: POLICY_VERSION,
    degraded: Object.keys(degraded).length === 0 ? null : degraded
  };
};

const invalid = (reason) => Object.assign(new Error(reason), { provenanceInvalid: true });

const validateEnvelope = (envelope) => {
  if (envelope == null || typeof envelope !== 'object')
    throw invalid('Provenance is required for a new Submission version.');
  if (!ORIGINS.includes(envelope.origin))
    throw invalid(`Provenance origin must be one of: ${ORIGINS.join(', ')}.`);
  if (typeof envelope.integrityHash !== 'string' || !/^[0-9a-f]{64}$/.test(envelope.integrityHash))
    throw invalid('Provenance integrityHash must be a sha256 digest in lowercase hex.');
  if (typeof envelope.transformVersion !== 'string' || envelope.transformVersion === '')
    throw invalid('Provenance transformVersion must say what produced the row.');
  if (typeof envelope.policyVersion !== 'string' || envelope.policyVersion === '')
    throw invalid('Provenance policyVersion is required.');
  if (!(envelope.receivedAt instanceof Date) || Number.isNaN(envelope.receivedAt.valueOf()))
    throw invalid('Provenance receivedAt must be a valid instant.');
  if (envelope.capturedAt != null && !(envelope.capturedAt instanceof Date))
    throw invalid('Provenance capturedAt must be an instant or null.');
  return envelope;
};

module.exports = {
  ORIGINS, POLICY_VERSION, CLOCK_SKEW_MS, canonicalHash, buildEnvelope, validateEnvelope
};
