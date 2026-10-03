const assert = require('node:assert/strict');
const { normalizeAnalysis, sourceRowsSql, mapFeatures } = require('../../../lib/util/analysis-data');
const { sql } = require('slonik');
const source = { kind: 'filtered', fields: [{ path: '/district', name: 'district', type: 'string' }],
  dataset: { formId: 1, xmlFormId: 'survey' }, definition: { columns: ['/district'], query: [{ column: '/secret', filter: '=', value: 'north', condition: 'AND' }],
    fieldByPath: new Map([['/secret', { type: 'string' }]]) } };
describe('(util) analysis workspace', () => {
  it('rejects a hidden field in a chart, filter and map selection', () => {
    for (const extra of [{ query: [{ column: '/secret', filter: '=', value: 'x' }] }, { chart: { column: '/secret', aggregation: 'count' } }, { geometry: '/secret' }])
      assert.throws(() => normalizeAnalysis({ source: { kind: 'filtered', id: 1 }, ...extra }, source));
  });
  it('projects delegated fields after applying the saved boundary', () => {
    const token = sql`${sourceRowsSql(source)}`;
    assert.ok(token.values.includes('/secret'));
    assert.ok(token.values.includes('north'));
    assert.ok(token.values.some(v => Array.isArray(v) && v.length === 1 && v[0] === '/district'));
    assert.match(token.sql, /from \([\s\S]*\) as source where/);
  });
  it('preserves longitude/latitude and excludes invalid fixes', () => {
    const result = mapFeatures([{ instanceId: 'ok', data: { '/point': '8.4 -13.2 0 4' } }, { instanceId: 'invalid', data: { '/point': '0 0' } }], '/point');
    assert.equal(result.features.length, 1);
    assert.deepEqual(result.features[0].geometry.coordinates, [-13.2, 8.4]);
  });
});
