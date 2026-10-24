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

  it('draws each collector and answer intersection reproducibly, keeping missing answers distinct', () => {
    const eligible = [1, 2].flatMap(submitterId => ['North', 'South', null].flatMap(groupValue =>
      Array.from({ length: 3 }, (_, i) => ({ instanceId: `${submitterId}-${groupValue}-${i}`, submitterId, groupValue }))));
    const settings = { rate: 10, minPerCollector: 1, groupField: '/district' };
    const result = draw(eligible, settings, seed);
    result.chosen.length.should.equal(6); result.counts.length.should.equal(6);
    result.counts.forEach(group => group.should.containEql({ eligible: 3, sampled: 1 }));
    draw([...eligible].reverse(), settings, seed).should.eql(result);
    result.chosen.filter(c => c.groupValue === null).length.should.equal(2);
    validateSettings({ rate: 10, groupField: '/location/district' }).settings.groupField.should.equal('/location/district');
    for (const groupField of [null, 1, '', 'district', '/a[1]', '/a/../b', '/a"', '/'.repeat(501)])
      validateSettings({ rate: 10, groupField }).error.field.should.equal('groupField');
  });

  it('uses canonical group rates, fallback and minimums reproducibly', () => {
    const eligible = [1, 2].flatMap(submitterId => ['North', 'South', null, 'null'].flatMap(groupValue =>
      Array.from({ length: 5 }, (_, i) => ({ instanceId: `${submitterId}-${groupValue === null ? 'missing' : groupValue}-${i}`, submitterId, groupValue }))));
    const { settings } = validateSettings({ rate: 20, minPerCollector: 2, groupField: '/district',
      groupRates: [{ value: null, rate: 60 }, { value: ' North ', rate: 100 }] });
    const result = draw(eligible, settings, seed);
    result.counts.map(c => c.sampled).should.eql([5, 2, 2, 3, 5, 2, 2, 3]);
    draw([...eligible].reverse(), settings, seed).should.eql(result);
    validateSettings({ ...settings, groupRates: [...settings.groupRates].reverse() }).settings.should.eql(settings);
    validateSettings({ rate: 20, groupRates: [] }).settings.should.not.have.property('groupRates');
    for (const groupRates of [null, {}, [{ value: 'North', rate: 0 }], [{ value: 'North', rate: 101 }],
      [{ value: 'North', rate: 1.5 }], [{ value: '', rate: 10 }], [{ rate: 10 }], [{ value: 1, rate: 10 }],
      [{ value: 'a'.repeat(201), rate: 10 }], [{ value: 'é', rate: 10 }, { value: ' é ', rate: 20 }],
      [{ value: null, rate: 10 }, { value: null, rate: 20 }], [{ value: 'a', rate: 10, extra: true }],
      Array.from({ length: 101 }, (_, i) => ({ value: String(i), rate: 10 }))])
      validateSettings({ rate: 20, groupField: '/district', groupRates }).error.field.should.equal('groupRates');
    validateSettings({ rate: 20, groupRates: [{ value: null, rate: 10 }] }).error.field.should.equal('groupRates');
    const { validateSchedule } = require('../../../lib/util/backcheck-sample');
    validateSchedule({ rate: 20, frequency: 'daily', enabled: true, groupField: '/district', groupRates: settings.groupRates }).schedule.groupRates.should.eql(settings.groupRates);
  });

  it('compares decimal boundaries exactly, including negatives, long fractions and large integers', () => {
    const { canonicalDecimal, compareDecimal, numericGroup } = require('../../../lib/util/backcheck-sample');
    canonicalDecimal('+00018.000').should.equal('18'); canonicalDecimal('-0.000').should.equal('0');
    canonicalDecimal('-.2500').should.equal('-0.25');
    compareDecimal('9007199254740993', '9007199254740992').should.equal(1);
    compareDecimal('17.9999999999999999999999', '18').should.equal(-1);
    compareDecimal('-0.00001', '0').should.equal(-1);
    compareDecimal('-20.01', '-20.001').should.equal(-1);
    const breaks = ['-0.5', '18', '35'];
    ['-1', '-0.5', '17.999999999999999999', '18', '34.999999999999999999', '35', '999'].map(value => numericGroup(value, breaks).value)
      .should.eql(['Below -0.5', '-0.5 to below 18', '-0.5 to below 18', '18 to below 35', '18 to below 35', '35 or above', '35 or above']);
    should.equal(numericGroup(null, breaks).value, null);
    for (const value of ['', '1e3', 'NaN', 'Infinity', '0x10', '1,000', '1 2']) numericGroup(value, breaks).should.have.property('error');
  });

  it('validates canonical increasing numeric boundaries and matching rate rules', () => {
    const body = { rate: 10, groupField: '/age', groupBreaks: [' +0018.00 ', '35.0'], groupRates: [{ value: 'Below 18', rate: 100 }] };
    validateSettings(body).settings.groupBreaks.should.eql(['18', '35']);
    validateSettings({ rate: 10, groupField: '/age', groupBreaks: Array.from({ length: 98 }, (_, i) => String(i)) }).settings.groupBreaks.length.should.equal(98);
    validateSettings({ rate: 10, groupBreaks: [] }).settings.should.not.have.property('groupBreaks');
    for (const groupBreaks of [null, {}, [18], [''], ['1e3'], ['NaN'], ['1,000'], ['2', '1'], ['1', '1.0'], ['a'.repeat(65)], ['.' + '1'.repeat(63)], Array.from({ length: 99 }, (_, i) => String(i))])
      validateSettings({ ...body, groupBreaks }).error.field.should.equal('groupBreaks');
    validateSettings({ rate: 10, groupBreaks: ['18'] }).error.field.should.equal('groupBreaks');
    validateSettings({ ...body, groupRates: [{ value: '18', rate: 50 }] }).error.field.should.equal('groupRates');
    const { validateSchedule } = require('../../../lib/util/backcheck-sample');
    validateSchedule({ ...body, frequency: 'daily', enabled: true }).schedule.groupBreaks.should.eql(['18', '35']);
  });

  it('offers only non-repeating scalar questions outside metadata', () => {
    const { groupFields } = require('../../../lib/util/backcheck-sample');
    groupFields([{ path: '/district', type: 'string' }, { path: '/age', type: 'int' },
      { path: '/photo', type: 'binary', binary: true }, { path: '/point', type: 'geopoint' },
      { path: '/many', type: 'string', selectMultiple: true }, { path: '/meta/instanceID', type: 'string' },
      { path: '/household', type: 'repeat' }, { path: '/household/name', type: 'string' }]).map(f => f.path).should.eql(['/district', '/age']);
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
      validateSchedule({ rate: 10, frequency: 'daily', enabled: true, groupField: '/district' }).schedule.groupField.should.equal('/district');
      validateSchedule({ rate: 10, frequency: 'daily', enabled: true, groupField: null }).schedule.should.not.have.property('groupField');
      validateSchedule({ rate: 10, frequency: 'daily', enabled: true, groupField: '/x[1]' }).error.field.should.equal('groupField');
      for (const [body, field] of [[null, 'body'], [[], 'body'], [{ rate: 10, frequency: 'daily', enabled: true, x: 1 }, 'x'],
        [{ rate: 101, frequency: 'daily', enabled: true }, 'rate'], [{ rate: 10, minPerCollector: 1.5, frequency: 'daily', enabled: true }, 'minPerCollector'],
        [{ rate: 10, frequency: 'monthly', enabled: true }, 'frequency'], [{ rate: 10, frequency: 'daily' }, 'enabled']])
        validateSchedule(body).error.field.should.equal(field);
    });
  });
});
