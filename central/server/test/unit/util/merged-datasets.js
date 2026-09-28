const Should = require('should'); // eslint-disable-line no-unused-vars
const { EXCLUDED, mergeFields, codingDivergence } = require('../../../lib/util/merged-datasets');

const field = (path, type, extra = {}) => ({
  path, name: path.split('/').pop(), type, binary: false, selectMultiple: false, ...extra
});

const form = (xmlFormId, fields) => ({ formId: xmlFormId.length, xmlFormId, fields });

const reasonFor = (excluded, path) => excluded.find(row => row.path === path)?.reason;

describe('(util) merged datasets', () => {
  describe('mergeFields', () => {
    it('merges a field both forms declare the same way', () => {
      const { merged, excluded } = mergeFields([
        form('round1', [field('/data/district', 'string')]),
        form('round2', [field('/data/district', 'string')])
      ]);
      merged.should.eql([{
        path: '/data/district', name: 'district', type: 'string', selectMultiple: false
      }]);
      excluded.should.be.empty();
    });

    // A column that is blank for every row of one form reads as "answered
    // nothing" when the truth is "was never asked".
    it('excludes a field one form does not have, and says which', () => {
      const { merged, excluded } = mergeFields([
        form('round1', [field('/data/district', 'string'), field('/data/gps', 'geopoint')]),
        form('round2', [field('/data/district', 'string')])
      ]);
      merged.should.have.length(1);
      reasonFor(excluded, '/data/gps').should.equal(EXCLUDED.MISSING);
      const { detail } = excluded.find(row => row.path === '/data/gps');
      detail.present.should.eql(['round1']);
      detail.absent.should.eql(['round2']);
    });

    // Coercing one side is how a merge becomes quietly wrong.
    it('excludes a path the forms type differently, and names both types', () => {
      const { merged, excluded } = mergeFields([
        form('round1', [field('/data/hh_size', 'int')]),
        form('round2', [field('/data/hh_size', 'string')])
      ]);
      merged.should.be.empty();
      reasonFor(excluded, '/data/hh_size').should.equal(EXCLUDED.TYPE);
      excluded[0].detail.should.eql({ round1: 'int', round2: 'string' });
    });

    it('excludes a field that takes several answers in only one form', () => {
      const { excluded } = mergeFields([
        form('round1', [field('/data/crops', 'string', { selectMultiple: true })]),
        form('round2', [field('/data/crops', 'string')])
      ]);
      reasonFor(excluded, '/data/crops').should.equal(EXCLUDED.SELECT);
    });

    it('excludes attachments and unsafe paths', () => {
      const { merged, excluded } = mergeFields([
        form('a', [field('/data/photo', 'binary', { binary: true }), field("/data/x'] | true", 'string')]),
        form('b', [field('/data/photo', 'binary', { binary: true }), field("/data/x'] | true", 'string')])
      ]);
      merged.should.be.empty();
      reasonFor(excluded, '/data/photo').should.equal(EXCLUDED.BINARY);
      reasonFor(excluded, "/data/x'] | true").should.equal(EXCLUDED.UNSAFE);
    });

    it('handles more than two forms', () => {
      const { merged, excluded } = mergeFields([
        form('r1', [field('/data/district', 'string'), field('/data/hh_size', 'int')]),
        form('r2', [field('/data/district', 'string'), field('/data/hh_size', 'int')]),
        form('r3', [field('/data/district', 'string')])
      ]);
      merged.map(f => f.path).should.eql(['/data/district']);
      reasonFor(excluded, '/data/hh_size').should.equal(EXCLUDED.MISSING);
    });

    // Two calls with the forms in a different order must agree, or the same
    // merge reads differently depending on how it was requested.
    it('does not depend on the order the forms arrive in', () => {
      const a = form('r1', [field('/data/b', 'string'), field('/data/a', 'string')]);
      const b = form('r2', [field('/data/a', 'string'), field('/data/b', 'string')]);
      mergeFields([a, b]).merged.should.eql(mergeFields([b, a]).merged);
      mergeFields([a, b]).merged.map(f => f.path).should.eql(['/data/a', '/data/b']);
    });

    it('returns nothing for no forms rather than throwing', () => {
      mergeFields([]).should.eql({ merged: [], excluded: [] });
    });
  });

  describe('codingDivergence', () => {
    // The case this exists for: one form records district names, the other
    // records codes, and merging them produces a column of nonsense.
    it('flags two forms that share no vocabulary at all', () => {
      const result = codingDivergence({
        round1: ['bombali', 'kambia'],
        round2: ['1', '2']
      });
      result.reason.should.equal('no-shared-values');
      result.samples.round1.should.eql(['bombali', 'kambia']);
    });

    it('says nothing when the forms agree on any value', () => {
      Should(codingDivergence({ a: ['bombali', 'kambia'], b: ['bombali'] })).be.null();
    });

    // Absence of data is not evidence of a clash.
    it('says nothing when a form has submitted no values yet', () => {
      Should(codingDivergence({ a: ['bombali'], b: [] })).be.null();
      Should(codingDivergence({ a: ['bombali'] })).be.null();
    });

    it('keeps its samples short enough to read', () => {
      const many = Array.from({ length: 40 }, (_, i) => `a${i}`);
      codingDivergence({ a: many, b: ['z'] }).samples.a.should.have.length(5);
    });
  });
});
