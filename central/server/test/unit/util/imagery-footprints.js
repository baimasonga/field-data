const assert = require('node:assert/strict');
const { geometryFor, coverage } = require('../../../lib/util/imagery-footprints');
const square = [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]];
describe('imagery footprint topology', () => {
  it('distinguishes interior, exterior, holes and boundaries using longitude/latitude order', () => {
    const hole = [[0.5, 0.5], [1.5, 0.5], [1.5, 1.5], [0.5, 1.5], [0.5, 0.5]];
    const shape = geometryFor({ type: 'Polygon', coordinates: [square, hole] });
    const check = (longitude, latitude, accuracy = 5) => coverage(shape, { longitude, latitude, accuracy });
    assert.equal(check(0.25, 1).relation, 'inside'); assert.equal(check(1, 1).relation, 'outside');
    assert.equal(check(0, 1).relation, 'boundary'); assert.equal(check(0.5, 1).relation, 'boundary');
    assert.equal(check(3, 1).relation, 'outside'); assert.equal(check(0.00001, 1).accuracyRelation, 'crosses-boundary');
    assert.equal(check(0.25, 1, null).accuracyRelation, 'unknown'); assert.equal(coverage(shape, null).relation, 'unavailable');
  });
  it('supports disjoint multipolygons and rejects invalid geometry, open rings and dateline crossings', () => {
    const other = square.map(([x, y]) => [x + 10, y]);
    const shape = geometryFor({ type: 'MultiPolygon', coordinates: [[square], [other]] });
    assert.equal(coverage(shape, { longitude: 11, latitude: 1, accuracy: 5 }).relation, 'inside');
    for (const geometry of [
      { type: 'Point', coordinates: [0, 1] }, { type: 'Polygon', coordinates: [square.slice(0, -1)] },
      { type: 'Polygon', coordinates: [[[179, 0], [-179, 0], [-179, 2], [179, 2], [179, 0]]] },
      { type: 'Polygon', coordinates: [[[0, 0], [2, 2], [0, 2], [2, 0], [0, 0]]] },
      { type: 'Polygon', coordinates: [square], extra: true }
    ]) assert.throws(() => geometryFor(geometry));
  });
});
