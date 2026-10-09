// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const assert = require('node:assert/strict');
const { timestamp, freshness, selectFacts } = require('../../../lib/util/asset-freshness');
describe('asset temporal knowledge', () => {
  const row = { id: 'first', predicate: 'condition', state: 'known', value: 'operating',
    sequence: 1, validFrom: '2026-01-01T00:00:00Z', recordedAt: '2026-01-02T00:00:00Z', validityDays: 10, graceDays: 2 };
  it('distinguishes future validity, exact due/grace boundaries, unknown and unverified sources', () => {
    assert.equal(freshness(row, '2025-12-31T23:59:59Z').status, 'not-yet-valid');
    assert.equal(freshness(row, '2026-01-10T23:59:59Z').status, 'fresh');
    assert.equal(freshness(row, '2026-01-11T00:00:00Z').status, 'review-due');
    assert.equal(freshness(row, '2026-01-13T00:00:00Z').status, 'expired');
    assert.equal(freshness({ ...row, graceDays: 0 }, '2026-01-11T00:00:00Z').status, 'expired');
    for (const state of ['unknown', 'not-observed', 'not-applicable'])
      assert.equal(freshness({ ...row, state }, '2026-01-20T00:00:00Z').status, 'unknown');
    assert.equal(freshness({ ...row, integrityStatus: 'unverified' }, '2026-01-02T00:00:00Z').status, 'source-unverified');
  });
  it('preserves what was known before a late-arriving correction and future observations', () => {
    const correction = { ...row, id: 'correction', sequence: 2, value: 'damaged', recordedAt: '2026-01-05T00:00:00Z' };
    const future = { ...row, id: 'future', sequence: 3, validFrom: '2026-02-01T00:00:00Z', recordedAt: '2026-01-06T00:00:00Z' };
    const history = [future, correction, row];
    assert.equal(selectFacts(history, new Date('2026-01-03'), new Date('2026-01-04'))[0].id, 'first');
    assert.equal(selectFacts(history, new Date('2026-01-03'), new Date('2026-01-07'))[0].id, 'correction');
    assert.equal(selectFacts(history, new Date('2026-02-02'), new Date('2026-02-02'))[0].id, 'future');
    assert.deepEqual(selectFacts(history, new Date('2026-01-03'), new Date('2026-01-01')), []);
    const late = { ...row, id: 'late', sequence: 4, recordedAt: '2026-03-01T00:00:00Z' };
    assert.equal(selectFacts([...history, late], new Date('2026-02-02'), new Date('2026-03-02'))[0].id, 'future');
    assert.equal(selectFacts([...history, late], new Date('2026-01-03'), new Date('2026-03-02'))[0].id, 'late');
  });
  it('requires an explicit timezone and rejects normalized invalid calendar dates', () => {
    for (const value of ['2026-02-30T00:00:00Z', '2025-02-29T00:00:00Z', '2026-01-01', '2026-01-01T00:00:00', null])
      assert.equal(timestamp(value), false);
    for (const value of ['2024-02-29T12:30:00Z', '2026-01-01T12:30:00.123456+02:00'])
      assert.equal(timestamp(value), true);
  });
});
