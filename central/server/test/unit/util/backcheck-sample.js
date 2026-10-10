require('should');
const { createHash } = require('crypto');
const { LIMITS, SEED_PATTERN, newSeed, drawKey, validateSettings, takeFrom, draw } = require('../../../lib/util/backcheck-sample');

const seed = '0123456789abcdef0123456789abcdef';
const subs = (submitterId, n, prefix = `s${submitterId}`) =>
  Array.from({ length: n }, (_, i) => ({ instanceId: `uuid:${prefix}-${i}`, submitterId }));

describe('(util) backcheck sample', () => {
  it('orders by a published hash of seed and instance ID', () => {
    drawKey(seed, 'uuid:a').should.equal(createHash('sha256').update(`${seed}:uuid:a`).digest('hex'));
    newSeed().should.match(SEED_PATTERN);
    newSeed().should.not.equal(newSeed());
  });

  it('takes the rate of each stratum, rounded up, at least the minimum, at most all', () => {
    takeFrom(40, { rate: 10, minPerCollector: 1 }).should.equal(4);
    takeFrom(41, { rate: 10, minPerCollector: 1 }).should.equal(5);
    takeFrom(3, { rate: 10, minPerCollector: 2 }).should.equal(2);
    takeFrom(1, { rate: 10, minPerCollector: 5 }).should.equal(1);
    takeFrom(7, { rate: 100, minPerCollector: 0 }).should.equal(7);
    takeFrom(0, { rate: 50, minPerCollector: 3 }).should.equal(0);
    takeFrom(5, { rate: 1, minPerCollector: 0 }).should.equal(1);
  });

  it('draws per collector, reproducibly and independently of input order', () => {
    const eligible = [...subs(7, 20), ...subs(3, 2), ...subs(null, 5, 'web')];
    const settings = { rate: 10, minPerCollector: 1 };
    const a = draw(eligible, settings, seed);
    a.counts.should.eql([
      { submitterId: 3, eligible: 2, sampled: 1 },
      { submitterId: 7, eligible: 20, sampled: 2 },
      { submitterId: null, eligible: 5, sampled: 1 }
    ]);
    a.chosen.length.should.equal(4);
    // Each stratum's picks are its lowest draw keys.
    const lowest = (members, k) => members.map((m) => [drawKey(seed, m.instanceId), m.instanceId]).sort()
      .slice(0, k).map(([, id]) => id);
    a.chosen.filter((c) => c.submitterId === 7).map((c) => c.instanceId).should.eql(lowest(subs(7, 20), 2));
    a.chosen.filter((c) => c.submitterId === 7).map((c) => c.rank).should.eql([1, 2]);
    // Same seed, shuffled input: same sample.
    draw([...eligible].reverse(), settings, seed).should.eql(a);
    // Another seed: generally another sample.
    draw(eligible, settings, 'f'.repeat(32)).chosen.should.not.eql(a.chosen);
    draw([], settings, seed).should.eql({ chosen: [], counts: [] });
  });

  it('validates settings', () => {
    validateSettings({ requestId: 'x', rate: 10 }).settings.should.eql({ rate: 10, minPerCollector: 1, receivedFrom: null, receivedTo: null });
    validateSettings({ rate: 100, minPerCollector: 0, receivedFrom: '2026-09-01', receivedTo: '2026-09-01' }).settings
      .should.containEql({ receivedFrom: '2026-09-01', receivedTo: '2026-09-01' });
    const fieldOf = (body) => validateSettings(body).error?.field;
    fieldOf(null).should.equal('body');
    fieldOf([]).should.equal('body');
    fieldOf({ rate: 10, extra: 1 }).should.equal('extra');
    fieldOf({}).should.equal('rate');
    fieldOf({ rate: 0 }).should.equal('rate');
    fieldOf({ rate: 101 }).should.equal('rate');
    fieldOf({ rate: 2.5 }).should.equal('rate');
    fieldOf({ rate: '10' }).should.equal('rate');
    fieldOf({ rate: 10, minPerCollector: -1 }).should.equal('minPerCollector');
    fieldOf({ rate: 10, minPerCollector: LIMITS.maxMinimum + 1 }).should.equal('minPerCollector');
    fieldOf({ rate: 10, receivedFrom: '2026-02-30' }).should.equal('receivedFrom');
    fieldOf({ rate: 10, receivedTo: '2026-9-1' }).should.equal('receivedTo');
    fieldOf({ rate: 10, receivedFrom: '2026-09-02', receivedTo: '2026-09-01' }).should.equal('receivedTo');
  });
});
