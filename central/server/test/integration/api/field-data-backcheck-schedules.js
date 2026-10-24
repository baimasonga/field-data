// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// O6 scheduled backcheck samples: docs/field-intelligence/O6-scheduled-backcheck-samples.md

require('should');
const config = require('config');
const assert = require('node:assert/strict');
const { sql } = require('slonik');
const { LIMITS, nextBoundaryAfter } = require('../../../lib/util/backcheck-sample');
const { runBackcheckSchedules } = require('../../../lib/worker/field-data-backcheck-schedules');
const { testService, testServiceFullTrx } = require('../setup');
const { knexConnect } = require('../../../lib/model/knex-migrator');
const scheduleMigration = require('../../../lib/model/migrations/20261011-04-add-backcheck-schedules');
const testData = require('../../data/xml');

/* eslint-disable no-await-in-loop */

const path = '/v1/projects/1/forms/simple/backcheck-schedule';
const instance = (id) => testData.instances.simple.one.replace('one</instanceID>', `${id}</instanceID>`);
const minute = 60 * 1000;
const day = 24 * 60 * minute;

const submit = async (alice, ...ids) => {
  for (const id of ids)
    await alice.post('/v1/projects/1/forms/simple/submissions').send(instance(id)).set('Content-Type', 'application/xml').expect(200);
};
const scheduleRow = (one) => one(sql`SELECT * FROM field_data_backcheck_schedules`);

const polygonBox = (value, x, y, size = 2) => ({ value, geometry: { type: 'Polygon', coordinates: [[[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]] } });
const publishGeopoint = alice => alice.post('/v1/projects/1/forms?publish=true').send(testData.forms.simple.replace('id="simple"', 'id="locations"').replace('type="int"', 'type="geopoint"')).set('Content-Type', 'application/xml').expect(200);
const submitPoint = (alice, id, point) => alice.post('/v1/projects/1/forms/locations/submissions').send(instance(id).replace('id="simple"', 'id="locations"').replace('<age>30</age>', `<age>${point}</age>`)).set('Content-Type', 'application/xml').expect(200);

describe('api: O6 scheduled backcheck samples', () => {
  it('is set and read by those allowed, with every setting checked', testService(async (service) => {
    const alice = await service.login('alice');
    assert.deepEqual((await alice.get(path).expect(200)).body, { schedule: null, runs: [] });
    const refused = await Promise.all([
      {}, { rate: 0, frequency: 'daily', enabled: true }, { rate: 10, minPerCollector: 21, frequency: 'daily', enabled: true },
      { rate: 10, frequency: 'hourly', enabled: true }, { rate: 10, frequency: 'daily', enabled: 'yes' },
      { rate: 10, frequency: 'daily', enabled: true, receivedFrom: '2026-01-01' }, []
    ].map((body) => alice.put(path).send(body).expect(400)));
    assert.ok(refused.every((r) => r.body.code === 400.58));

    const before = Date.now();
    const { body } = await alice.put(path).send({ rate: 20, frequency: 'weekly', enabled: true }).expect(200);
    assert.equal(body.schedule.rate, 20);
    assert.equal(body.schedule.minPerCollector, 1);
    assert.equal(body.schedule.updatedByName, 'Alice');
    // The first period starts now; the first run is due at the next Monday.
    assert.ok(Date.parse(body.schedule.periodStart) >= before - minute);
    const next = new Date(body.schedule.nextRunAt);
    assert.equal(next.getUTCDay(), 1);
    assert.equal(next.getTime(), nextBoundaryAfter(new Date(body.schedule.periodStart), 'weekly').getTime());

    const chelsea = await service.login('chelsea');
    const chelseaId = (await chelsea.get('/v1/users/current').expect(200)).body.id;
    await alice.post(`/v1/projects/1/assignments/viewer/${chelseaId}`).expect(200);
    assert.equal((await chelsea.get(path).expect(200)).body.schedule.rate, 20);
    await chelsea.put(path).send({ rate: 50, frequency: 'daily', enabled: true }).expect(403);
    const appUser = (await alice.post('/v1/projects/1/app-users').send({ displayName: 'Collector' }).expect(200)).body;
    await alice.post(`/v1/projects/1/forms/simple/assignments/app-user/${appUser.id}`).expect(200);
    await service.get(`/v1/key/${appUser.token}${path.slice(3)}`).expect(403);
    await service.put(`/v1/key/${appUser.token}${path.slice(3)}`).send({ rate: 50, frequency: 'daily', enabled: true }).expect(403);
    await alice.get('/v1/projects/1/forms/nope/backcheck-schedule').expect(404);
  }));

  it('persists, clears and validates scheduled grouping with viewer restrictions', testService(async service => {
    const alice = await service.login('alice');
    const body = { rate: 20, frequency: 'daily', enabled: true, groupField: '/name' };
    assert.equal((await alice.put(path).send(body).expect(200)).body.schedule.groupField, '/name');
    assert.equal((await alice.get(path).expect(200)).body.schedule.groupField, '/name');
    for (const groupField of ['/missing', '/meta/instanceID', '/name[1]', '', 1])
      await alice.put(path).send({ ...body, groupField }).expect(400);
    const chelsea = await service.login('chelsea');
    const { id } = (await chelsea.get('/v1/users/current').expect(200)).body;
    await alice.post(`/v1/projects/1/assignments/viewer/${id}`).expect(200);
    assert.equal((await chelsea.get(path).expect(200)).body.schedule.groupField, '/name');
    await chelsea.put(path).send(body).expect(403);
    assert.equal((await alice.put(path).send({ ...body, groupField: null }).expect(200)).body.schedule.groupField, undefined);
    await alice.put(path).send(body).expect(200);
    assert.equal((await alice.put(path).send({ rate: 20, frequency: 'daily', enabled: true }).expect(200)).body.schedule.groupField, undefined);
  }));

  it('draws grouped catch-up periods reproducibly with missing answers and retry-safe history', testService(async (service, c) => {
    const alice = await service.login('alice');
    await alice.put(path).send({ rate: 10, frequency: 'weekly', enabled: true, groupField: '/name' }).expect(200);
    for (const [i, value] of ['North', 'North', 'South', ''].entries())
      await alice.post('/v1/projects/1/forms/simple/submissions').send(instance(`group${i}`).replace('Alice</name>', `${value}</name>`)).set('Content-Type', 'application/xml').expect(200);
    const first = await scheduleRow(c.one);
    const at = new Date(first.nextRunAt.getTime() + 7 * day);
    const [result] = await runBackcheckSchedules(c.db, at);
    assert.equal(result.outcome, 'drawn'); assert.equal(result.periods, 2); assert.equal(result.sampled, 3);
    const sample = (await alice.get(`/v1/projects/1/forms/simple/backcheck-samples/${result.sampleId}?eligible=true`).expect(200)).body;
    assert.equal(sample.settings.groupField, '/name');
    assert.deepEqual(sample.groups.map(g => [g.value, g.eligible, g.sampled]), [['North', 2, 1], ['South', 1, 1], [null, 1, 1]]);
    const { draw } = require('../../../lib/util/backcheck-sample');
    assert.deepEqual(draw(sample.eligibleList, sample.settings, sample.seed).chosen.map(i => i.instanceId).sort(), sample.items.map(i => i.instanceId).sort());
    assert.deepEqual(await runBackcheckSchedules(c.db, at), []);
    assert.equal(await c.oneFirst(sql`SELECT count(*)::integer FROM field_data_backcheck_schedule_runs`), 1);
  }));

  it('persists and executes group rates and clears them without changing period boundaries', testService(async (service, c) => {
    const alice = await service.login('alice');
    const settings = { rate: 10, frequency: 'daily', enabled: true, groupField: '/name',
      groupRates: [{ value: null, rate: 100 }, { value: ' North ', rate: 100 }] };
    const initial = (await alice.put(path).send(settings).expect(200)).body.schedule;
    const rules = [{ value: 'North', rate: 100 }, { value: null, rate: 100 }];
    assert.deepEqual(initial.groupRates, rules);
    assert.deepEqual((await alice.get(path).expect(200)).body.schedule.groupRates, rules);
    for (const [i, value] of ['North', 'North', 'South', 'South', '', ''].entries())
      await alice.post('/v1/projects/1/forms/simple/submissions').send(instance(`rate${i}`).replace('Alice</name>', `${value}</name>`)).set('Content-Type', 'application/xml').expect(200);
    const [result] = await runBackcheckSchedules(c.db, new Date(initial.nextRunAt));
    assert.equal(result.sampled, 5);
    const sample = (await alice.get(`/v1/projects/1/forms/simple/backcheck-samples/${result.sampleId}`).expect(200)).body;
    assert.deepEqual(sample.settings.groupRates, rules);
    assert.deepEqual(sample.groups.map(g => [g.value, g.rate, g.sampled]), [['North', 100, 2], ['South', 10, 1], [null, 100, 2]]);
    const boundary = (await alice.get(path).expect(200)).body.schedule.periodStart;
    const cleared = (await alice.put(path).send({ ...settings, groupRates: [] }).expect(200)).body.schedule;
    assert.equal(cleared.groupRates, undefined); assert.equal(cleared.periodStart, boundary);
    await alice.put(path).send(settings).expect(200);
    const collector = (await alice.put(path).send({ rate: 20, frequency: 'daily', enabled: true }).expect(200)).body.schedule;
    assert.equal(collector.groupRates, undefined); assert.equal(collector.groupField, undefined);
    await alice.put(path).send({ ...settings, groupField: null }).expect(400);
    assert.deepEqual((await alice.get(`/v1/projects/1/forms/simple/backcheck-samples/${result.sampleId}`).expect(200)).body.settings.groupRates, rules);
  }));

  it('preserves configured rates on rollback and recreates an unused column', testServiceFullTrx(async service => {
    const alice = await service.login('alice');
    await alice.put(path).send({ rate: 10, frequency: 'daily', enabled: true, groupField: '/name', groupRates: [{ value: 'North', rate: 100 }] }).expect(200);
    const migration = require('../../../lib/model/migrations/20261023-02-group-sampling-rates');
    const db = knexConnect(config.get('test.database'));
    try {
      await db.transaction(async trx => {
        await migration.down(trx); await migration.up(trx);
        assert.deepEqual((await trx.raw('SELECT "groupRates" FROM field_data_backcheck_schedules')).rows[0].groupRates, [{ value: 'North', rate: 100 }]);
        await trx.raw('UPDATE field_data_backcheck_schedules SET "groupRates" = NULL');
        await migration.down(trx); await migration.up(trx);
        assert.equal((await trx.raw('SELECT "groupRates" FROM field_data_backcheck_schedules')).rows[0].groupRates, null);
      });
    } finally { await db.destroy(); }
  }));

  it('persists and runs numeric ranges across catch-up periods and clears without resetting the period', testService(async (service, c) => {
    const alice = await service.login('alice');
    const settings = { rate: 10, minPerCollector: 0, frequency: 'weekly', enabled: true, groupField: '/age', groupBreaks: ['018.00', '35'], groupRates: [{ value: 'Below 18', rate: 100 }] };
    const initial = (await alice.put(path).send(settings).expect(200)).body.schedule;
    assert.deepEqual(initial.groupBreaks, ['18', '35']);
    assert.deepEqual((await alice.get(path).expect(200)).body.schedule.groupBreaks, ['18', '35']);
    await alice.put(path).send({ ...settings, groupField: '/name' }).expect(400);
    for (const [i, value] of ['17', '17.9999999999999999999', '18', '35', ''].entries())
      await alice.post('/v1/projects/1/forms/simple/submissions').send(instance(`numeric${i}`).replace('<age>30</age>', `<age>${value}</age>`)).set('Content-Type', 'application/xml').expect(200);
    const at = new Date(Date.parse(initial.nextRunAt) + 7 * day);
    const [result] = await runBackcheckSchedules(c.db, at);
    assert.equal(result.periods, 2); assert.equal(result.sampled, 5);
    const sample = (await alice.get(`/v1/projects/1/forms/simple/backcheck-samples/${result.sampleId}?eligible=true`).expect(200)).body;
    assert.deepEqual(sample.settings.groupBreaks, ['18', '35']);
    assert.deepEqual(sample.groups.map(g => g.value), ['Below 18', '18 to below 35', '35 or above', null]);
    const { draw } = require('../../../lib/util/backcheck-sample');
    assert.deepEqual(draw(sample.eligibleList, sample.settings, sample.seed).chosen.map(i => i.instanceId).sort(), sample.items.map(i => i.instanceId).sort());
    assert.deepEqual(await runBackcheckSchedules(c.db, at), []);
    const boundary = (await alice.get(path).expect(200)).body.schedule.periodStart;
    const exact = (await alice.put(path).send({ rate: 10, frequency: 'weekly', enabled: true, groupField: '/age' }).expect(200)).body.schedule;
    assert.equal(exact.groupBreaks, undefined); assert.equal(exact.groupRates, undefined); assert.equal(exact.periodStart, boundary);
    assert.deepEqual((await alice.get(`/v1/projects/1/forms/simple/backcheck-samples/${result.sampleId}`).expect(200)).body.settings.groupBreaks, ['18', '35']);
  }));

  it('pauses invalid numeric data atomically and rejects a question no longer numeric', testService(async (service, c) => {
    const alice = await service.login('alice');
    const settings = { rate: 10, frequency: 'daily', enabled: true, groupField: '/age', groupBreaks: ['18'] };
    await alice.put(path).send(settings).expect(200);
    await alice.post('/v1/projects/1/forms/simple/submissions').send(instance('invalidNumeric').replace('<age>30</age>', '<age>1e3</age>')).set('Content-Type', 'application/xml').expect(200);
    const [result] = await runBackcheckSchedules(c.db, (await scheduleRow(c.one)).nextRunAt);
    assert.equal(result.outcome, 'failed'); assert.equal((await scheduleRow(c.one)).enabled, false);
    assert.equal(await c.oneFirst(sql`SELECT count(*)::integer FROM field_data_backcheck_samples`), 0);
    assert.equal(await c.oneFirst(sql`SELECT count(*)::integer FROM audits WHERE action = 'field_data.backcheck_sample.draw'`), 0);
    await alice.put(path).send({ ...settings, enabled: false }).expect(200);
    await alice.put(path).send(settings).expect(200);
    await c.run(sql`UPDATE field_data_backcheck_schedules SET "groupField" = '/name'`);
    const [retired] = await runBackcheckSchedules(c.db, (await scheduleRow(c.one)).nextRunAt);
    assert.match(retired.error, /grouping question.*unavailable/);
    assert.equal((await scheduleRow(c.one)).enabled, false);
    await alice.put(path).send({ rate: 10, frequency: 'daily', enabled: true }).expect(200);
    const cleared = (await alice.get(path).expect(200)).body.schedule;
    assert.equal(cleared.groupBreaks, undefined);
  }));

  it('retains configured numeric ranges on rollback and recreates unused columns', testServiceFullTrx(async service => {
    const alice = await service.login('alice');
    await alice.put(path).send({ rate: 10, frequency: 'daily', enabled: true, groupField: '/age', groupBreaks: ['18', '35'] }).expect(200);
    const migration = require('../../../lib/model/migrations/20261024-01-numeric-sampling-ranges');
    const db = knexConnect(config.get('test.database'));
    try {
      await db.transaction(async trx => {
        await migration.down(trx); await migration.up(trx);
        assert.deepEqual((await trx.raw('SELECT "groupBreaks" FROM field_data_backcheck_schedules')).rows[0].groupBreaks, ['18', '35']);
        await trx.raw('UPDATE field_data_backcheck_schedules SET "groupBreaks" = NULL');
        await migration.down(trx); await migration.up(trx);
        assert.equal((await trx.raw('SELECT "groupBreaks" FROM field_data_backcheck_schedules')).rows[0].groupBreaks, null);
      });
    } finally { await db.destroy(); }
  }));

  it('persists polygon schedules, draws catch-up periods and clears without resetting the period', testService(async (service, c) => {
    const alice = await service.login('alice'); await publishGeopoint(alice);
    const polygonPath = '/v1/projects/1/forms/locations/backcheck-schedule';
    const groupAreas = [polygonBox('North', 10, 10)];
    const settings = { rate: 10, frequency: 'weekly', enabled: true, groupField: '/age', groupAreas, groupRates: [{ value: 'North', rate: 100 }] };
    const initial = (await alice.put(polygonPath).send(settings).expect(200)).body.schedule;
    assert.deepEqual((await alice.get(polygonPath).expect(200)).body.schedule.groupAreas, groupAreas);
    for (const [i, point] of ['10.1 10.1', '10.2 10.2', '40 40', ''].entries()) await submitPoint(alice, `geo${i}`, point);
    const at = new Date(Date.parse(initial.nextRunAt) + 7 * day);
    const [result] = await runBackcheckSchedules(c.db, at); assert.equal(result.periods, 2); assert.equal(result.sampled, 4);
    const samplePath = `/v1/projects/1/forms/locations/backcheck-samples/${result.sampleId}`;
    const sample = (await alice.get(`${samplePath}?eligible=true`).expect(200)).body;
    assert.deepEqual(sample.settings.groupAreas, groupAreas);
    assert.deepEqual(sample.groups.map(g => g.value), ['North', 'Outside areas', null]);
    const { draw } = require('../../../lib/util/backcheck-sample');
    assert.deepEqual(draw(sample.eligibleList, sample.settings, sample.seed).chosen.map(i => i.instanceId).sort(), sample.items.map(i => i.instanceId).sort());
    assert.deepEqual(await runBackcheckSchedules(c.db, at), []);
    const boundary = (await alice.get(polygonPath).expect(200)).body.schedule.periodStart;
    const cleared = (await alice.put(polygonPath).send({ rate: 10, frequency: 'weekly', enabled: true }).expect(200)).body.schedule;
    assert.equal(cleared.groupAreas, undefined); assert.equal(cleared.groupField, undefined); assert.equal(cleared.periodStart, boundary);
    assert.deepEqual((await alice.get(samplePath).expect(200)).body.settings.groupAreas, groupAreas);
  }));

  it('pauses invalid geographic data and unavailable geopoint fields without partial draws', testService(async (service, c) => {
    const alice = await service.login('alice'); await publishGeopoint(alice);
    const polygonPath = '/v1/projects/1/forms/locations/backcheck-schedule';
    const settings = { rate: 10, frequency: 'daily', enabled: true, groupField: '/age', groupAreas: [polygonBox('North', 10, 10)] };
    await alice.put(polygonPath).send(settings).expect(200); await submitPoint(alice, 'unsafeGeo', '0 0');
    const [failed] = await runBackcheckSchedules(c.db, (await scheduleRow(c.one)).nextRunAt);
    assert.equal(failed.outcome, 'failed'); assert.equal((await scheduleRow(c.one)).enabled, false);
    assert.equal(await c.oneFirst(sql`SELECT count(*)::integer FROM field_data_backcheck_samples`), 0);
    assert.equal(await c.oneFirst(sql`SELECT count(*)::integer FROM audits WHERE action = 'field_data.backcheck_sample.draw'`), 0);
    await alice.put(polygonPath).send(settings).expect(200);
    await c.run(sql`UPDATE field_data_backcheck_schedules SET "groupField" = '/name'`);
    const [retired] = await runBackcheckSchedules(c.db, (await scheduleRow(c.one)).nextRunAt);
    assert.match(retired.error, /grouping question.*unavailable/); assert.equal((await scheduleRow(c.one)).enabled, false);
    await alice.put(polygonPath).send({ ...settings, enabled: false, groupField: '/retired' }).expect(200);
  }));

  it('preserves polygon definitions on rollback and recreates unused columns', testServiceFullTrx(async service => {
    const alice = await service.login('alice'); await publishGeopoint(alice);
    const groupAreas = [polygonBox('North', 10, 10)];
    await alice.put('/v1/projects/1/forms/locations/backcheck-schedule').send({ rate: 10, frequency: 'daily', enabled: true, groupField: '/age', groupAreas }).expect(200);
    const migration = require('../../../lib/model/migrations/20261024-02-polygon-sampling-areas');
    const db = knexConnect(config.get('test.database'));
    try {
      await db.transaction(async trx => {
        await migration.down(trx); await migration.up(trx);
        assert.deepEqual((await trx.raw('SELECT "groupAreas" FROM field_data_backcheck_schedules')).rows[0].groupAreas, groupAreas);
        await trx.raw('UPDATE field_data_backcheck_schedules SET "groupAreas" = NULL');
        await migration.down(trx); await migration.up(trx);
        assert.equal((await trx.raw('SELECT "groupAreas" FROM field_data_backcheck_schedules')).rows[0].groupAreas, null);
      });
    } finally { await db.destroy(); }
  }));

  it('pauses unsafe grouping atomically and can resume with collector-only settings', testService(async (service, c) => {
    const alice = await service.login('alice');
    const settings = { rate: 100, frequency: 'daily', enabled: true, groupField: '/name' };
    await alice.put(path).send(settings).expect(200);
    await submit(alice, 'unsafe0');
    await c.run(sql`UPDATE submission_defs SET "localKey" = 'encrypted' WHERE current AND xml LIKE '%unsafe0</instanceID>%'`);
    const [result] = await runBackcheckSchedules(c.db, (await scheduleRow(c.one)).nextRunAt);
    assert.equal(result.outcome, 'failed'); assert.match(result.error, /Schedule paused/);
    assert.equal((await scheduleRow(c.one)).enabled, false);
    assert.equal(await c.oneFirst(sql`SELECT count(*)::integer FROM field_data_backcheck_samples`), 0);
    assert.equal(await c.oneFirst(sql`SELECT count(*)::integer FROM audits WHERE action = 'field_data.backcheck_sample.draw'`), 0);
    await alice.put(path).send({ ...settings, enabled: false, groupField: '/retired' }).expect(200);
    await alice.put(path).send({ ...settings, groupField: null }).expect(200);
    await submit(alice, 'after0');
    const [next] = await runBackcheckSchedules(c.db, (await scheduleRow(c.one)).nextRunAt);
    assert.equal(next.outcome, 'drawn'); assert.equal(next.sampled, 1);
  }));

  it('pauses when the selected question disappears or the project is archived', testService(async (service, c) => {
    const alice = await service.login('alice');
    const settings = { rate: 10, frequency: 'daily', enabled: true, groupField: '/name' };
    await alice.put(path).send(settings).expect(200); await submit(alice, 'retired0');
    await c.run(sql`UPDATE field_data_backcheck_schedules SET "groupField" = '/retired'`);
    let [result] = await runBackcheckSchedules(c.db, (await scheduleRow(c.one)).nextRunAt);
    assert.match(result.error, /grouping question.*unavailable/); assert.equal((await scheduleRow(c.one)).enabled, false);
    await alice.put(path).send(settings).expect(200);
    await c.run(sql`UPDATE projects SET archived = TRUE WHERE id = 1`);
    [result] = await runBackcheckSchedules(c.db, (await scheduleRow(c.one)).nextRunAt);
    assert.equal(result.outcome, 'failed'); assert.equal((await scheduleRow(c.one)).enabled, false);
  }));

  it('rechecks answer-read permission even when the configuring manager still has write permission', testService(async (service, c) => {
    const alice = await service.login('alice');
    const settings = { rate: 10, frequency: 'daily', enabled: true, groupField: '/name' };
    await alice.put(path).send(settings).expect(200); await submit(alice, 'private0');
    const { id } = (await alice.get('/v1/users/current').expect(200)).body;
    const actor = (await c.Actors.getById(id)).orNull();
    const actee = await c.oneFirst(sql`SELECT "acteeId" FROM forms WHERE "projectId" = 1 AND "xmlFormId" = 'simple'`);
    await c.run(sql`UPDATE roles SET verbs = verbs - 'submission.read'`);
    assert.equal(await c.Auth.can(actor, 'submission.update', actee), true);
    assert.equal(await c.Auth.can(actor, 'submission.read', actee), false);
    await alice.put(path).send(settings).expect(403);
    const [result] = await runBackcheckSchedules(c.db, (await scheduleRow(c.one)).nextRunAt);
    assert.equal(result.outcome, 'failed'); assert.equal((await scheduleRow(c.one)).enabled, false);
    assert.equal(await c.oneFirst(sql`SELECT count(*)::integer FROM field_data_backcheck_samples`), 0);
  }));

  it('draws each ended period once, of only that period\'s submissions, and records every run', testService(async (service, container) => {
    const { one, all, oneFirst, run } = container;
    const alice = await service.login('alice');
    await submit(alice, 'before0');
    await alice.put(path).send({ rate: 100, minPerCollector: 1, frequency: 'daily', enabled: true }).expect(200);
    await submit(alice, 'during0', 'during1');
    const first = await scheduleRow(one);

    // Not due before the period ends.
    assert.deepEqual(await runBackcheckSchedules(container.db, new Date(first.nextRunAt.getTime() - minute)), []);
    const at = new Date(first.nextRunAt.getTime() + 5 * minute);
    const [drawn] = await runBackcheckSchedules(container.db, at);
    assert.equal(drawn.outcome, 'drawn');
    assert.equal(drawn.periods, 1);
    const items = await all(sql`SELECT "instanceId" FROM field_data_backcheck_sample_items WHERE "sampleId" = ${drawn.sampleId} ORDER BY "instanceId"`);
    assert.deepEqual(items.map((i) => i.instanceId), ['during0', 'during1']);
    const codes = await all(sql`SELECT c."reasonCodes" FROM field_data_backcheck_sample_items i
      JOIN field_data_review_cases c ON c.id = i."caseId" WHERE i."sampleId" = ${drawn.sampleId}`);
    assert.ok(codes.every((c) => c.reasonCodes.includes('backcheck-sample')));

    // The sample is marked as scheduled and drawn by no one.
    const samples = (await alice.get('/v1/projects/1/forms/simple/backcheck-samples').expect(200)).body;
    assert.deepEqual(samples.map((s) => [s.id, s.scheduled, s.drawnBy]), [[drawn.sampleId, true, null]]);
    assert.equal(samples[0].settings.periodStart, first.periodStart.toISOString());

    const view = (await alice.get(path).expect(200)).body;
    assert.deepEqual(view.runs.map((r) => [r.outcome, r.eligible, r.sampled, r.periods, r.sampleId]), [['drawn', 2, 2, 1, drawn.sampleId]]);
    assert.equal(view.schedule.periodStart, first.nextRunAt.toISOString());
    assert.equal(Date.parse(view.schedule.nextRunAt), first.nextRunAt.getTime() + day);

    // Running again in the same period does nothing.
    assert.deepEqual(await runBackcheckSchedules(container.db, at), []);
    // Even if the schedule were set back, the period is not drawn twice.
    await run(sql`UPDATE field_data_backcheck_schedules SET "periodStart" = ${first.periodStart.toISOString()}, "nextRunAt" = ${first.nextRunAt.toISOString()}`);
    await runBackcheckSchedules(container.db, at);
    assert.equal(await oneFirst(sql`SELECT count(*)::integer FROM field_data_backcheck_samples`), 1);
    assert.equal(await oneFirst(sql`SELECT count(*)::integer FROM field_data_backcheck_schedule_runs`), 1);

    // The next day had nothing received: recorded, no sample.
    const [empty] = await runBackcheckSchedules(container.db, new Date(at.getTime() + day));
    assert.deepEqual([empty.outcome, empty.sampleId], ['nothing-eligible', null]);
    assert.equal(await oneFirst(sql`SELECT count(*)::integer FROM field_data_backcheck_samples`), 1);

    // Run records are not changed.
    await run(sql`SAVEPOINT guard`);
    await assert.rejects(run(sql`UPDATE field_data_backcheck_schedule_runs SET outcome = 'failed'`), /not changed/);
    await run(sql`ROLLBACK TO SAVEPOINT guard`);
    const audits = await oneFirst(sql`SELECT count(*)::integer FROM audits WHERE action = 'field_data.backcheck_schedule.run'`);
    assert.equal(audits, 2);
  }));

  it('catches up over missed periods, records a draw too large, and skips what is off or deleted', testService(async (service, container) => {
    const { one, run, oneFirst } = container;
    const alice = await service.login('alice');
    await alice.put(path).send({ rate: 100, minPerCollector: 1, frequency: 'daily', enabled: true }).expect(200);
    await submit(alice, 'late0', 'late1');
    const first = await scheduleRow(one);
    // Received two days into the outage.
    await run(sql`UPDATE submissions SET "createdAt" = ${new Date(first.nextRunAt.getTime() + day + 3 * minute).toISOString()} WHERE "instanceId" = 'late1'`);

    // The runner was away for three periods: one draw covers them all.
    const at = new Date(first.nextRunAt.getTime() + 2 * day + 5 * minute);
    const [caught] = await runBackcheckSchedules(container.db, at);
    assert.deepEqual([caught.outcome, caught.periods, caught.sampled], ['drawn', 3, 2]);
    assert.equal(caught.periodEnd.getTime(), first.nextRunAt.getTime() + 2 * day);

    // Too large: recorded as failed with the count, and the schedule moves on.
    await submit(alice, 'big0', 'big1');
    await run(sql`UPDATE submissions SET "createdAt" = ${new Date(at.getTime() + 3 * minute).toISOString()} WHERE "instanceId" LIKE 'big%'`);
    const saved = LIMITS.maxSample;
    LIMITS.maxSample = 1;
    try {
      const [failed] = await runBackcheckSchedules(container.db, new Date(at.getTime() + day));
      assert.equal(failed.outcome, 'failed');
      assert.match(failed.error, /^2 submissions is more than the 1 allowed/);
    } finally {
      LIMITS.maxSample = saved;
    }
    assert.equal(await oneFirst(sql`SELECT count(*)::integer FROM field_data_backcheck_samples`), 1);
    assert.equal(await oneFirst(sql`SELECT count(*)::integer FROM field_data_backcheck_sample_items WHERE "instanceId" LIKE 'big%'`), 0);
    const view = (await alice.get(path).expect(200)).body;
    assert.deepEqual(view.runs.map((r) => r.outcome), ['failed', 'drawn']);

    // Off: not run, and no next run shown. On again: a new first period.
    await alice.put(path).send({ rate: 100, minPerCollector: 1, frequency: 'daily', enabled: false }).expect(200);
    assert.equal((await alice.get(path).expect(200)).body.schedule.nextRunAt, null);
    assert.deepEqual(await runBackcheckSchedules(container.db, new Date(at.getTime() + 10 * day)), []);
    const before = Date.now();
    const on = (await alice.put(path).send({ rate: 100, minPerCollector: 1, frequency: 'daily', enabled: true }).expect(200)).body;
    assert.ok(Date.parse(on.schedule.periodStart) >= before - minute && Date.parse(on.schedule.periodStart) <= Date.now() + minute);
    assert.equal(Date.parse(on.schedule.nextRunAt), nextBoundaryAfter(new Date(on.schedule.periodStart), 'daily').getTime());

    // A deleted form's schedule is not run.
    await alice.delete('/v1/projects/1/forms/simple').expect(200);
    assert.deepEqual(await runBackcheckSchedules(container.db, new Date(Date.now() + 10 * day)), []);
  }));

  it('retains configured group fields on migration rollback and safely recreates unused columns', testServiceFullTrx(async service => {
    const alice = await service.login('alice');
    await alice.put(path).send({ rate: 10, frequency: 'daily', enabled: true, groupField: '/name' }).expect(200);
    const migration = require('../../../lib/model/migrations/20261023-01-scheduled-answer-sampling');
    const db = knexConnect(config.get('test.database'));
    try {
      await db.transaction(async trx => {
        await migration.down(trx); await migration.up(trx);
        assert.equal((await trx.raw('SELECT "groupField" FROM field_data_backcheck_schedules')).rows[0].groupField, '/name');
        await trx.raw('UPDATE field_data_backcheck_schedules SET "groupField" = NULL');
        await migration.down(trx); await migration.up(trx);
        assert.equal((await trx.raw('SELECT "groupField" FROM field_data_backcheck_schedules')).rows[0].groupField, null);
      });
    } finally { await db.destroy(); }
  }));

  it('keeps schedules and their runs on a migration rollback', testServiceFullTrx(async (service) => {
    const alice = await service.login('alice');
    await alice.put(path).send({ rate: 10, frequency: 'daily', enabled: true }).expect(200);
    const db = knexConnect(config.get('test.database'));
    try {
      await db.transaction(async (trx) => {
        await scheduleMigration.down(trx);
        (await trx.raw('SELECT count(*)::integer AS n FROM field_data_backcheck_schedules')).rows[0].n.should.equal(1);
        await scheduleMigration.up(trx);
      });
    } finally { await db.destroy(); }
    (await alice.get(path).expect(200)).body.schedule.rate.should.equal(10);
  }));
  it('pauses when the configuring manager loses permission or the project is archived', testService(async (service, container) => {
    const alice = await service.login('alice'); const chelsea = await service.login('chelsea');
    const { id } = (await chelsea.get('/v1/users/current').expect(200)).body;
    await alice.post(`/v1/projects/1/assignments/manager/${id}`).expect(200);
    await chelsea.put(path).send({ rate: 100, frequency: 'daily', enabled: true }).expect(200);
    await submit(alice, 'revoked');
    const schedule = await scheduleRow(container.one);
    await container.run(sql`DELETE FROM assignments WHERE "actorId" = ${id}`);
    const [failed] = await runBackcheckSchedules(container.db, schedule.nextRunAt);
    assert.equal(failed.outcome, 'failed'); assert.match(failed.error, /Schedule paused/);
    assert.equal((await scheduleRow(container.one)).enabled, false);
    assert.equal(await container.oneFirst(sql`SELECT count(*)::integer FROM field_data_backcheck_samples`), 0);
    await alice.put(path).send({ rate: 100, frequency: 'daily', enabled: true }).expect(200);
    await container.run(sql`UPDATE projects SET archived = TRUE WHERE id = 1`);
    await runBackcheckSchedules(container.db, (await scheduleRow(container.one)).nextRunAt);
    assert.equal((await scheduleRow(container.one)).enabled, false);
  }));

  it('rolls back a failure after writes and retries the original period cleanly', testService(async (service, container) => {
    const alice = await service.login('alice');
    await alice.put(path).send({ rate: 100, frequency: 'daily', enabled: true, groupField: '/name' }).expect(200);
    await submit(alice, 'retry0', 'retry1');
    const first = await scheduleRow(container.one);
    const wrap = db => ({ ...db, transaction: callback => db.transaction(trx => callback(wrap(trx))), query: query => {
      if (query.sql.includes('INSERT INTO field_data_backcheck_sample_items')) throw new Error('injected failure');
      return db.query(query);
    } });
    assert.deepEqual(await runBackcheckSchedules(wrap(container.db), first.nextRunAt), []);
    assert.equal(await container.oneFirst(sql`SELECT count(*)::integer FROM field_data_backcheck_samples`), 0);
    assert.equal(await container.oneFirst(sql`SELECT count(*)::integer FROM field_data_backcheck_schedule_runs`), 0);
    assert.equal(await container.oneFirst(sql`SELECT count(*)::integer FROM field_data_review_cases WHERE "reasonCodes" @> '["backcheck-sample"]'::jsonb`), 0);
    assert.equal((await scheduleRow(container.one)).periodStart.toISOString(), first.periodStart.toISOString());
    const [result] = await runBackcheckSchedules(container.db, first.nextRunAt);
    assert.equal(result.outcome, 'drawn'); assert.equal(result.sampled, 2);
  }));

  it('draws nothing for a form deleted after its schedule was locked', testService(async (service, container) => {
    const alice = await service.login('alice');
    await alice.put(path).send({ rate: 100, frequency: 'daily', enabled: true }).expect(200);
    await submit(alice, 'gone0');
    const first = await scheduleRow(container.one);
    // The form is deleted just after the schedule row is read under its lock.
    const wrap = db => ({ ...db, transaction: callback => db.transaction(trx => callback(wrap(trx))), maybeOne: async (query) => {
      const row = await db.maybeOne(query);
      if (query.sql.includes('FROM field_data_backcheck_schedules b JOIN forms f'))
        await db.query(sql`UPDATE forms SET "deletedAt" = clock_timestamp() WHERE "xmlFormId" = 'simple' AND "projectId" = 1`);
      return row;
    } });
    assert.deepEqual(await runBackcheckSchedules(wrap(container.db), first.nextRunAt), []);
    assert.equal(await container.oneFirst(sql`SELECT count(*)::integer FROM field_data_backcheck_samples`), 0);
    assert.equal(await container.oneFirst(sql`SELECT count(*)::integer FROM field_data_backcheck_schedule_runs`), 0);
  }));

  it('serializes overlapping runners and manual draws without duplicate selections', testServiceFullTrx(async (service, container) => {
    const alice = await service.login('alice');
    await alice.put(path).send({ rate: 100, frequency: 'daily', enabled: true, groupField: '/name' }).expect(200);
    await submit(alice, 'overlap0', 'overlap1');
    const schedule = await scheduleRow(container.one);
    await Promise.all([
      runBackcheckSchedules(container.db, schedule.nextRunAt), runBackcheckSchedules(container.db, schedule.nextRunAt),
      alice.post('/v1/projects/1/forms/simple/backcheck-samples')
        .send({ requestId: '22222222-2222-4222-8222-222222222222', rate: 100 }).expect(201)
    ]);
    assert.equal(await container.oneFirst(sql`SELECT count(*)::integer FROM field_data_backcheck_schedule_runs`), 1);
    assert.equal(await container.oneFirst(sql`SELECT count(*)::integer FROM field_data_backcheck_sample_items`), 2);
  }));

  it('keeps the batch bounded and serves untouched schedules ahead of failed attempts', testService(async (service, container) => {
    const alice = await service.login('alice');
    await alice.put(path).send({ rate: 10, frequency: 'daily', enabled: true }).expect(200);
    for (let n = 0; n < 20; n += 1) {
      const xmlFormId = `fair${n}`;
      await alice.post('/v1/projects/1/forms?publish=true').send(testData.forms.simple.replace('id="simple"', `id="${xmlFormId}"`))
        .set('Content-Type', 'application/xml').expect(200);
      await alice.put(`/v1/projects/1/forms/${xmlFormId}/backcheck-schedule`).send({ rate: 10, frequency: 'daily', enabled: true }).expect(200);
    }
    await container.run(sql`UPDATE field_data_backcheck_schedules SET "periodStart" = '2026-01-01', "nextRunAt" = '2026-01-02'`);
    const broken = { ...container.db, transaction: async () => { throw new Error('injected connection failure'); } };
    assert.deepEqual(await runBackcheckSchedules(broken, new Date('2026-01-03')), []);
    const untouched = await container.all(sql`SELECT id FROM field_data_backcheck_schedules WHERE "lastAttemptAt" IS NULL`);
    assert.equal(untouched.length, 1);
    const results = await runBackcheckSchedules(container.db, new Date('2026-01-03'));
    assert.equal(results.length, 20);
    assert.ok(results.some(result => result.scheduleId === untouched[0].id));
  }));

});
