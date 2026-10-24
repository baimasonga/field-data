const should = require('should');
const { validateOutcomes, calibratedEstimate } = require('../../../lib/util/sampling-estimate');
const { draw } = require('../../../lib/util/backcheck-sample');
const seed = 'a'.repeat(32);
const fixture = () => {
  const eligible = ['North', 'South'].flatMap((groupValue, index) => Array.from({ length: index ? 2 : 8 }, (_, i) => ({ instanceId: `${groupValue}${i}`, submitterId: 1, groupValue })));
  const settings = { rate: 50, minPerCollector: 0, groupField: '/area', groupRates: [{ value: 'South', rate: 100 }] };
  const sample = { id: 'sample', seed, settings, eligible };
  const selected = draw(eligible, settings, seed).chosen;
  const body = { sampleId: sample.id, definition: 'Reviewed discrepancy', source: 'Review register 2026-10-24', outcomes: selected.map((row, i) => ({ instanceId: row.instanceId, value: i === 0 || row.groupValue === 'South' ? 1 : 0 })) };
  return { sample, selected, body, input: validateOutcomes(body, sample.id).input };
};
describe('(util) calibrated sampling estimate', () => {
  it('calibrates binary outcomes to exact stratum counts rather than a naive respondent mean', () => {
    const { sample, selected, input } = fixture();
    const result = calibratedEstimate(sample, selected, input);
    result.inputDigest.should.match(/^[0-9a-f]{64}$/);
    result.available.should.equal(true); result.estimatedPositiveTotal.should.equal(4); result.estimatedProportion.should.equal(0.4);
    result.strata.map(s => [s.calibrationTarget, s.reviewed, s.calibratedWeight]).should.eql([[8, 4, 2], [2, 2, 1]]);
    result.strata.reduce((sum, s) => sum + s.calibratedWeight * s.reviewed, 0).should.equal(10);
    result.interval.radius.should.be.approximately(Math.sqrt((Math.log(40) * 0.16) / 2), 1e-12);
    const reordered = validateOutcomes({ ...input, outcomes: [...input.outcomes].reverse() }, sample.id).input;
    calibratedEstimate(sample, [...selected].reverse(), reordered).should.eql(result);
  });

  it('requires explicit random-response acknowledgment, and never estimates an empty stratum', () => {
    const { sample, selected, input } = fixture();
    input.outcomes = input.outcomes.filter(row => row.value === 1);
    calibratedEstimate(sample, selected, input).should.containEql({ available: false, requiresResponseAssumption: true });
    input.assumeRandomResponse = true;
    const result = calibratedEstimate(sample, selected, input);
    result.estimatedProportion.should.equal(1); result.missing.should.equal(3);
    result.strata.map(s => [s.calibratedWeight, s.responseAdjustment]).should.eql([[8, 4], [1, 1]]);
    result.interval.lower.should.be.below(1); result.interval.upper.should.equal(1);
    input.outcomes = input.outcomes.filter(row => !row.instanceId.startsWith('South'));
    const absent = calibratedEstimate(sample, selected, input); absent.available.should.equal(false); should.not.exist(absent.estimatedProportion);
  });

  it('has exact complete-frame bounds but conservative uncertainty for singleton samples', () => {
    const sample = { id: 'sample', seed, settings: { rate: 100, minPerCollector: 0 }, eligible: [{ instanceId: 'one', submitterId: null }] };
    const selected = draw(sample.eligible, sample.settings, seed).chosen;
    const { input } = validateOutcomes({ sampleId: 'sample', definition: 'Confirmed', source: 'Register', outcomes: [{ instanceId: 'one', value: 1 }] }, 'sample');
    calibratedEstimate(sample, selected, input).interval.should.containEql({ lower: 1, upper: 1, radius: 0 });
    sample.eligible.push({ instanceId: 'two', submitterId: null }); sample.settings.rate = 1;
    const single = draw(sample.eligible, sample.settings, seed).chosen;
    input.outcomes = [{ instanceId: single[0].instanceId, value: 0 }];
    calibratedEstimate(sample, single, input).interval.upper.should.be.above(0);
  });

  it('rejects invalid inputs, unknown records, empty frames and inconsistent membership', () => {
    const { sample, selected, body, input } = fixture();
    for (const bad of [null, [], { ...body, sampleId: 'other' }, { ...body, definition: '' }, { ...body, source: 'x'.repeat(1001) },
      { ...body, assumeRandomResponse: 'yes' }, { ...body, extra: true }, { ...body, outcomes: [{ instanceId: 'x', value: true }] },
      { ...body, outcomes: [{ instanceId: 'x', value: 2 }] }, { ...body, outcomes: [body.outcomes[0], body.outcomes[0]] }])
      validateOutcomes(bad, sample.id).should.have.property('error');
    calibratedEstimate(sample, selected, { ...input, outcomes: [{ instanceId: 'unknown', value: 1 }] }).should.have.property('error');
    calibratedEstimate(sample, [], input).available.should.equal(false);
    calibratedEstimate({ ...sample, eligible: [] }, [], { ...input, outcomes: [] }).available.should.equal(false);
  });
});
