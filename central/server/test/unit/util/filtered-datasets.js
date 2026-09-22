const Should = require('should'); // eslint-disable-line no-unused-vars
const { normalizeDefinition, resolveStoredDefinition, compileFilter, extractObject, projectObject } = require('../../../lib/util/filtered-datasets');

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

  it('passes the paths as one array parameter, not two per field', () => {
    // The paths used to be spread into jsonb_build_object as a key and a value
    // each, which Postgres refuses past 100 arguments -- a ceiling of 50
    // fields. Binding one array keeps the statement a fixed size, so the guard
    // that matters is the parameter count, not its contents.
    const extraction = extractObject(['/data/district', '/data/hh_size']);
    extraction.values.should.eql([['/data/district', '/data/hh_size']]);
    extraction.sql.should.containEql('jsonb_object_agg');
    extraction.sql.should.not.containEql('jsonb_build_object');

    const projection = projectObject(['/data/district']);
    projection.values.should.eql([['/data/district']]);

    // A wide Form binds exactly as many parameters as a narrow one.
    const wide = extractObject(Array.from({ length: 200 }, (unused, i) => `/data/q${i}`));
    wide.values.length.should.equal(1);
  });

  describe('resolveStoredDefinition', () => {
    // Filters on district, shows district and hh_size. Keeping the filter
    // field separate from the droppable one is what lets the two kinds of
    // loss be told apart below.
    const saved = {
      columns: ['/data/district', '/data/hh_size'],
      query: [{ column: '/data/district', filter: '=', value: 'Bombali', condition: 'AND' }]
    };

    it('resolves cleanly while the form still has every field', () => {
      const resolved = resolveStoredDefinition(saved, fields);
      resolved.usable.should.equal(true);
      resolved.columns.should.eql(['/data/district', '/data/hh_size']);
      resolved.missingColumns.should.be.empty();
      resolved.missingFilters.should.be.empty();
    });

    // A republished form that drops a visible field costs the reader a column,
    // not the whole dataset.
    it('keeps serving the columns that survive a republished form', () => {
      // hh_size is gone; district, which the filter needs, is not.
      const resolved = resolveStoredDefinition(saved, [fields[0]]);
      resolved.usable.should.equal(true);
      resolved.columns.should.eql(['/data/district']);
      resolved.missingColumns.should.eql(['/data/hh_size']);
    });

    // The filter is what narrows the rows. Losing it and carrying on would
    // widen the result to rows the dataset exists to hide, so it fails closed.
    it('refuses to serve anything when a filter field is gone', () => {
      const resolved = resolveStoredDefinition(
        { columns: ['/data/district'], query: [{ column: '/data/gone', filter: '=', value: 'x' }] },
        fields
      );
      resolved.usable.should.equal(false);
      resolved.missingFilters.should.eql(['/data/gone']);
    });

    it('is unusable when no visible field survives', () => {
      resolveStoredDefinition({ columns: ['/data/gone'], query: [] }, fields)
        .usable.should.equal(false);
    });

    it('does not throw on anything a reader could be handed', () => {
      for (const definition of [null, {}, { columns: null, query: null },
        { columns: ['/data/photo'], query: [] }]) {
        (() => resolveStoredDefinition(definition, fields)).should.not.throw();
      }
    });
  });
});
