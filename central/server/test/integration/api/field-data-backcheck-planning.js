require('should');
const assert = require('node:assert/strict');
const FakeTimers = require('@sinonjs/fake-timers');
const { sql } = require('slonik');
const { generateKeyPairSync } = require('node:crypto');
const { testService, testServiceFullTrx } = require('../setup');
const testData = require('../../data/xml');
const { generateReverification } = require('../../../lib/worker/field-data-reverification');
const { runAllocations } = require('../../../lib/worker/field-data-backcheck-allocation');
/* eslint-disable no-await-in-loop */
// Keep fixture dates inside the database-clock itinerary window; fake JS clocks
// do not change PostgreSQL clock_timestamp(). Anchor to the most recent Wednesday
// to preserve weekday quotas and within-day boundaries while staying within 7 days.
const currentUtcDay = new Date();
const fixtureMidnight = Date.parse(`${currentUtcDay.toISOString().slice(0, 10)}T00:00:00Z`) - ((currentUtcDay.getUTCDay() + 4) % 7) * 86400000;
const fixtureDate = offset => new Date(fixtureMidnight + offset * 86400000).toISOString().slice(0, 10);
const root = '/v1/projects/1';
const geoForm = `<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml"><h:head><h:title>Route survey</h:title><model>
<instance><data id="route_survey"><meta><instanceID/></meta><location/></data></instance>
<bind nodeset="/data/meta/instanceID" type="string" readonly="true()" calculate="concat('uuid:', uuid())"/>
<bind nodeset="/data/location" type="geopoint"/></model></h:head><h:body><input ref="/data/location"><label>Location</label></input></h:body></h:html>`;
const setup = async (service, geo = false, count = 3, accuracy = '15') => {
  const alice = await service.login('alice'); const users = [];
  const form = geo ? 'route_survey' : 'simple';
  if (geo) await alice.post(`${root}/forms?publish=true`).send(geoForm).set('Content-Type', 'application/xml').expect(200);
  for (const name of ['Original', 'Checker B', 'Checker C']) {
    const user = (await alice.post(`${root}/app-users`).send({ displayName: name }).expect(200)).body;
    await alice.post(`${root}/forms/simple/assignments/app-user/${user.id}`).expect(200); users.push(user);
  }
  if (geo) await alice.post(`${root}/forms/${form}/assignments/app-user/${users[0].id}`).expect(200);
  for (let n = 0; n < count; n += 1) {
    const xml = geo ? `<data id="route_survey"><meta><instanceID>visit${n}</instanceID></meta><location>${8.48 + n * 0.01} -13.23 0 ${accuracy}</location></data>`
      : testData.instances.simple.one.replace('one</instanceID>', `visit${n}</instanceID>`);
    await service.post(`/v1/key/${users[0].token}/projects/1/forms/${form}/submissions`).send(xml).set('Content-Type', 'application/xml').expect(200);
  }
  await alice.post(`${root}/forms/${form}/backcheck-samples`).send({ requestId: '11111111-1111-4111-8111-111111111111', rate: 100 }).expect(201);
  await alice.put(`${root}/forms/${form}/backcheck-allocation`).send({ enabled: true, responseXmlFormId: 'simple', question: 'Verify the visit.',
    dueDays: 2, maxPending: 100, collectorLimits: [], respectCalendar: true }).expect(200);
  return { alice, users, form };
};
const calendar = (alice, user, weeklyCapacity, exceptions = []) => alice.put(`${root}/backcheck-calendars/${user.id}`).send({ weeklyCapacity, exceptions }).expect(200);
const checks = c => c.all(sql`SELECT *, to_char("plannedVisitDate", 'YYYY-MM-DD') AS date FROM field_data_backchecks ORDER BY "createdAt", id`);
const now = new Date(`${fixtureDate(0)}T12:00:00Z`);
const route = (alice, user) => alice.get(`${root}/backcheck-route?actorId=${user.id}&date=${fixtureDate(0)}&startLat=8.48&startLon=-13.23`).expect(200);
describe('api: calendar availability and route planning', () => {
  it('reserves dated capacity with exceptions, includes dates in the inbox, and does not reuse completed slots', testService(async (service, c) => {
    const { alice, users } = await setup(service);
    await runAllocations(c.db, now);
    assert.equal((await checks(c)).length, 0);
    assert.equal((await alice.get(`${root}/forms/simple/backcheck-allocation`).expect(200)).body.policy.report.noCalendarSlot, 3);
    await calendar(alice, users[2], [0, 0, 0, 0, 1, 0, 0]);
    await runAllocations(c.db, now);
    assert.equal((await checks(c)).length, 1);
    await calendar(alice, users[1], [1, 1, 1, 1, 1, 1, 1], [{ date: fixtureDate(0), maxVisits: 0 }]);
    await runAllocations(c.db, now);
    const rows = await checks(c);
    assert.deepEqual(rows.map(r => r.date).sort(), [fixtureDate(1), fixtureDate(1), fixtureDate(2)]);
    const inbox = (await service.get('/v1/field-data/app-user/backchecks').set('Authorization', `Bearer ${users[1].token}`).expect(200)).body;
    assert.deepEqual(inbox.items.map(i => i.plannedVisitDate).sort(), [fixtureDate(1), fixtureDate(2)]);
    const linked = rows.find(r => r.assignedTo === users[2].id);
    await service.post(`/v1/key/${users[2].token}/projects/1/forms/simple/submissions`).send(testData.instances.simple.one.replace('one</instanceID>', 'response</instanceID>'))
      .set('Content-Type', 'application/xml').expect(200);
    const detail = await alice.get(`/v1/field-data/review-queue/${linked.caseId}`).expect(200);
    await alice.post(`/v1/field-data/review-queue/${linked.caseId}/backchecks/${linked.id}/link`).set('If-Match', detail.headers.etag).send({ instanceId: 'response' }).expect(200);
    await alice.post(`${root}/forms/simple/submissions`).send(testData.instances.simple.one.replace('one</instanceID>', 'later</instanceID>')).set('Content-Type', 'application/xml').expect(200);
    await alice.post(`${root}/forms/simple/backcheck-samples`).send({ requestId: '22222222-2222-4222-8222-222222222222', rate: 100 }).expect(201);
    await runAllocations(c.db, now);
    // The linked response itself can also be sampled, but all calendar slots are full.
    assert.equal((await checks(c)).length, 3);
    const cancelled = rows.find(r => r.date === fixtureDate(2));
    const item = await alice.get(`/v1/field-data/review-queue/${cancelled.caseId}`).expect(200);
    await alice.post(`/v1/field-data/review-queue/${cancelled.caseId}/backchecks/${cancelled.id}/cancel`).set('If-Match', item.headers.etag)
      .send({ requestId: '33333333-3333-4333-8333-333333333333', reason: 'Visit no longer needed.' }).expect(200);
    await runAllocations(c.db, now);
    assert.equal((await checks(c)).length, 4);
    assert.equal((await checks(c)).at(-1).date, fixtureDate(2));
  }));
  it('serializes calendar-aware allocation without overbooking a day', testServiceFullTrx(async (service, c) => {
    const { alice, users } = await setup(service, false, 4);
    await calendar(alice, users[1], [0, 0, 0, 1, 0, 0, 0]);
    await Promise.all([runAllocations(c.db, now), runAllocations(c.db, now)]);
    assert.equal((await checks(c)).length, 1); assert.equal((await checks(c))[0].date, fixtureDate(0));
  }));
  it('previews verified locations in order and flags changed calendars, missing integrity and revoked eligibility', testService(async (service, c) => {
    const { alice, users } = await setup(service, true, 2);
    await calendar(alice, users[1], [2, 2, 2, 2, 2, 2, 2]);
    await runAllocations(c.db, now);
    const preview = await route(alice, users[1]);
    assert.equal(preview.headers['cache-control'], 'private, no-store');
    assert.equal(preview.body.route.stops.length, 2); assert.equal(preview.body.needsReview, true); assert.equal(preview.body.road.status, 'disabled');
    assert.deepEqual(preview.body.route.stops.map(s => s.instanceId), ['visit0', 'visit1']);
    assert.equal(preview.body.route.stops[0].location.accuracy, 15);
    const { LIMITS } = require('../../../lib/resources/field-data-backcheck-planning');
    const stopLimit = LIMITS.maxStops; const byteLimit = LIMITS.maxSourceBytes;
    try {
      LIMITS.maxStops = 1;
      const partial = (await route(alice, users[1])).body;
      assert.equal(partial.truncated, true); assert.equal(partial.needsReview, true); assert.equal(partial.route.stops.length, 1);
      LIMITS.maxStops = stopLimit; LIMITS.maxSourceBytes = 1;
      const bounded = (await route(alice, users[1])).body;
      assert.equal(bounded.route.stops.length, 0); assert.equal(bounded.excluded.sourceUnverified, 2);
    } finally { LIMITS.maxStops = stopLimit; LIMITS.maxSourceBytes = byteLimit; }

    await calendar(alice, users[1], [0, 0, 0, 0, 0, 0, 0]);
    const over = (await route(alice, users[1])).body;
    assert.equal(over.used, 2); assert.equal(over.capacity, 0); assert.equal(over.needsReview, true);
    await c.run(sql`UPDATE submission_defs sd SET xml = sd.xml || ' ' FROM submissions s WHERE sd."submissionId" = s.id AND s."instanceId" = 'visit0'`);
    assert.equal((await route(alice, users[1])).body.excluded.sourceUnverified, 1);
    await c.run(sql`DELETE FROM assignments WHERE "actorId" = ${users[1].id}`);
    const revoked = (await route(alice, users[1])).body;
    assert.equal(revoked.route.stops.length, 0); assert.equal(revoked.excluded.collectorUnavailable, 2);
  }));
  it('reports missing locations and enforces project, manager and calendar validation boundaries', testService(async (service, c) => {
    const { alice, users } = await setup(service, false, 1);
    const chelsea = await service.login('chelsea'); const { id } = (await chelsea.get('/v1/users/current').expect(200)).body;
    await alice.post(`${root}/assignments/viewer/${id}`).expect(200);
    await chelsea.get(`${root}/backcheck-calendars`).expect(200);
    await chelsea.put(`${root}/backcheck-calendars/${users[1].id}`).send({ weeklyCapacity: [1, 1, 1, 1, 1, 1, 1] }).expect(403);
    await chelsea.get(`${root}/backcheck-route?actorId=${users[1].id}&date=${fixtureDate(0)}&startLat=8&startLon=-13`).expect(403);
    await service.get(`${root}/backcheck-calendars`).set('Authorization', `Bearer ${users[0].token}`).expect(403);
    await alice.put(`${root}/backcheck-calendars/${id}`).send({ weeklyCapacity: [1, 1, 1, 1, 1, 1, 1] }).expect(404);
    for (const body of [{ weeklyCapacity: [1] }, { weeklyCapacity: [1, 1, 1, 1, 1, 1, 1], exceptions: [{ date: '2026-02-30', maxVisits: 0 }] }])
      await alice.put(`${root}/backcheck-calendars/${users[1].id}`).send(body).expect(400);
    await calendar(alice, users[1], [1, 1, 1, 1, 1, 1, 1]); await runAllocations(c.db, now);
    assert.equal((await route(alice, users[1])).body.excluded.missingLocation, 1);
    await alice.get(`${root}/backcheck-route?actorId=${users[1].id}&date=2026-02-30&startLat=8&startLon=-13`).expect(400);
    await alice.get(`${root}/backcheck-route?actorId=${users[1].id}&date=${fixtureDate(0)}&startLat=91&startLon=-13`).expect(400);
  }));
  it('flags unknown GPS accuracy and retains calendars and dated tasks on rollback', testServiceFullTrx(async (service, c) => {
    const { alice, users } = await setup(service, true, 1, '');
    await calendar(alice, users[1], [1, 1, 1, 1, 1, 1, 1]); await runAllocations(c.db, now);
    const preview = (await route(alice, users[1])).body;
    assert.equal(preview.uncertainLocations, 1); assert.equal(preview.needsReview, true);
    assert.equal(preview.route.stops[0].location.accuracy, null);
    const { knexConnect } = require('../../../lib/model/knex-migrator');
    const migration = require('../../../lib/model/migrations/20261013-02-add-backcheck-calendars');
    const db = knexConnect(require('config').get('test.database'));
    try {
      await db.transaction(async trx => { await migration.down(trx); await migration.up(trx); });
      const calendars = (await alice.get(`${root}/backcheck-calendars`).expect(200)).body;
      assert.equal(calendars.find(row => row.id === users[1].id).settings.weeklyCapacity[3], 1);
      assert.equal((await checks(c))[0].date, fixtureDate(0));
    } finally { await db.destroy(); }
  }));

  it('adds road travel and visit-time budgets without exposing task identifiers upstream', testService(async (service, c) => {
    const { alice, users } = await setup(service, true, 1);
    await calendar(alice, users[1], [2, 2, 2, 2, 2, 2, 2]);
    await runAllocations(c.db, now);
    const originalFetch = global.fetch; const originalUrl = process.env.FIELD_DATA_OSRM_URL;
    process.env.FIELD_DATA_OSRM_URL = 'https://routing.example';
    let calls = 0;
    global.fetch = async (url) => {
      calls += 1; assert.equal(url.hostname, 'routing.example');
      assert.equal(url.pathname.includes('visit0'), false);
      return new Response(JSON.stringify({ code: 'Ok', routes: [{ distance: 2000, duration: 3600,
        legs: [{ distance: 1000, duration: 1800 }, { distance: 1000, duration: 1800 }] }],
      waypoints: [{ distance: 0 }, { distance: 150 }, { distance: 0 }] }));
    };
    try {
      const result = (await alice.get(`${root}/backcheck-route?actorId=${users[1].id}&date=${fixtureDate(0)}&startLat=8.48&startLon=-13.23&visitMinutes=30&dayMinutes=60`).expect(200)).body;
      assert.equal(result.road.travelMinutes, 60); assert.equal(result.timing.totalMinutes, 90);
      assert.equal(result.timing.overBudget, true); assert.equal(result.needsReview, true);
      await alice.get(`${root}/backcheck-route?actorId=${users[1].id}&date=${fixtureDate(0)}&startLat=8.48&startLon=-13.23&visitMinutes=0`).expect(400);
      assert.equal(calls, 1);
      global.fetch = async () => { throw new Error('upstream secret'); };
      const unavailable = (await route(alice, users[1])).body;
      assert.deepEqual(unavailable.road, { status: 'unavailable' }); assert.equal(unavailable.timing.totalMinutes, null);
      assert.equal(unavailable.needsReview, true);
    } finally {
      global.fetch = originalFetch;
      if (originalUrl == null) delete process.env.FIELD_DATA_OSRM_URL; else process.env.FIELD_DATA_OSRM_URL = originalUrl;
    }
  }));

  it('persists UTC shifts, bounds automatic dates by minimum visit time and uses saved preview assumptions', testService(async (service, c) => {
    const clock = FakeTimers.install({ now, toFake: ['Date'] });
    try {
      const { alice, users } = await setup(service, true, 3);
      const settings = { weeklyCapacity: [100, 100, 100, 100, 100, 100, 100], visitMinutes: 45,
        weeklyShifts: Array(7).fill({ start: '08:00', end: '08:30' }),
        exceptions: [{ date: fixtureDate(1), maxVisits: 100, shift: { start: '08:00', end: '09:30' } }] };
      await alice.put(`${root}/backcheck-calendars/${users[1].id}`).send(settings).expect(200);
      await runAllocations(c.db, now);
      const rows = await checks(c);
      assert.equal(rows.length, 2); assert.deepEqual(rows.map(r => r.date), [fixtureDate(1), fixtureDate(1)]);
      const { report } = (await alice.get(`${root}/forms/route_survey/backcheck-allocation`).expect(200)).body.policy;
      assert.equal(report.noCalendarSlot, 1);
      // Route budgets use the request clock, not the allocator's explicit time.
      const plan = (await alice.get(`${root}/backcheck-route?actorId=${users[1].id}&date=${fixtureDate(1)}&startLat=8.48&startLon=-13.23`).expect(200)).body;
      assert.equal(plan.timing.visitMinutes, 45); assert.equal(plan.timing.dayMinutes, 90);
      assert.equal(plan.timing.shift.start, '08:00'); assert.equal(plan.timing.shift.end, '09:30');
      assert.equal(plan.timing.previewOverrides, false); assert.equal(plan.timing.totalMinutes, null);
      const invalid = { ...settings, weeklyShifts: Array(7).fill({ start: '09:00', end: '08:00' }) };
      await alice.put(`${root}/backcheck-calendars/${users[1].id}`).send(invalid).expect(400);
      await alice.put(`${root}/backcheck-calendars/${users[1].id}`).send({ ...settings, exceptions: [{ date: fixtureDate(1), maxVisits: 100, shift: null }] }).expect(200);
      const closed = (await alice.get(`${root}/backcheck-route?actorId=${users[1].id}&date=${fixtureDate(1)}&startLat=8.48&startLon=-13.23`).expect(200)).body;
      assert.equal(closed.timing.shiftUnavailable, true); assert.equal(closed.timing.dayMinutes, 0); assert.equal(closed.needsReview, true);
      assert.equal((await checks(c)).length, 2); // Edits never move existing visits.
      const past = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const expired = (await alice.get(`${root}/backcheck-route?actorId=${users[1].id}&date=${past}&startLat=8.48&startLon=-13.23&dayMinutes=1440`).expect(200)).body;
      assert.equal(expired.timing.expiredShift, true); assert.equal(expired.timing.dayMinutes, 0);
      assert.equal(expired.timing.shiftBudgetMinutes, 0); assert.equal(expired.needsReview, true);
    } finally { clock.uninstall(); }
  }));

  it('allocates overnight capacity and preserves approved UTC boundaries online and offline', testService(async (service, c) => {
    const clock = FakeTimers.install({ now: new Date(`${fixtureDate(1)}T01:00:00Z`), toFake: ['Date'] });
    const previousKey = process.env.FIELD_DATA_OFFLINE_SIGNING_KEY; const previousOrigin = process.env.FIELD_DATA_OFFLINE_ORIGIN;
    try {
      const { alice, users } = await setup(service, true, 3);
      const settings = { weeklyCapacity: Array(7).fill(2), visitMinutes: 45,
        weeklyShifts: Array(7).fill({ start: '22:00', end: '06:00', endNextDay: true }), exceptions: [] };
      await alice.put(`${root}/backcheck-calendars/${users[1].id}`).send(settings).expect(200);
      const saved = (await alice.get(`${root}/backcheck-calendars`).expect(200)).body.find(u => u.id === users[1].id);
      assert.deepEqual(saved.settings, settings);
      await alice.put(`${root}/backcheck-calendars/${users[1].id}`).send({ ...settings,
        exceptions: [{ date: fixtureDate(1), maxVisits: 2, shift: { start: '05:00', end: '08:00' } }] }).expect(400);
      await runAllocations(c.db, new Date());
      const rows = await checks(c);
      assert.deepEqual(rows.map(r => r.date).sort(), [fixtureDate(0), fixtureDate(0), fixtureDate(1)]);
      const preview = (await route(alice, users[1])).body;
      assert.equal(preview.timing.dayMinutes, 300); assert.equal(preview.timing.expiredShift, false);
      assert.equal(preview.timing.shift.endNextDay, true);
      assert.equal(preview.timing.shift.startAt, `${fixtureDate(0)}T22:00:00.000Z`);
      assert.equal(preview.timing.shift.endAt, `${fixtureDate(1)}T06:00:00.000Z`);
      await alice.post(`${root}/backcheck-itineraries`).send({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', reviewToken: preview.reviewToken,
        note: 'Finish the following morning.', query: { actorId: String(users[1].id), date: fixtureDate(0), startLat: '8.48', startLon: '-13.23' } }).expect(201);
      const online = (await service.get('/v1/field-data/app-user/itineraries').set('Authorization', `Bearer ${users[1].token}`).expect(200)).body.items[0];
      assert.equal(online.date, fixtureDate(0));
      assert.deepEqual(online.shift, { startAt: `${fixtureDate(0)}T22:00:00.000Z`, endAt: `${fixtureDate(1)}T06:00:00.000Z` });
      process.env.FIELD_DATA_OFFLINE_SIGNING_KEY = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
      process.env.FIELD_DATA_OFFLINE_ORIGIN = 'https://field.example.test';
      const { bundle } = (await service.get('/v1/field-data/app-user/offline-assignments').set('Authorization', `Bearer ${users[1].token}`).expect(200)).body;
      assert.deepEqual(JSON.parse(Buffer.from(bundle.payload, 'base64url')).itineraries.items[0].shift, online.shift);
      clock.setSystemTime(new Date(`${fixtureDate(1)}T06:00:00Z`));
      const expired = (await route(alice, users[1])).body;
      assert.equal(expired.timing.dayMinutes, 0); assert.equal(expired.timing.expiredShift, true);
      assert.deepEqual((await checks(c)).map(r => r.date).sort(), rows.map(r => r.date).sort());
    } finally {
      clock.uninstall();
      if (previousKey == null) delete process.env.FIELD_DATA_OFFLINE_SIGNING_KEY; else process.env.FIELD_DATA_OFFLINE_SIGNING_KEY = previousKey;
      if (previousOrigin == null) delete process.env.FIELD_DATA_OFFLINE_ORIGIN; else process.env.FIELD_DATA_OFFLINE_ORIGIN = previousOrigin;
    }
  }));

  it('uses validated road stop ordering and explicitly falls back when the provider fails', testService(async (service, c) => {
    const { alice, users } = await setup(service, true, 2);
    await calendar(alice, users[1], [2, 2, 2, 2, 2, 2, 2]); await runAllocations(c.db, now);
    const originalFetch = global.fetch; const originalUrl = process.env.FIELD_DATA_OSRM_URL;
    process.env.FIELD_DATA_OSRM_URL = 'https://routing.example';
    let calls = 0;
    global.fetch = async (url) => {
      calls += 1; assert.ok(url.pathname.startsWith('/trip/v1/driving/')); assert.equal(url.pathname.includes('visit'), false);
      return new Response(JSON.stringify({ code: 'Ok', trips: [{ distance: 2000, duration: 1800, legs: Array(3).fill({ distance: 500, duration: 600 }) }],
        waypoints: [{ distance: 0, trips_index: 0, waypoint_index: 0 }, { distance: 0, trips_index: 0, waypoint_index: 2 }, { distance: 0, trips_index: 0, waypoint_index: 1 }] }));
    };
    const url = `${root}/backcheck-route?actorId=${users[1].id}&date=${fixtureDate(0)}&startLat=8.48&startLon=-13.23&order=road`;
    try {
      const result = (await alice.get(url).expect(200)).body;
      assert.equal(result.ordering.applied, 'road'); assert.deepEqual(result.route.stops.map(s => s.instanceId), ['visit1', 'visit0']);
      assert.deepEqual(result.route.stops.map(s => s.order), [1, 2]); assert.equal(result.road.legs.length, 3);
      assert.equal(result.timing.totalMinutes, 90);
      await alice.get(url.replace('order=road', 'order=invalid')).expect(400); assert.equal(calls, 1);
      global.fetch = async () => { throw new Error('private upstream failure'); };
      const fallback = (await alice.get(url).expect(200)).body;
      assert.equal(fallback.ordering.applied, 'straight'); assert.equal(fallback.ordering.status, 'unavailable');
      assert.deepEqual(fallback.route.stops.map(s => s.instanceId), ['visit0', 'visit1']);
      assert.equal(fallback.timing.totalMinutes, null); assert.equal(fallback.needsReview, true);
    } finally {
      global.fetch = originalFetch;
      if (originalUrl == null) delete process.env.FIELD_DATA_OSRM_URL; else process.env.FIELD_DATA_OSRM_URL = originalUrl;
    }
  }));

  it('approves an immutable itinerary, scopes it to its collector and withholds cancelled work', testService(async (service, c) => {
    const { alice, users } = await setup(service, true, 2);
    await calendar(alice, users[1], [2, 2, 2, 2, 2, 2, 2]); await runAllocations(c.db, now);
    const preview = (await route(alice, users[1])).body;
    const body = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', reviewToken: preview.reviewToken, note: 'Review access with the supervisor.',
      query: { actorId: String(users[1].id), date: fixtureDate(0), startLat: '8.48', startLon: '-13.23' } };
    await alice.post(`${root}/backcheck-itineraries`).send({ ...body, reviewToken: '0'.repeat(64) }).expect(400);
    await alice.post(`${root}/backcheck-itineraries`).send(body).expect(201);
    await alice.post(`${root}/backcheck-itineraries`).send(body).expect(201);
    await alice.post(`${root}/backcheck-itineraries`).send({ ...body, note: 'Changed' }).expect(400);
    await alice.post(`${root}/backcheck-itineraries`).send({ ...body, query: { ...body.query, startLat: '9' } }).expect(400);
    assert.equal(await c.oneFirst(sql`SELECT count(*)::integer FROM field_data_backcheck_itineraries`), 1);
    assert.equal(await c.oneFirst(sql`SELECT count(*)::integer FROM audits WHERE action = 'field_data.backcheck.itinerary.approve'`), 1);
    const get = user => service.get('/v1/field-data/app-user/itineraries').set('Authorization', `Bearer ${user.token}`).expect(200);
    assert.equal((await get(users[2])).body.items.length, 0);
    const received = (await get(users[1])).body.items[0];
    const navigationPath = stop => `/v1/field-data/app-user/itineraries/${received.id}/stops/${stop.kind}/${stop.id}/navigation`;
    const navigate = (stop, user = users[1]) => service.get(navigationPath(stop)).set('Authorization', `Bearer ${user.token}`);
    const navigation = await navigate(received.stops[0]).expect(200);
    assert.equal(navigation.headers['cache-control'], 'private, no-store');
    assert.equal(navigation.body.stopId, received.stops[0].id);
    assert.equal(new URL(navigation.body.targets[0].url).searchParams.get('destination'), `${received.stops[0].location.latitude},${received.stops[0].location.longitude}`);
    assert.equal(JSON.stringify(navigation.body).includes(users[1].token), false);
    assert.equal(Date.parse(navigation.body.expiresAt) - Date.parse(navigation.body.checkedAt), 60000);
    await navigate(received.stops[0], users[2]).expect(404);
    await service.get(navigationPath(received.stops[0])).expect(401);
    await alice.get(navigationPath(received.stops[0])).expect(403);
    await service.get(`/v1/field-data/app-user/itineraries/bad/stops/backcheck/${received.stops[0].id}/navigation`).set('Authorization', `Bearer ${users[1].token}`).expect(404);
    const previousKey = process.env.FIELD_DATA_OFFLINE_SIGNING_KEY; const previousOrigin = process.env.FIELD_DATA_OFFLINE_ORIGIN;
    try {
      process.env.FIELD_DATA_OFFLINE_SIGNING_KEY = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
      process.env.FIELD_DATA_OFFLINE_ORIGIN = 'https://field.example.test';
      const { bundle } = (await service.get('/v1/field-data/app-user/offline-assignments').set('Authorization', `Bearer ${users[1].token}`).expect(200)).body;
      const issued = JSON.parse(Buffer.from(bundle.payload, 'base64url'));
      assert.equal(issued.schemaVersion, 'offline-assignments@3'); assert.equal(issued.itineraries.items.length, 1);
      assert.deepEqual(issued.itineraries.items[0].stops, received.stops);
      const otherBundle = (await service.get('/v1/field-data/app-user/offline-assignments').set('Authorization', `Bearer ${users[2].token}`).expect(200)).body.bundle;
      assert.equal(JSON.parse(Buffer.from(otherBundle.payload, 'base64url')).itineraries.items.length, 0);
    } finally {
      if (previousKey == null) delete process.env.FIELD_DATA_OFFLINE_SIGNING_KEY; else process.env.FIELD_DATA_OFFLINE_SIGNING_KEY = previousKey;
      if (previousOrigin == null) delete process.env.FIELD_DATA_OFFLINE_ORIGIN; else process.env.FIELD_DATA_OFFLINE_ORIGIN = previousOrigin;
    }

    assert.equal(received.stops.length, 2); assert.equal(received.withheld, 0);
    assert.equal(received.stops[0].xmlFormId, 'simple'); assert.equal(typeof received.stops[0].formVersion, 'string');
    assert.equal(typeof received.stops[0].dueAt, 'string'); assert.notEqual(received.stops[0].xmlFormId, 'route_survey');
    assert.equal(Object.hasOwn(received.stops[0], 'instanceId'), false); assert.equal(Object.hasOwn(received.stops[0], 'claimVersionId'), false);
    const pinned = preview.route.stops[0].claimVersionId;
    const provenance = await c.one(sql`SELECT p.* FROM field_data_submission_provenance p JOIN field_data_claim_versions v ON v."submissionDefId" = p."submissionDefId" WHERE v.id = ${pinned}`);
    await c.db.query(sql`UPDATE field_data_submission_provenance SET "integrityHash" = ${'0'.repeat(64)} WHERE "submissionDefId" = ${provenance.submissionDefId}`);
    assert.equal((await get(users[1])).body.items[0].withheld, 1);
    await navigate(received.stops.find(stop => stop.id === preview.route.stops[0].id)).expect(404);
    await c.db.query(sql`UPDATE field_data_submission_provenance SET "integrityHash" = ${provenance.integrityHash} WHERE "submissionDefId" = ${provenance.submissionDefId}`);
    await service.get('/v1/field-data/app-user/itineraries').expect(401);
    await service.post(`${root}/backcheck-itineraries`).set('Authorization', `Bearer ${users[1].token}`).send(body).expect(403);
    const first = preview.route.stops[0]; const detail = await alice.get(`/v1/field-data/review-queue/${first.caseId}`).expect(200);
    await alice.post(`/v1/field-data/review-queue/${first.caseId}/backchecks/${first.id}/cancel`).set('If-Match', detail.headers.etag)
      .send({ requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', reason: 'No longer needed.' }).expect(200);
    const refreshed = (await get(users[1])).body.items[0]; assert.equal(refreshed.stops.length, 1); assert.equal(refreshed.withheld, 1);
    await navigate(received.stops.find(stop => stop.id === first.id)).expect(404);
    await navigate(refreshed.stops[0]).expect(200);
    await c.run(sql`UPDATE projects SET archived = TRUE WHERE id = 1`);
    await navigate(refreshed.stops[0]).expect(404);
    await c.run(sql`UPDATE projects SET archived = FALSE WHERE id = 1`);
    await alice.post(`${root}/backcheck-itineraries`).send({ ...body, id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }).expect(400);
    const newPreview = (await route(alice, users[1])).body;
    const newerId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    await alice.post(`${root}/backcheck-itineraries`).send({ ...body, id: newerId, reviewToken: newPreview.reviewToken }).expect(201);
    await navigate(refreshed.stops[0]).expect(404);
    const newPath = `/v1/field-data/app-user/itineraries/${newerId}/stops/backcheck/${refreshed.stops[0].id}/navigation`;
    await service.get(newPath).set('Authorization', `Bearer ${users[1].token}`).expect(200);
    await alice.delete(`${root}/forms/simple/assignments/app-user/${users[1].id}`).expect(200);
    assert.equal((await get(users[1])).body.items[0].stops.length, 0);
    await service.get(newPath).set('Authorization', `Bearer ${users[1].token}`).expect(404);
  }));

});

describe('api: backchecks share capacity with re-verification', () => {
  it('plans, approves and refreshes mixed visits with pinned evidence and stale revision protection', testService(async (service, c) => {
    const { alice, users } = await setup(service, true, 1);
    const date = new Date().toISOString().slice(0, 10);
    await alice.post(`${root}/forms/route_survey/assignments/app-user/${users[1].id}`).expect(200);
    await calendar(alice, users[1], [3, 3, 3, 3, 3, 3, 3]);
    const claim = (await alice.get(`${root}/forms/route_survey/submissions/visit0/claim`).expect(200)).body.currentVersionId;
    const assets = '/v1/field-data/projects/1/assets';
    const asset = await alice.post(assets).send({ requestId: '88888888-1111-4111-8111-111111111111',
      name: 'Mixed route asset', externalId: 'MIXED-01', assetType: 'water-point', xmlFormId: 'route_survey' }).expect(201);
    await alice.post(`${assets}/${asset.body.id}/observations`).set('If-Match', asset.headers.etag).send({ requestId: '88888888-2222-4222-8222-222222222222', claimVersionId: claim, predicate: 'condition', state: 'known',
      value: 'working', validFrom: '2026-01-01T00:00:00Z', validityDays: 1, graceDays: 0, note: 'Observed.' }).expect(201);
    await generateReverification(c.db);
    const taskRoot = '/v1/field-data/projects/1/reverification-tasks';
    const task = (await alice.get(taskRoot).expect(200)).body.items[0];
    const dispatch = { requestId: '88888888-3333-4333-8333-333333333333', assigneeId: users[1].id, plannedVisitDate: date,
      visitBy: new Date(Date.now() + 2 * 86400000).toISOString(), note: 'Recheck condition.' };
    await alice.post(`${taskRoot}/${task.id}/dispatch`).set('If-Match', '"task-1"').send(dispatch).expect(200);
    const query = { actorId: String(users[1].id), date, startLat: '8.48', startLon: '-13.23' };
    const preview = async () => (await alice.get(`${root}/backcheck-route?${new URLSearchParams(query)}`).expect(200)).body;
    const single = await preview();
    assert.equal(single.route.stops.length, 1); assert.equal(single.route.stops[0].kind, 'reverification');
    await runAllocations(c.db, new Date());
    const plan = await preview();
    assert.equal(plan.scope, 'combined-visits@1'); assert.equal(plan.used, 2); assert.equal(plan.otherVisits, 1);
    assert.deepEqual(plan.route.stops.map(stop => stop.kind).sort(), ['backcheck', 'reverification']);
    const visit = plan.route.stops.find(stop => stop.kind === 'reverification');
    assert.equal(visit.assetId, asset.body.id); assert.equal(visit.claimVersionId, claim); assert.equal(visit.revision, 2);
    assert.equal(visit.question, 'Recheck condition.'); assert.equal(visit.location.latitude, 8.48);
    const { LIMITS } = require('../../../lib/resources/field-data-backcheck-planning');
    const savedLimit = LIMITS.maxStops;
    try {
      LIMITS.maxStops = 1;
      const partial = await preview(); assert.equal(partial.truncated, true); assert.equal(partial.route.stops.length, 1);
    } finally { LIMITS.maxStops = savedLimit; }
    const originalFetch = global.fetch; const originalUrl = process.env.FIELD_DATA_OSRM_URL;
    try {
      process.env.FIELD_DATA_OSRM_URL = 'https://routing.example';
      global.fetch = async url => {
        assert.equal(url.pathname.includes(task.id), false); assert.equal(url.pathname.includes(asset.body.id), false);
        return new Response(JSON.stringify({ code: 'Ok', routes: [{ distance: 3000, duration: 600,
          legs: Array.from({ length: 3 }, () => ({ distance: 1000, duration: 200 })) }],
        waypoints: Array.from({ length: 4 }, () => ({ distance: 0 })) }), { status: 200 });
      };
      const timed = await preview(); assert.equal(timed.road.status, 'ok'); assert.equal(timed.road.legs.length, 3);
      assert.equal(timed.timing.totalMinutes, 70); // Both visits, plus ten minutes driving.
    } finally {
      global.fetch = originalFetch;
      if (originalUrl == null) delete process.env.FIELD_DATA_OSRM_URL; else process.env.FIELD_DATA_OSRM_URL = originalUrl;
    }

    const body = { id: '88888888-4444-4444-8444-444444444444', query, reviewToken: plan.reviewToken, note: 'Visit both assignments.' };
    await alice.post(`${root}/backcheck-itineraries`).send({ ...body, query: { ...query, visitMinutes: '60' } }).expect(400);
    await alice.post(`${root}/backcheck-itineraries`).send(body).expect(201);
    const inbox = async () => (await service.get('/v1/field-data/app-user/itineraries')
      .set('Authorization', `Bearer ${users[1].token}`).expect(200)).body.items[0];
    assert.equal((await inbox()).stops.length, 2);
    const approvedPlan = await inbox();
    const navigateMixed = stop => service.get(`/v1/field-data/app-user/itineraries/${approvedPlan.id}/stops/${stop.kind}/${stop.id}/navigation`).set('Authorization', `Bearer ${users[1].token}`);
    for (const stop of approvedPlan.stops) await navigateMixed(stop).expect(200);
    assert.equal((await inbox()).stops.find(stop => stop.kind === 'reverification').question, dispatch.note);
    assert.equal((await inbox()).stops.find(stop => stop.kind === 'reverification').assetName, 'Mixed route asset');
    const previousKey = process.env.FIELD_DATA_OFFLINE_SIGNING_KEY; const previousOrigin = process.env.FIELD_DATA_OFFLINE_ORIGIN;
    try {
      process.env.FIELD_DATA_OFFLINE_SIGNING_KEY = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
      process.env.FIELD_DATA_OFFLINE_ORIGIN = 'https://field.example.test';
      const { bundle } = (await service.get('/v1/field-data/app-user/offline-assignments')
        .set('Authorization', `Bearer ${users[1].token}`).expect(200)).body;
      const issued = JSON.parse(Buffer.from(bundle.payload, 'base64url'));
      assert.deepEqual(issued.itineraries.items[0].stops.map(stop => stop.kind).sort(), ['backcheck', 'reverification']);
    } finally {
      if (previousKey == null) delete process.env.FIELD_DATA_OFFLINE_SIGNING_KEY; else process.env.FIELD_DATA_OFFLINE_SIGNING_KEY = previousKey;
      if (previousOrigin == null) delete process.env.FIELD_DATA_OFFLINE_ORIGIN; else process.env.FIELD_DATA_OFFLINE_ORIGIN = previousOrigin;
    }

    // Unverified evidence cannot leak a saved coordinate to a collector.
    const provenance = await c.one(sql`SELECT p.* FROM field_data_submission_provenance p
      JOIN field_data_claim_versions v ON v."submissionDefId" = p."submissionDefId" WHERE v.id = ${claim}`);
    await c.run(sql`UPDATE field_data_submission_provenance SET "integrityHash" = ${'0'.repeat(64)} WHERE "submissionDefId" = ${provenance.submissionDefId}`);
    assert.equal((await inbox()).stops.length, 0); assert.equal((await preview()).excluded.sourceUnverified, 2);
    await c.run(sql`UPDATE field_data_submission_provenance SET "integrityHash" = ${provenance.integrityHash} WHERE "submissionDefId" = ${provenance.submissionDefId}`);
    // A changed task invalidates approval and withholds the old instructions.
    await alice.post(`${taskRoot}/${task.id}/dispatch`).set('If-Match', '"task-2"')
      .send({ ...dispatch, requestId: '88888888-5555-4555-8555-555555555555', note: 'Use the revised instructions.' }).expect(200);
    assert.equal((await inbox()).withheld, 1);
    await navigateMixed(approvedPlan.stops.find(stop => stop.kind === 'reverification')).expect(404);
    await alice.post(`${root}/backcheck-itineraries`).send({ ...body, id: '88888888-6666-4666-8666-666666666666' }).expect(400);
    assert.notEqual((await preview()).reviewToken, plan.reviewToken);
    await alice.delete(`${root}/forms/route_survey/assignments/app-user/${users[1].id}`).expect(200);
    assert.equal((await preview()).excluded.collectorUnavailable, 1);
    await alice.post(`${taskRoot}/${task.id}/cancel`).set('If-Match', '"task-3"')
      .send({ requestId: '88888888-7777-4777-8777-777777777777', reasonCode: 'duplicate', note: 'No longer needed.' }).expect(200);
    assert.equal((await preview()).route.stops.length, 1); assert.equal((await preview()).used, 1);
  }));

  it('does not allocate the slot reserved by another task type, and reuses a cancelled slot', testService(async (service, c) => {
    const { alice, users } = await setup(service, false, 1);
    const date = new Date().toISOString().slice(0, 10);
    const at = new Date();
    const claim = (await alice.get(`${root}/forms/simple/submissions/visit0/claim`).expect(200)).body.currentVersionId;
    const assets = '/v1/field-data/projects/1/assets';
    const asset = await alice.post(assets).send({ requestId: '99999999-1111-4111-8111-111111111111',
      name: 'Shared visit', externalId: 'SHARED-01', assetType: 'water-point', xmlFormId: 'simple' }).expect(201);
    await alice.post(`${assets}/${asset.body.id}/observations`).set('If-Match', asset.headers.etag).send({ requestId: '99999999-2222-4222-8222-222222222222', claimVersionId: claim, predicate: 'condition', state: 'known',
      value: 'working', validFrom: '2026-01-01T00:00:00Z', validityDays: 1, graceDays: 0, note: 'Observed.' }).expect(201);
    await generateReverification(c.db);
    const taskRoot = '/v1/field-data/projects/1/reverification-tasks';
    const task = (await alice.get(taskRoot).expect(200)).body.items[0];
    await calendar(alice, users[1], [0, 0, 0, 0, 0, 0, 0], [{ date, maxVisits: 1 }]);
    await alice.post(`${taskRoot}/${task.id}/dispatch`).set('If-Match', '"task-1"').send({ requestId: '99999999-3333-4333-8333-333333333333', assigneeId: users[1].id, plannedVisitDate: date,
      visitBy: new Date(at.getTime() + 2 * 86400000).toISOString(), note: 'Check condition.' }).expect(200);
    await runAllocations(c.db, at);
    assert.equal((await checks(c)).length, 0);
    await alice.post(`${taskRoot}/${task.id}/cancel`).set('If-Match', '"task-2"').send({ requestId: '99999999-4444-4444-8444-444444444444', reasonCode: 'duplicate', note: 'One visit suffices.' }).expect(200);
    await runAllocations(c.db, at);
    assert.equal((await checks(c)).length, 1);
  }));
});
