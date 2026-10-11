require('should');
const { summarize, summarizeByArea } = require('../../../lib/util/asset-projection');

const fact = (value, status) => ({ fact: { value, freshness: { status } } });

describe('(util) asset status projection', () => {
  it('counts values only while the fact is current, and every status', () => {
    summarize([
      fact('operating', 'fresh'), fact('broken', 'review-due'), fact('operating', 'review-due'),
      fact('operating', 'expired'), fact(null, 'unknown'), fact('broken', 'source-unverified'), { fact: null }, { fact: null }
    ]).should.eql({
      byValue: [{ value: 'operating', count: 2 }, { value: 'broken', count: 1 }],
      byStatus: { fresh: 1, 'review-due': 2, expired: 1, unknown: 1, 'source-unverified': 1, 'not-yet-valid': 0, none: 2 }
    });
  });

  it('orders equal counts by value and handles no assets', () => {
    summarize([fact('b', 'fresh'), fact('a', 'fresh')]).byValue.should.eql([{ value: 'a', count: 1 }, { value: 'b', count: 1 }]);
    summarize([]).should.eql({ byValue: [], byStatus: { fresh: 0, 'review-due': 0, expired: 0, unknown: 0, 'source-unverified': 0, 'not-yet-valid': 0, none: 0 } });
  });

  it('summarises each area, with unknown areas last and stale area facts counted (K6)', () => {
    const at = (value, status, area, areaStatus = 'fresh', state = 'known') => ({ ...fact(value, status), area: area === undefined ? null : { value: area, state, freshness: { status: areaStatus } } });
    const groups = summarizeByArea([
      at('operating', 'fresh', 'Kenema'), at('broken', 'fresh', 'Bo'), at('broken', 'expired', 'Bo', 'expired'),
      at('operating', 'fresh', 'Kenema', 'review-due'), at('operating', 'fresh'), at('broken', 'fresh', 'Bo', 'fresh', 'unknown'),
      at('operating', 'fresh', ''), { fact: null, area: { value: 'Kenema', state: 'known', freshness: { status: 'fresh' } } }
    ]);
    groups.map((g) => [g.area, g.assets, g.areaNotCurrent]).should.eql([['Bo', 2, 1], ['Kenema', 3, 0], [null, 3, 0]]);
    groups[0].byValue.should.eql([{ value: 'broken', count: 1 }]);
    groups[0].byStatus.expired.should.equal(1);
    groups[1].byValue.should.eql([{ value: 'operating', count: 2 }]);
    groups[1].byStatus.none.should.equal(1);
    groups[2].byValue.should.eql([{ value: 'operating', count: 2 }, { value: 'broken', count: 1 }]);
    summarizeByArea([]).should.eql([]);
  });
});
