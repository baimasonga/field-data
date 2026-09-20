const Should = require('should'); // eslint-disable-line no-unused-vars
const { normalizeDefinition, compileFilter, extractObject, projectObject } = require('../../../lib/util/filtered-datasets');

const fields = [
  { path: '/data/district', name: 'district', type: 'string', binary: false },
  { path: '/data/hh_size', name: 'hh_size', type: 'int', binary: false },
  { path: '/data/photo', name: 'photo', type: 'binary', binary: true }
];

describe('(util) filtered datasets', () => {
  it('normalizes Ona-shaped filters against the current form fields', () => {
    const result = normalizeDefinition({
      columns: ['/data/district'],
      query: [
        { column: '/data/district', filter: '=', value: 'Bombali' },
        { column: '/data/hh_size', filter: '>', value: 4, condition: 'or' }
      ]
    }, fields);
    result.columns.should.eql(['/data/district']);
    result.query.should.eql([
      { column: '/data/district', filter: '=', value: 'Bombali', condition: 'AND' },
      { column: '/data/hh_size', filter: '>', value: '4', condition: 'OR' }
    ]);
  });

  it('refuses unknown, binary and unsafe paths', () => {
    for (const column of ['/data/missing', '/data/photo', "/data/a'] | true --"]) {
      (() => normalizeDefinition({ columns: [column], query: [] }, fields))
        .should.throw(/readable field/);
    }
  });

  it('maps operators and parameterizes every path and value', () => {
    const normalized = normalizeDefinition({
      columns: ['/data/district'],
      query: [
        { column: '/data/district', filter: '=', value: "x' or true --" },
        { column: '/data/hh_size', filter: '>=', value: '4', condition: 'AND' }
      ]
    }, fields);
    const token = compileFilter(normalized.query, normalized.fieldByPath);
    token.sql.should.not.containEql("x' or true --");
    token.values.should.containEql("x' or true --");
    token.sql.should.containEql('::numeric');
  });

  it('builds XML extraction and visible projection with parameters', () => {
    const extraction = extractObject(['/data/district', '/data/hh_size']);
    extraction.values.should.containEql('/*/data/district/text()');
    extraction.values.should.containEql('/*/data/hh_size/text()');
    const projection = projectObject(['/data/district']);
    projection.values.should.eql(['/data/district', '/data/district']);
  });
});
