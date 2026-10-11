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
});
