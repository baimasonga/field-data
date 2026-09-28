// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

const { strict: assert } = require('assert');
const { reviewReasons, snapshotDigest, validateDecision, nextCaseStatus } =
  require('../../../lib/util/review-surface');

describe('review surface rules', () => {
  it('opens only for explicit reasons in stable order', () => {
    assert.deepEqual(reviewReasons(), []);
    assert.deepEqual(reviewReasons({ manualReferral: true, evidenceMissing: true,
      provenanceDegraded: true }),
    ['provenance-degraded', 'evidence-missing', 'manual-referral']);
  });

  it('hashes equivalent snapshots identically without changing the inputs', () => {
    const first = [{ id: 'a', detail: { b: 2, a: 1 } }];
    const second = [{ detail: { a: 1, b: 2 }, id: 'a' }];
    assert.deepEqual(snapshotDigest(first), snapshotDigest(second));
    assert.equal(first[0].detail.b, 2);
    assert.match(snapshotDigest(first).hash, /^sha256:[a-f0-9]{64}$/);
  });

  it('rejects non-JSON and oversized snapshots', () => {
    assert.throws(() => snapshotDigest([{ date: new Date() }]), /JSON values/);
    assert.throws(() => snapshotDigest([{ bad: undefined }]), /JSON values/);
    assert.throws(() => snapshotDigest(Array(101).fill(null)), /at most 100/);
    assert.throws(() => snapshotDigest([{ content: 'x'.repeat(65536) }]), /64 KiB/);
    assert.throws(() => snapshotDigest([JSON.parse('{"__proto__":1}')]), /Unsafe/);
  });

  it('requires an allow-listed reason and a meaningful note for overrides', () => {
    assert.equal(validateDecision({ outcome: 'accepted', override: true,
      reasonCode: 'verified-by-supervisor', note: '  Checked on site.  ' },
    ['verified-by-supervisor']).note, 'Checked on site.');
    assert.throws(() => validateDecision({ outcome: 'accepted', override: true,
      reasonCode: 'verified-by-supervisor', note: '   ' }, ['verified-by-supervisor']),
    { code: 'REVIEW_OVERRIDE_REASON_REQUIRED' });
    assert.throws(() => validateDecision({ outcome: 'accepted', override: true,
      reasonCode: 'unknown', note: 'Checked' }, ['verified-by-supervisor']));
  });

  it('guards superseded cases and maps decisions to case status', () => {
    assert.equal(nextCaseStatus({ status: 'in-review', current: true }, 'accepted'), 'resolved');
    assert.equal(nextCaseStatus({ status: 'in-review', current: true }, 'needs-evidence'), 'open');
    assert.throws(() => nextCaseStatus({ status: 'open', current: false }, 'accepted'),
      { code: 'REVIEW_CLAIM_SUPERSEDED' });
  });
});
