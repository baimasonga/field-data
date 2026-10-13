require('should');
const { validDate, validateCalendar, quotaOn, slotFor, chooseDated } = require('../../../lib/util/backcheck-calendar');
const { distanceKm, itinerary } = require('../../../lib/util/backcheck-route');
describe('(util) calendar and route planning', () => {
  it('validates weekly quotas, real dates and unique bounded exceptions', () => {
    validDate('2028-02-29').should.be.true(); validDate('2026-02-29').should.be.false();
    const valid = { weeklyCapacity: [0, 1, 2, 3, 4, 5, 6], exceptions: [{ date: '2026-10-14', maxVisits: 0 }] };
    quotaOn(validateCalendar(valid), '2026-10-14').should.equal(0);
    quotaOn(validateCalendar(valid), '2026-10-15').should.equal(4);
    for (const body of [null, [], { ...valid, extra: 1 }, { weeklyCapacity: [1] }, { ...valid, weeklyCapacity: [0, 1, 2, -1, 4, 5, 6] },
      { ...valid, exceptions: [{ date: '2026-02-30', maxVisits: 0 }] }, { ...valid, exceptions: [...valid.exceptions, ...valid.exceptions] },
      { ...valid, exceptions: [{ date: '2026-10-14', maxVisits: 101 }] }, { ...valid, exceptions: Array(367).fill(valid.exceptions[0]) }])
      (validateCalendar(body) == null).should.be.true();
  });
  it('finds the first free UTC date within the due interval and never assumes a missing calendar', () => {
    const now = new Date('2026-10-14T23:59:00Z'); const due = new Date('2026-10-16T23:59:00Z');
    const calendar = { weeklyCapacity: [1, 1, 1, 1, 1, 1, 1], exceptions: [] };
    const used = new Map([['1|2026-10-14', 1], ['1|2026-10-15', 1]]);
    slotFor(1, calendar, used, now, due).should.equal('2026-10-16');
    (slotFor(1, null, used, now, due) == null).should.be.true();
    (slotFor(1, calendar, used, now, new Date('2026-10-15')) == null).should.be.true();
  });
  it('ranks earliest feasible date then pending load, respecting independence and pending capacity', () => {
    const candidates = [{ id: 1, original: true, pending: 0 }, { id: 2, original: false, pending: 1, overdue: 0, linkedRecently: 0, name: 'B' },
      { id: 3, original: false, pending: 0, overdue: 0, linkedRecently: 0, name: 'C' }];
    const calendars = new Map([[1, { weeklyCapacity: [9, 9, 9, 9, 9, 9, 9], exceptions: [] }],
      [2, { weeklyCapacity: [1, 1, 1, 1, 1, 1, 1], exceptions: [] }], [3, { weeklyCapacity: [0, 0, 0, 0, 1, 0, 0], exceptions: [] }]]);
    const settings = { maxPending: 2, collectorLimits: [] }; const now = new Date('2026-10-14'); const due = new Date('2026-10-16');
    chooseDated(candidates, settings, calendars, new Map(), now, due).id.should.equal(2);
    chooseDated(candidates, { ...settings, collectorLimits: [{ actorId: 2, maxPending: 0 }] }, calendars, new Map(), now, due).id.should.equal(3);
  });
  it('orders stops deterministically and measures a return trip without inventing road distance', () => {
    const start = { latitude: 10, longitude: 10 };
    const visits = [{ id: 'b', location: { latitude: 10, longitude: 12 } }, { id: 'a', location: { latitude: 10, longitude: 11 } }];
    const plan = itinerary(start, visits);
    plan.stops.map(s => s.id).should.eql(['a', 'b']);
    plan.distanceKm.should.be.approximately(438, 2);
    itinerary(start, [...visits].reverse()).should.eql(plan);
    itinerary(start, []).should.eql({ stops: [], distanceKm: 0, returnKm: 0 });
    distanceKm({ latitude: 0, longitude: 179 }, { latitude: 0, longitude: -179 }).should.be.approximately(222.4, 0.1);
    distanceKm(start, start).should.equal(0);
    itinerary(start, [{ id: 'b', location: start }, { id: 'a', location: start }]).stops.map(s => s.id).should.eql(['a', 'b']);
  });
});
