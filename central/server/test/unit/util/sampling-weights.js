const should = require('should');
const { samplingWeights } = require('../../../lib/util/sampling-weights');
const { draw } = require('../../../lib/util/backcheck-sample');
const seed = 'a'.repeat(32);
describe('(util) sampling weights', () => {
  it('uses actual rounding, minimums, unequal rates and missing groups at each collector intersection', () => {
    const eligible = [1, 2].flatMap(submitterId => ['North', 'South', null].flatMap(groupValue =>
      Array.from({ length: 5 }, (_, i) => ({ instanceId: `${submitterId}-${groupValue}-${i}`, submitterId, groupValue }))));
    const settings = { rate: 10, minPerCollector: 2, groupField: '/district', groupRates: [{ value: 'North', rate: 100 }, { value: null, rate: 60 }] };
    const selected = draw(eligible, settings, seed).chosen;
    const result = samplingWeights(eligible, selected, settings, seed);
    result.available.should.equal(true);
    result.strata.map(s => [s.eligible, s.sampled, s.designWeight, s.inclusionProbability]).should.eql([
      [5, 5, 1, 1], [5, 2, 2.5, 0.4], [5, 3, 5 / 3, 0.6], [5, 5, 1, 1], [5, 2, 2.5, 0.4], [5, 3, 5 / 3, 0.6]
    ]);
    result.items.reduce((sum, item) => sum + item.designWeight, 0).should.be.approximately(30, 1e-10);
    samplingWeights([...eligible].reverse(), [...selected].reverse(), settings, seed).should.eql(result);
    // Live actor FKs can be null after deletion; snapshot collector IDs still define strata.
    samplingWeights(eligible, selected.map(item => ({ ...item, submitterId: null })), settings, seed).should.eql(result);
  });

  it('supports legacy collector-only and empty draws without inferring zero denominators', () => {
    const settings = { rate: 34, minPerCollector: 1 };
    const eligible = Array.from({ length: 6 }, (_, i) => ({ instanceId: String(i), submitterId: null }));
    const result = samplingWeights(eligible, draw(eligible, settings, seed).chosen, settings, seed);
    result.strata.should.eql([{ submitterId: null, eligible: 6, sampled: 3, inclusionProbability: 0.5, designWeight: 2 }]);
    samplingWeights([], [], settings, seed).should.containEql({ available: true, eligible: 0, sampled: 0, strata: [], items: [] });
  });

  it('withholds weights for inconsistent, incomplete or invalid history', () => {
    const settings = { rate: 10, minPerCollector: 1 };
    const eligible = [{ instanceId: 'a', submitterId: 1 }, { instanceId: 'b', submitterId: 1 }];
    const selected = draw(eligible, settings, seed).chosen;
    for (const [rows, items, spec, random] of [[eligible, [], settings, seed], [eligible, [...selected, ...selected], settings, seed],
      [[...eligible, eligible[0]], selected, settings, seed], [eligible, [{ instanceId: 'outside' }], settings, seed],
      [eligible, selected, settings, 'bad'], [null, selected, settings, seed], [eligible, selected, { rate: 0 }, seed], [eligible, selected, { ...settings, groupRates: [{ value: 'bad', rate: 0 }] }, seed]]) {
      const result = samplingWeights(rows, items, spec, random);
      result.available.should.equal(false); should.not.exist(result.items); should.not.exist(result.strata);
    }
  });
});
