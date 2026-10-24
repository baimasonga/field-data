const assert = require('node:assert/strict');
const { compare } = require('../../../lib/util/asset-location-comparison');
const at = new Date('2026-10-24T12:00:00Z');
const fact = patch => ({ id: 'observation', predicate: 'location', claimVersionId: 'claim', state: 'known', value: '8.4 -13.2 0 10',
  validFrom: '2026-10-24T10:00:00Z', recordedAt: '2026-10-24T11:00:00Z', sequence: 1, validityDays: 30, graceDays: 1, integrityStatus: 'verified', ...patch });
describe('recorded asset location comparison', () => {
  it('calculates spherical separation and named device-radius ranges without an identity decision', () => {
    const result = compare([fact()], [fact({ value: '8.4001 -13.2 0 20' })], 'location', at);
    assert.ok(result.distanceMetres > 11 && result.distanceMetres < 12);
    assert.equal(result.reportedAccuracyRangeMetres.minimum, 0);
    assert.equal(result.reportedAccuracyRangeMetres.maximum, result.distanceMetres + 30);
    assert.equal(result.decision, undefined);
    assert.equal(compare([fact({ value: '8.4 -13.2' })], [fact()], 'location', at).reportedAccuracyRangeMetres, null);
  });
  it('withholds malformed, unknown, expired and unverified facts without falling back to older known readings', () => {
    for (const value of ['0 0', '91 1', '8 -13 0 -1', '8 -13 0 1 extra', '8 -13 bad', '8 -13 0 Infinity']) assert.equal(compare([fact({ value })], [fact()], 'location', at).a.status, 'invalid-geopoint');
    for (const patch of [{ state: 'unknown', value: null }, { integrityStatus: 'unverified' }, { validFrom: '2020-01-01T00:00:00Z' }]) assert.equal(compare([fact(patch)], [fact()], 'location', at).distanceMetres, null);
    const replacement = fact({ state: 'not-observed', value: null, sequence: 2, recordedAt: '2026-10-24T11:30:00Z' });
    assert.equal(compare([fact(), replacement], [fact()], 'location', at).a.status, 'not-observed');
    assert.equal(compare([fact({ validFrom: '2026-10-25T00:00:00Z' })], [], 'location', at).a.status, 'missing');
    assert.equal(compare([fact()], [fact()], 'another fact', at).distanceMetres, null);
  });
});
