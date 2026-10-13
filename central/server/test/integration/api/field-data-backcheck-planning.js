require('should');
const assert = require('node:assert/strict');
const { sql } = require('slonik');
const { testService, testServiceFullTrx } = require('../setup');
const testData = require('../../data/xml');
const { runAllocations } = require('../../../lib/worker/field-data-backcheck-allocation');
/* eslint-disable no-await-in-loop */
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
const now = new Date('2026-10-14T12:00:00Z');
const route = (alice, user) => alice.get(`${root}/backcheck-route?actorId=${user.id}&date=2026-10-14&startLat=8.48&startLon=-13.23`).expect(200);
describe('api: calendar availability and route planning', () => {
  it('reserves dated capacity with exceptions, includes dates in the inbox, and does not reuse completed slots', testService(async (service, c) => {
    const { alice, users } = await setup(service);
    await runAllocations(c.db, now);
    assert.equal((await checks(c)).length, 0);
    assert.equal((await alice.get(`${root}/forms/simple/backcheck-allocation`).expect(200)).body.policy.report.noCalendarSlot, 3);
    await calendar(alice, users[2], [0, 0, 0, 0, 1, 0, 0]);
    await runAllocations(c.db, now);
    assert.equal((await checks(c)).length, 1);
    await calendar(alice, users[1], [1, 1, 1, 1, 1, 1, 1], [{ date: '2026-10-14', maxVisits: 0 }]);
    await runAllocations(c.db, now);
    const rows = await checks(c);
    assert.deepEqual(rows.map(r => r.date).sort(), ['2026-10-15', '2026-10-15', '2026-10-16']);
    const inbox = (await service.get('/v1/field-data/app-user/backchecks').set('Authorization', `Bearer ${users[1].token}`).expect(200)).body;
    assert.deepEqual(inbox.items.map(i => i.plannedVisitDate).sort(), ['2026-10-15', '2026-10-16']);
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
    const cancelled = rows.find(r => r.date === '2026-10-16');
    const item = await alice.get(`/v1/field-data/review-queue/${cancelled.caseId}`).expect(200);
    await alice.post(`/v1/field-data/review-queue/${cancelled.caseId}/backchecks/${cancelled.id}/cancel`).set('If-Match', item.headers.etag)
      .send({ requestId: '33333333-3333-4333-8333-333333333333', reason: 'Visit no longer needed.' }).expect(200);
    await runAllocations(c.db, now);
    assert.equal((await checks(c)).length, 4);
    assert.equal((await checks(c)).at(-1).date, '2026-10-16');
  }));
  it('serializes calendar-aware allocation without overbooking a day', testServiceFullTrx(async (service, c) => {
    const { alice, users } = await setup(service, false, 4);
    await calendar(alice, users[1], [0, 0, 0, 1, 0, 0, 0]);
    await Promise.all([runAllocations(c.db, now), runAllocations(c.db, now)]);
    assert.equal((await checks(c)).length, 1); assert.equal((await checks(c))[0].date, '2026-10-14');
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
    await chelsea.get(`${root}/backcheck-route?actorId=${users[1].id}&date=2026-10-14&startLat=8&startLon=-13`).expect(403);
    await service.get(`${root}/backcheck-calendars`).set('Authorization', `Bearer ${users[0].token}`).expect(403);
    await alice.put(`${root}/backcheck-calendars/${id}`).send({ weeklyCapacity: [1, 1, 1, 1, 1, 1, 1] }).expect(404);
    for (const body of [{ weeklyCapacity: [1] }, { weeklyCapacity: [1, 1, 1, 1, 1, 1, 1], exceptions: [{ date: '2026-02-30', maxVisits: 0 }] }])
      await alice.put(`${root}/backcheck-calendars/${users[1].id}`).send(body).expect(400);
    await calendar(alice, users[1], [1, 1, 1, 1, 1, 1, 1]); await runAllocations(c.db, now);
    assert.equal((await route(alice, users[1])).body.excluded.missingLocation, 1);
    await alice.get(`${root}/backcheck-route?actorId=${users[1].id}&date=2026-02-30&startLat=8&startLon=-13`).expect(400);
    await alice.get(`${root}/backcheck-route?actorId=${users[1].id}&date=2026-10-14&startLat=91&startLon=-13`).expect(400);
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
      assert.equal((await checks(c))[0].date, '2026-10-14');
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
      const result = (await alice.get(`${root}/backcheck-route?actorId=${users[1].id}&date=2026-10-14&startLat=8.48&startLon=-13.23&visitMinutes=30&dayMinutes=60`).expect(200)).body;
      assert.equal(result.road.travelMinutes, 60); assert.equal(result.timing.totalMinutes, 90);
      assert.equal(result.timing.overBudget, true); assert.equal(result.needsReview, true);
      await alice.get(`${root}/backcheck-route?actorId=${users[1].id}&date=2026-10-14&startLat=8.48&startLon=-13.23&visitMinutes=0`).expect(400);
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
    const { alice, users } = await setup(service, true, 3);
    const settings = { weeklyCapacity: [100, 100, 100, 100, 100, 100, 100], visitMinutes: 45,
      weeklyShifts: Array(7).fill({ start: '08:00', end: '08:30' }),
      exceptions: [{ date: '2026-10-15', maxVisits: 100, shift: { start: '08:00', end: '09:30' } }] };
    await alice.put(`${root}/backcheck-calendars/${users[1].id}`).send(settings).expect(200);
    await runAllocations(c.db, now);
    const rows = await checks(c);
    assert.equal(rows.length, 2); assert.deepEqual(rows.map(r => r.date), ['2026-10-15', '2026-10-15']);
    const { report } = (await alice.get(`${root}/forms/route_survey/backcheck-allocation`).expect(200)).body.policy;
    assert.equal(report.noCalendarSlot, 1);
    const plan = (await alice.get(`${root}/backcheck-route?actorId=${users[1].id}&date=2026-10-15&startLat=8.48&startLon=-13.23`).expect(200)).body;
    assert.equal(plan.timing.visitMinutes, 45); assert.equal(plan.timing.dayMinutes, 90);
    assert.equal(plan.timing.shift.start, '08:00'); assert.equal(plan.timing.shift.end, '09:30');
    assert.equal(plan.timing.previewOverrides, false); assert.equal(plan.timing.totalMinutes, null);
    const invalid = { ...settings, weeklyShifts: Array(7).fill({ start: '09:00', end: '08:00' }) };
    await alice.put(`${root}/backcheck-calendars/${users[1].id}`).send(invalid).expect(400);
    await alice.put(`${root}/backcheck-calendars/${users[1].id}`).send({ ...settings, exceptions: [{ date: '2026-10-15', maxVisits: 100, shift: null }] }).expect(200);
    const closed = (await alice.get(`${root}/backcheck-route?actorId=${users[1].id}&date=2026-10-15&startLat=8.48&startLon=-13.23`).expect(200)).body;
    assert.equal(closed.timing.shiftUnavailable, true); assert.equal(closed.timing.dayMinutes, 0); assert.equal(closed.needsReview, true);
    assert.equal((await checks(c)).length, 2); // Edits never move existing visits.
    const past = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const expired = (await alice.get(`${root}/backcheck-route?actorId=${users[1].id}&date=${past}&startLat=8.48&startLon=-13.23&dayMinutes=1440`).expect(200)).body;
    assert.equal(expired.timing.expiredShift, true); assert.equal(expired.timing.dayMinutes, 0);
    assert.equal(expired.timing.shiftBudgetMinutes, 0); assert.equal(expired.needsReview, true);
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
    const url = `${root}/backcheck-route?actorId=${users[1].id}&date=2026-10-14&startLat=8.48&startLon=-13.23&order=road`;
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
      query: { actorId: String(users[1].id), date: '2026-10-14', startLat: '8.48', startLon: '-13.23' } };
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
    assert.equal(received.stops.length, 2); assert.equal(received.withheld, 0);
    assert.equal(Object.hasOwn(received.stops[0], 'instanceId'), false); assert.equal(Object.hasOwn(received.stops[0], 'claimVersionId'), false);
    const pinned = preview.route.stops[0].claimVersionId;
    const provenance = await c.one(sql`SELECT p.* FROM field_data_submission_provenance p JOIN field_data_claim_versions v ON v."submissionDefId" = p."submissionDefId" WHERE v.id = ${pinned}`);
    await c.db.query(sql`UPDATE field_data_submission_provenance SET "integrityHash" = ${'0'.repeat(64)} WHERE "submissionDefId" = ${provenance.submissionDefId}`);
    assert.equal((await get(users[1])).body.items[0].withheld, 1);
    await c.db.query(sql`UPDATE field_data_submission_provenance SET "integrityHash" = ${provenance.integrityHash} WHERE "submissionDefId" = ${provenance.submissionDefId}`);
    await service.get('/v1/field-data/app-user/itineraries').expect(401);
    await service.post(`${root}/backcheck-itineraries`).set('Authorization', `Bearer ${users[1].token}`).send(body).expect(403);
    const first = preview.route.stops[0]; const detail = await alice.get(`/v1/field-data/review-queue/${first.caseId}`).expect(200);
    await alice.post(`/v1/field-data/review-queue/${first.caseId}/backchecks/${first.id}/cancel`).set('If-Match', detail.headers.etag)
      .send({ requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', reason: 'No longer needed.' }).expect(200);
    const refreshed = (await get(users[1])).body.items[0]; assert.equal(refreshed.stops.length, 1); assert.equal(refreshed.withheld, 1);
    await alice.post(`${root}/backcheck-itineraries`).send({ ...body, id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }).expect(400);
    await alice.delete(`${root}/forms/simple/assignments/app-user/${users[1].id}`).expect(200);
    assert.equal((await get(users[1])).body.items[0].stops.length, 0);
  }));

});
