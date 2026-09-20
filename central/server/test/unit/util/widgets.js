const Should = require('should'); // eslint-disable-line no-unused-vars
const { normalizeWidget, capRows, tooManyDistinct, MAX_BARS } = require('../../../lib/util/widgets');

const fields = [
  { path: '/data/district', name: 'district', type: 'string', binary: false },
  { path: '/data/hh_size', name: 'hh_size', type: 'int', binary: false },
  { path: '/data/spend', name: 'spend', type: 'decimal', binary: false },
  { path: '/data/photo', name: 'photo', type: 'binary', binary: true }
];

describe('(util) widgets', () => {
  describe('normalizeWidget', () => {
    it('accepts a count of one field, which needs no second field', () => {
      const widget = normalizeWidget(
        { title: 'Households by district', column: '/data/district' }, fields
      );
      widget.aggregation.should.equal('count');
      Should(widget.groupBy).be.null();
      widget.viewType.should.equal('bar');
    });

    it('accepts a number aggregated per group', () => {
      const widget = normalizeWidget({
        title: 'Mean household size by district',
        column: '/data/hh_size', groupBy: '/data/district', aggregation: 'mean'
      }, fields);
      widget.aggregation.should.equal('mean');
      widget.groupBy.should.equal('/data/district');
    });

    it('wants a title, because an untitled chart tells a reader nothing', () => {
      (() => normalizeWidget({ column: '/data/district' }, fields))
        .should.throw(/title/);
    });

    // The whole point of passing the parent's field list: a widget over a
    // filtered dataset is handed only that dataset's visible columns, so a
    // hidden field is simply not a field it can name.
    it('refuses a field its parent does not expose', () => {
      (() => normalizeWidget(
        { title: 'Sneaky', column: '/data/hh_size' }, [fields[0]]
      )).should.throw(/allowed to read/);
    });

    it('refuses binary fields and unsafe paths', () => {
      for (const column of ['/data/photo', "/data/x'] | true --", '/data/missing']) {
        (() => normalizeWidget({ title: 'x', column }, fields))
          .should.throw(/allowed to read/);
      }
    });

    // Averaging a district name is not a question with an answer.
    it('refuses to average something that is not a number', () => {
      (() => normalizeWidget({
        title: 'x', column: '/data/district', groupBy: '/data/hh_size', aggregation: 'mean'
      }, fields)).should.throw(/needs a number/);
    });

    it('wants a group for every aggregation except count', () => {
      for (const aggregation of ['sum', 'mean', 'median']) {
        (() => normalizeWidget(
          { title: 'x', column: '/data/hh_size', aggregation }, fields
        )).should.throw(/group by/);
      }
    });

    it('refuses a second field on a count, which already groups by its own', () => {
      (() => normalizeWidget({
        title: 'x', column: '/data/district', groupBy: '/data/hh_size', aggregation: 'count'
      }, fields)).should.throw(/no second field/);
    });

    it('refuses to group a field by itself', () => {
      (() => normalizeWidget({
        title: 'x', column: '/data/hh_size', groupBy: '/data/hh_size', aggregation: 'sum'
      }, fields)).should.throw(/by itself/);
    });

    it('refuses an unknown aggregation or view', () => {
      (() => normalizeWidget(
        { title: 'x', column: '/data/district', aggregation: 'stddev' }, fields
      )).should.throw(/count, sum, mean or median/);
      (() => normalizeWidget(
        { title: 'x', column: '/data/district', viewType: 'pie' }, fields
      )).should.throw(/bar or table/);
    });
  });

  describe('capRows', () => {
    const rows = (n) => Array.from({ length: n }, (_, i) => ({ key: `k${i}`, count: 100 - i }));

    it('leaves a readable chart alone', () => {
      const capped = capRows(rows(MAX_BARS));
      capped.rows.should.have.length(MAX_BARS);
      Should(capped.omitted).be.null();
    });

    // Eight bars that look like the whole picture are worse than eight bars
    // that say what they are eight of.
    it('says how much it left out rather than truncating quietly', () => {
      const capped = capRows(rows(20));
      capped.rows.should.have.length(MAX_BARS);
      capped.omitted.groups.should.equal(12);
      capped.omitted.count.should.be.above(0);
    });

    // Summing counts is fair; summing averages is not, so the tail of an
    // aggregated chart reports its group count and no number.
    it('does not invent a total for rows that carry no count', () => {
      const capped = capRows(Array.from({ length: 12 },
        (_, i) => ({ key: `k${i}`, value: i, count: undefined })));
      Should(capped.omitted.count).be.null();
    });
  });

  describe('tooManyDistinct', () => {
    it('calls out a field with an answer per submission', () => {
      tooManyDistinct(400).should.equal(true);
      tooManyDistinct(6).should.equal(false);
    });
  });
});
