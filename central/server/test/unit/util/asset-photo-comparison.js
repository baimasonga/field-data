const assert = require('node:assert/strict');
const { reference } = require('../../../lib/util/asset-photo-comparison');
const at = new Date('2026-10-24T12:00:00Z');
const fact = patch => ({ id: 'observation', predicate: 'photo', claimVersionId: 'claim', state: 'known', value: 'scene.jpg',
  validFrom: '2026-10-24T10:00:00Z', recordedAt: '2026-10-24T11:00:00Z', sequence: 1, validityDays: 30, graceDays: 1, integrityStatus: 'verified', ...patch });
describe('cited asset photo references', () => {
  it('selects exact bounded attachment names without URLs, paths or arbitrary source substitutions', () => {
    assert.equal(reference([fact()], 'photo', at).name, 'scene.jpg');
    for (const value of ['', '../photo.jpg', 'https://other.test/photo.jpg', 'folder\\photo.jpg', 'x'.repeat(256), ' scene.jpg', 'scene.jpg\n']) assert.equal(reference([fact({ value })], 'photo', at).status, 'invalid-photo-reference');
    assert.equal(reference([fact()], 'another fact', at).status, 'missing');
  });
  it('withholds unknown, stale, future and source-unverified references without an older fallback', () => {
    for (const [patch, status] of [[{ state: 'not-observed', value: null }, 'not-observed'], [{ integrityStatus: 'unverified' }, 'source-unverified'], [{ validFrom: '2020-01-01T00:00:00Z' }, 'expired'], [{ validFrom: '2027-01-01T00:00:00Z' }, 'missing']]) assert.equal(reference([fact(patch)], 'photo', at).status, status);
    assert.equal(reference([fact(), fact({ state: 'unknown', value: null, sequence: 2 })], 'photo', at).status, 'unknown');
  });
});
