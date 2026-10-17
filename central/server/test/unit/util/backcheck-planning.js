require('should');
const { validDate, validateCalendar, quotaOn, slotFor, slotOnDate, chooseDated, shiftOn } = require('../../../lib/util/backcheck-calendar');
const { distanceKm, itinerary, orderedItinerary } = require('../../../lib/util/backcheck-route');
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
    const ordered = orderedItinerary(start, visits);
    ordered.stops.map(s => s.id).should.eql(['b', 'a']);
    ordered.stops.map(s => s.order).should.eql([1, 2]);
    ordered.distanceKm.should.be.approximately(438, 2);
    itinerary(start, []).should.eql({ stops: [], distanceKm: 0, returnKm: 0 });
    distanceKm({ latitude: 0, longitude: 179 }, { latitude: 0, longitude: -179 }).should.be.approximately(222.4, 0.1);
    distanceKm(start, start).should.equal(0);
    itinerary(start, [{ id: 'b', location: start }, { id: 'a', location: start }]).stops.map(s => s.id).should.eql(['a', 'b']);
  });
  it('validates optional UTC shifts, visit duration and dated window overrides', () => {
    const body = { weeklyCapacity: [2, 2, 2, 2, 2, 2, 2], weeklyShifts: Array(7).fill({ start: '08:00', end: '17:00' }), visitMinutes: 45,
      exceptions: [{ date: '2026-10-14', maxVisits: 2, shift: { start: '10:00', end: '11:30' } }] };
    const calendar = validateCalendar(body);
    shiftOn(calendar, '2026-10-14').should.eql({ start: '10:00', end: '11:30', startAt: '2026-10-14T10:00:00.000Z', endAt: '2026-10-14T11:30:00.000Z', minutes: 90 });
    for (const bad of [{ ...body, visitMinutes: 0 }, { ...body, visitMinutes: 481 }, { ...body, weeklyShifts: [] },
      { ...body, weeklyShifts: Array(7).fill({ start: '22:00', end: '06:00' }) }, { ...body, weeklyShifts: Array(7).fill({ start: '25:00', end: '26:00' }) },
      { ...body, weeklyShifts: undefined }, { ...body, exceptions: [{ date: '2026-10-14', maxVisits: 2, shift: { start: '08:00', end: '08:00' } }] }])
      (validateCalendar(bad) == null).should.be.true();
    (shiftOn({ weeklyCapacity: body.weeklyCapacity, exceptions: [] }, '2026-10-14') === undefined).should.be.true();
  });
  it('skips ended and closed shifts and bounds minimum visit time by the actual due instant', () => {
    const calendar = { weeklyCapacity: [10, 10, 10, 10, 10, 10, 10], weeklyShifts: Array(7).fill({ start: '08:00', end: '10:00' }), visitMinutes: 30, exceptions: [] };
    const now = new Date('2026-10-14T09:15:00Z');
    slotFor(1, calendar, new Map(), now, new Date('2026-10-14T10:00:00Z')).should.equal('2026-10-14');
    (slotFor(1, calendar, new Map([['1|2026-10-14', 1]]), now, new Date('2026-10-14T10:00:00Z')) == null).should.be.true();
    slotFor(1, calendar, new Map(), new Date('2026-10-14T12:00:00Z'), new Date('2026-10-16T12:00:00Z')).should.equal('2026-10-15');
    calendar.exceptions = [{ date: '2026-10-15', maxVisits: 10, shift: null }];
    slotFor(1, calendar, new Map(), new Date('2026-10-14T12:00:00Z'), new Date('2026-10-16T12:00:00Z')).should.equal('2026-10-16');
    (slotFor(1, calendar, new Map(), new Date('2026-10-14T12:00:00Z'), new Date('2026-10-16T08:20:00Z')) == null).should.be.true();
  });

  it('requires explicit overnight intent, bounds duration and rejects adjacent overlaps across the week', () => {
    const night = { start: '22:00', end: '06:00', endNextDay: true };
    const body = { weeklyCapacity: Array(7).fill(2), weeklyShifts: Array(7).fill(night), exceptions: [] };
    validateCalendar(body).should.eql(body);
    for (const shift of [{ ...night, endNextDay: 'true' }, { ...night, end: '22:00' }, { ...night, end: '23:00' }, { ...night, endNextDay: false }])
      (validateCalendar({ ...body, weeklyShifts: Array(7).fill(shift) }) == null).should.be.true();
    // Saturday's tail must not overlap Sunday's window.
    (validateCalendar({ ...body, weeklyShifts: [{ start: '05:00', end: '08:00' }, ...Array(6).fill(night)] }) == null).should.be.true();
    validateCalendar({ ...body, weeklyShifts: [{ start: '06:00', end: '08:00' }, ...Array(6).fill(night)] }).should.be.an.Object();
    for (const shift of [{ start: '05:00', end: '08:00' }, { start: '23:00', end: '23:30', endNextDay: true }])
      (validateCalendar({ ...body, exceptions: [{ date: '2026-10-14', maxVisits: 2, shift }] }) == null).should.be.true();
    (validateCalendar({ ...body, exceptions: [{ date: '2026-10-14', maxVisits: 2, shift: { start: '23:00', end: '23:30' } },
      { date: '2026-10-13', maxVisits: 2, shift: { start: '23:00', end: '23:15', endNextDay: true } }] }) == null).should.be.true();
  });
  it('anchors overnight windows and exceptions on the start date across year and leap boundaries', () => {
    const calendar = { weeklyCapacity: Array(7).fill(2), weeklyShifts: Array(7).fill({ start: '22:00', end: '06:00', endNextDay: true }),
      exceptions: [{ date: '2027-01-01', maxVisits: 0, shift: null }] };
    shiftOn(calendar, '2026-12-31').endAt.should.equal('2027-01-01T06:00:00.000Z');
    shiftOn(calendar, '2028-02-29').endAt.should.equal('2028-03-01T06:00:00.000Z');
    shiftOn(calendar, '2026-12-31').minutes.should.equal(480);
    slotFor(1, calendar, new Map(), new Date('2027-01-01T01:00:00Z'), new Date('2027-01-01T06:00:00Z')).should.equal('2026-12-31');
    (shiftOn(calendar, '2027-01-01') == null).should.be.true();
  });
  it('reserves the ongoing previous night with shared quota, remaining time and exact deadline bounds', () => {
    const calendar = { weeklyCapacity: Array(7).fill(2), weeklyShifts: Array(7).fill({ start: '22:00', end: '06:00', endNextDay: true }), visitMinutes: 30, exceptions: [] };
    const now = new Date('2026-10-15T05:00:00Z'); const due = new Date('2026-10-16T06:00:00Z');
    slotFor(1, calendar, new Map(), now, due).should.equal('2026-10-14');
    slotOnDate(1, calendar, new Map([['1|2026-10-14', 1]]), '2026-10-14', now, due).should.equal('2026-10-14');
    slotFor(1, calendar, new Map([['1|2026-10-14', 2]]), now, due).should.equal('2026-10-15');
    (slotOnDate(1, calendar, new Map(), '2026-10-14', now, new Date('2026-10-15T05:29:59Z')) == null).should.be.true();
    slotOnDate(1, calendar, new Map(), '2026-10-14', now, new Date('2026-10-15T05:30:00Z')).should.equal('2026-10-14');
    for (const date of ['2026-10-13', '2027-01-14'])
      (slotOnDate(1, calendar, new Map(), date, now, due) == null).should.be.true();
    (slotOnDate(1, calendar, new Map(), '2026-10-14', new Date('2026-10-15T06:00:00Z'), due) == null).should.be.true();
    calendar.exceptions = [{ date: '2026-10-14', maxVisits: 2, shift: null }];
    slotFor(1, calendar, new Map(), now, due).should.equal('2026-10-15');
  });

});
