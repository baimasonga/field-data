const should = require('should');
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

  describe('O6 schedules', () => {
    const { boundaryAtOrBefore, nextBoundaryAfter, dueRun, runRequestId, validateSchedule } = require('../../../lib/util/backcheck-sample');
    const t = (s) => new Date(s);

    it('finds UTC day and Monday week boundaries', () => {
      boundaryAtOrBefore(t('2026-10-11T17:30:00Z'), 'daily').toISOString().should.equal('2026-10-11T00:00:00.000Z');
      // 11 October 2026 is a Sunday; its week began on Monday the 5th.
      boundaryAtOrBefore(t('2026-10-11T17:30:00Z'), 'weekly').toISOString().should.equal('2026-10-05T00:00:00.000Z');
      boundaryAtOrBefore(t('2026-10-12T00:00:00Z'), 'weekly').toISOString().should.equal('2026-10-12T00:00:00.000Z');
      nextBoundaryAfter(t('2026-10-12T00:00:00Z'), 'daily').toISOString().should.equal('2026-10-13T00:00:00.000Z');
      nextBoundaryAfter(t('2026-12-31T23:59:59Z'), 'weekly').toISOString().should.equal('2027-01-04T00:00:00.000Z');
    });

    it('is due only once a period has ended, covering every period missed', () => {
      should.not.exist(dueRun({ periodStart: '2026-10-11T10:00:00Z', frequency: 'daily' }, t('2026-10-11T23:59:59Z')));
      const one = dueRun({ periodStart: '2026-10-11T10:00:00Z', frequency: 'daily' }, t('2026-10-12T00:05:00Z'));
      [one.periodStart.toISOString(), one.periodEnd.toISOString(), one.periods].should.eql(['2026-10-11T10:00:00.000Z', '2026-10-12T00:00:00.000Z', 1]);
      dueRun({ periodStart: '2026-10-08T10:00:00Z', frequency: 'daily' }, t('2026-10-11T00:05:00Z')).periods.should.equal(3);
      const week = dueRun({ periodStart: '2026-10-07T09:00:00Z', frequency: 'weekly' }, t('2026-10-20T01:00:00Z'));
      [week.periodEnd.toISOString(), week.periods].should.eql(['2026-10-19T00:00:00.000Z', 2]);
    });

    it('makes one request ID per schedule and period', () => {
      const id = runRequestId('a', '2026-10-12T00:00:00Z');
      id.should.match(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      runRequestId('a', new Date('2026-10-12T00:00:00Z')).should.equal(id);
      runRequestId('a', '2026-10-13T00:00:00Z').should.not.equal(id);
      runRequestId('b', '2026-10-12T00:00:00Z').should.not.equal(id);
    });

    it('checks schedule settings', () => {
      validateSchedule({ rate: 10, frequency: 'weekly', enabled: false }).should.eql({ schedule: { rate: 10, minPerCollector: 1, frequency: 'weekly', enabled: false } });
      validateSchedule({ rate: 10, minPerCollector: 0, frequency: 'daily', enabled: true }).schedule.minPerCollector.should.equal(0);
      for (const [body, field] of [[null, 'body'], [[], 'body'], [{ rate: 10, frequency: 'daily', enabled: true, x: 1 }, 'x'],
        [{ rate: 101, frequency: 'daily', enabled: true }, 'rate'], [{ rate: 10, minPerCollector: 1.5, frequency: 'daily', enabled: true }, 'minPerCollector'],
        [{ rate: 10, frequency: 'monthly', enabled: true }, 'frequency'], [{ rate: 10, frequency: 'daily' }, 'enabled']])
        validateSchedule(body).error.field.should.equal(field);
    });
  });
});
