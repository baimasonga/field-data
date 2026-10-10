require('should');
const { summarize } = require('../../../lib/util/asset-projection');

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
});
