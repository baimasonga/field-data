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

});
