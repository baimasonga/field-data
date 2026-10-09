// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { strict: assert } = require('assert');
const { sql } = require('slonik');
const { testService, testServiceFullTrx } = require('../setup');
const testData = require('../../data/xml');
const { generateReverification } = require('../../../lib/worker/field-data-reverification');

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tasks = '/v1/field-data/projects/1/reverification-tasks';
let counter = 1000;
const next = () => { counter += 1; return uuid(counter); };
const future = () => new Date(Date.now() + 7 * 86400000).toISOString();

// Alice manages the project. Collector and Other are App Users who may submit to
// the form; Unassigned is an App User with no access to it.
const setup = async (service, container) => {
  const alice = await service.login('alice');
  const make = async name => (await alice.post('/v1/projects/1/app-users').send({ displayName: name }).expect(200)).body;
  const collector = await make('Collector');
  const other = await make('Other');
  const unassigned = await make('Unassigned');
  await Promise.all([collector, other].map(user =>
    alice.post(`/v1/projects/1/forms/simple/assignments/app-user/${user.id}`).expect(200)));
  const root = '/v1/field-data/projects/1/assets';
  const asset = await alice.post(root).send({ requestId: next(), name: 'Water point', assetType: 'water-point',
    externalId: 'WP-01', xmlFormId: 'simple' }).expect(201);
  const submitAs = async (who, instance) => {
    if (who === alice) {
      await alice.post('/v1/projects/1/forms/simple/submissions').send(testData.instances.simple[instance])
        .set('Content-Type', 'application/xml').expect(200);
    } else {
      await service.post(`/v1/key/${who.token}/projects/1/forms/simple/submissions`)
        .send(testData.instances.simple[instance]).set('Content-Type', 'application/xml').expect(200);
    }
    return (await alice.get(`/v1/projects/1/forms/simple/submissions/${instance}/claim`).expect(200)).body.currentVersionId;
  };
  let { etag } = asset.headers;
  const observe = async (claimVersionId, over = {}) => {
    const response = await alice.post(`${root}/${asset.body.id}/observations`).set('If-Match', etag).send({
      requestId: next(), claimVersionId, predicate: 'condition', state: 'known', value: 'operating',
      validFrom: '2026-01-01T00:00:00Z', validityDays: 10, graceDays: 0, note: 'Recorded from the inspected original.', ...over
    }).expect(201);
    etag = response.headers.etag;
    return response.body.id;
  };
  const original = await observe(await submitAs(alice, 'one'));
  await generateReverification(container.db);
  const { items: [task] } = (await alice.get(tasks).expect(200)).body;
  return { alice, collector, other, unassigned, asset: asset.body, root, submitAs, observe, original, task,
    path: `${tasks}/${task.id}` };
};
const act = (alice, path, name, revision, body) => alice.post(`${path}/${name}`)
  .set('If-Match', `"task-${revision}"`).send({ requestId: next(), note: 'Visit the site.', ...body });
const dispatch = (ctx, revision, assignee, extra = {}) =>
  act(ctx.alice, ctx.path, 'dispatch', revision, { assigneeId: assignee.id, ...extra });

describe('api: re-verification dispatch and field closure', () => {
  it('dispatches to an App User, shows only visit instructions, and closes only on fresh collected evidence',
    testService(async (service, container) => {
      const ctx = await setup(service, container);
      const { alice, collector, other, unassigned, path } = ctx;
      assert.equal(ctx.task.status, 'queued');
      assert.equal(ctx.task.assignee, null);
      assert.equal(ctx.task.revision, 1);
      assert.equal((await alice.get(tasks).expect(200)).body.allowed, true);
      await service.login('chelsea').then(chelsea => chelsea.get(tasks).expect(404));
      await alice.get(`${tasks}?status=bogus`).expect(400);
      await alice.get(`${tasks}?cursor=nonsense`).expect(400);
      assert.equal((await alice.get(`${tasks}?status=dispatched`).expect(200)).body.items.length, 0);

      // Input and authority checks.
      await alice.post(`${path}/dispatch`).send({ requestId: next(), assigneeId: collector.id, note: 'Go.' }).expect(428);
      await dispatch(ctx, 7, collector).expect(412);
      await dispatch(ctx, 1, unassigned).expect(400);
      await dispatch(ctx, 1, { id: (await alice.get('/v1/users/current').expect(200)).body.id }).expect(400);
      await dispatch(ctx, 1, { id: 999999 }).expect(400);
      await dispatch(ctx, 1, { id: 2147483648 }).expect(400);
      await dispatch(ctx, 1, { id: 9007199254740991 }).expect(400);
      await dispatch(ctx, 1, collector, { visitBy: '2020-01-01T00:00:00Z' }).expect(400);
      await dispatch(ctx, 1, collector, { surprise: true }).expect(400);
      await alice.post(`${path}/dispatch`).set('If-Match', '"task-1"')
        .send({ requestId: next(), assigneeId: collector.id, note: '   ' }).expect(400);

      // Receipt before dispatch must not count, even from the right collector.
      const early = await ctx.submitAs(collector, 'two');
      const body = { requestId: uuid(500), assigneeId: collector.id, visitBy: future(), note: 'Check the pump handle.' };
      const dispatched = await alice.post(`${path}/dispatch`).set('If-Match', '"task-1"').send(body).expect(200);
      assert.equal(dispatched.body.status, 'dispatched');
      assert.equal(dispatched.body.revision, 2);
      assert.equal(dispatched.headers.etag, '"task-2"');
      assert.equal(dispatched.headers['cache-control'], 'private, no-store');
      const replay = await alice.post(`${path}/dispatch`).set('If-Match', '"task-1"').send(body).expect(200);
      assert.equal(replay.headers['idempotency-status'], 'replayed');
      assert.equal(replay.body.revision, 2, 'a replay does not advance the task');
      await alice.post(`${path}/dispatch`).set('If-Match', '"task-1"')
        .send({ ...body, note: 'A different instruction.' }).expect(400);

      // The collector sees the instruction and nothing about the earlier answer.
      const inbox = '/v1/field-data/app-user/reverification';
      const asApp = (user) => service.get(inbox).set('Authorization', `Bearer ${user.token}`);
      const mine = (await asApp(collector).expect(200)).body;
      assert.equal(mine.items.length, 1);
      assert.deepEqual(Object.keys(mine.items[0]).sort(), ['actionable', 'assetName', 'assetType', 'dispatchedAt',
        'externalId', 'formName', 'id', 'instruction', 'predicate', 'visitBy', 'xmlFormId']);
      assert.equal(mine.items[0].instruction, 'Check the pump handle.');
      assert.equal(mine.items[0].actionable, true);
      assert.equal(JSON.stringify(mine).includes('operating'), false, 'the earlier value must not reach the collector');
      assert.equal((await asApp(other).expect(200)).body.items.length, 0);
      assert.equal((await asApp(unassigned).expect(200)).body.items.length, 0);
      await alice.get(inbox).expect(403);
      await service.get(inbox).expect(401);

      // Every closure rejection names its reason.
      const reject = async (observationId, reason) => {
        const detail = (await alice.get(path).expect(200)).body;
        const response = await act(alice, path, 'close', detail.task.revision, { observationId }).expect(409);
        assert.match(response.body.message, new RegExp(reason), `expected ${reason}, got ${response.body.message}`);
      };
      await reject(ctx.original, 'not-newer-than-the-expired-observation');
      await reject(await ctx.observe(early, { validFrom: new Date().toISOString(), validityDays: 90 }), 'received-before-dispatch');
      await reject(await ctx.observe(await ctx.submitAs(ctx.alice, 'three'),
        { validFrom: new Date().toISOString(), validityDays: 90 }), 'not-submitted-by-the-assignee');
      await reject(await ctx.observe(early, { predicate: 'other-fact', validFrom: new Date().toISOString(), validityDays: 90 }), 'different-fact');
      await reject(uuid(999), 'observation-not-on-this-asset');
      assert.equal((await alice.get(path).expect(200)).body.task.status, 'dispatched', 'rejections leave the task untouched');
      assert.equal((await alice.get(path).expect(200)).body.events.length, 1);
    }));

  it('closes with a real visit submission and preserves the full history', testService(async (service, container) => {
    const ctx = await setup(service, container);
    const { alice, collector, path } = ctx;
    await dispatch(ctx, 1, collector).expect(200);
    const claim = await ctx.submitAs(collector, 'two');
    const detail = (await alice.get(path).expect(200)).body;
    assert.deepEqual(detail.candidates.map(c => c.claimVersionId), [claim]);
    assert.equal(detail.candidates[0].instanceId, 'two');
    const fresh = await ctx.observe(claim, { validFrom: new Date().toISOString(), validityDays: 90, value: 'needs repair' });

    // A submission whose stored XML no longer matches its recorded hash is not evidence.
    const [{ xml }] = await container.db.any(sql`SELECT xml FROM submission_defs
      WHERE id = (SELECT "submissionDefId" FROM field_data_claim_versions WHERE id = ${claim})`);
    await container.db.query(sql`UPDATE submission_defs SET xml = xml || ' '
      WHERE id = (SELECT "submissionDefId" FROM field_data_claim_versions WHERE id = ${claim})`);
    const tampered = await act(alice, path, 'close', detail.task.revision, { observationId: fresh }).expect(409);
    assert.match(tampered.body.message, /integrity-unverified/);
    await container.db.query(sql`UPDATE submission_defs SET xml = ${xml}
      WHERE id = (SELECT "submissionDefId" FROM field_data_claim_versions WHERE id = ${claim})`);

    // Provenance other than "collected" is refused, then restored.
    await container.db.query(sql`UPDATE field_data_submission_provenance SET origin = 'imported'
      WHERE "submissionDefId" = (SELECT "submissionDefId" FROM field_data_claim_versions WHERE id = ${claim})`);
    const refused = await act(alice, path, 'close', detail.task.revision, { observationId: fresh }).expect(409);
    assert.match(refused.body.message, /not-collected-in-the-field/);
    await container.db.query(sql`UPDATE field_data_submission_provenance SET origin = 'collected'
      WHERE "submissionDefId" = (SELECT "submissionDefId" FROM field_data_claim_versions WHERE id = ${claim})`);

    const closed = await act(alice, path, 'close', detail.task.revision, { observationId: fresh, note: 'Collector visit received.' }).expect(200);
    assert.equal(closed.body.status, 'closed');
    assert.equal(closed.body.revision, detail.task.revision + 1);
    const after = (await alice.get(path).expect(200)).body;
    assert.equal(after.task.status, 'closed');
    assert.equal(after.task.closureObservationId, fresh);
    assert.deepEqual(after.events.map(e => e.action), ['dispatch', 'close']);
    assert.equal(after.candidates.length, 0);
    // Closed tasks are final; the earlier observation is untouched.
    await act(alice, path, 'close', after.task.revision, { observationId: fresh }).expect(409);
    await act(alice, path, 'dispatch', after.task.revision, { assigneeId: collector.id }).expect(409);
    await act(alice, path, 'cancel', after.task.revision, { reasonCode: 'other' }).expect(409);
    const { history } = (await alice.get(`${ctx.root}/${ctx.asset.id}`).expect(200)).body;
    assert.equal(history.length, 2);
    assert(history.some(row => row.id === ctx.original && row.value === 'operating'));
    const audits = await container.db.any(sql`SELECT action FROM audits WHERE action LIKE 'field_data.asset.task.%' ORDER BY id`);
    assert.deepEqual(audits.map(a => a.action), ['field_data.asset.task.dispatch', 'field_data.asset.task.close']);
    // The collector no longer sees a finished visit.
    assert.equal((await service.get('/v1/field-data/app-user/reverification')
      .set('Authorization', `Bearer ${collector.token}`).expect(200)).body.items.length, 0);
  }));

  it('reassigns, cancels without claiming a visit, survives the worker, and respects access changes',
    testService(async (service, container) => {
      const ctx = await setup(service, container);
      const { alice, collector, other, path } = ctx;
      const first = await dispatch(ctx, 1, collector).expect(200);
      const firstDispatchedAt = (await alice.get(path).expect(200)).body.task.dispatchedAt;

      // Same collector, new deadline: keeps the evidence clock. Different collector: restarts it.
      const deadline = await dispatch(ctx, first.body.revision, collector, { visitBy: future() }).expect(200);
      assert.equal((await alice.get(path).expect(200)).body.task.dispatchedAt, firstDispatchedAt);
      await new Promise((resolve) => { setTimeout(resolve, 15); });
      const moved = await dispatch(ctx, deadline.body.revision, other).expect(200);
      const detail = (await alice.get(path).expect(200)).body;
      assert(new Date(detail.task.dispatchedAt) > new Date(firstDispatchedAt));
      assert.equal(detail.task.assignee.displayName, 'Other');
      assert.deepEqual(detail.events.map(e => e.action), ['dispatch', 'reassign', 'reassign']);
      assert.equal((await service.get('/v1/field-data/app-user/reverification')
        .set('Authorization', `Bearer ${collector.token}`).expect(200)).body.items.length, 0);

      // The K1 worker never supersedes dispatched work, even after a newer observation.
      await ctx.observe(await ctx.submitAs(alice, 'three'), { validFrom: new Date().toISOString(), validityDays: 90 });
      await generateReverification(container.db);
      assert.equal((await alice.get(path).expect(200)).body.task.status, 'dispatched');

      // Revoking submit access removes the instruction from the collector.
      await alice.delete(`/v1/projects/1/forms/simple/assignments/app-user/${other.id}`).expect(200);
      assert.equal((await service.get('/v1/field-data/app-user/reverification')
        .set('Authorization', `Bearer ${other.token}`).expect(200)).body.items.length, 0);
      await dispatch(ctx, moved.body.revision, other).expect(400);

      // Cancellation needs a reason code and records no visit.
      await act(alice, path, 'cancel', moved.body.revision, { reasonCode: 'weather' }).expect(400);
      const cancelled = await act(alice, path, 'cancel', moved.body.revision,
        { reasonCode: 'access-blocked', note: 'Road washed out; no visit made.' }).expect(200);
      assert.equal(cancelled.body.status, 'cancelled');
      const final = (await alice.get(path).expect(200)).body;
      assert.equal(final.task.closureObservationId, null);
      assert.equal(final.events[final.events.length - 1].reasonCode, 'access-blocked');
      assert.equal((await alice.get(`${tasks}?status=cancelled`).expect(200)).body.items.length, 1);

      // A viewer can read but not write; another project cannot see the task at all.
      const chelsea = await service.login('chelsea');
      const viewerId = (await chelsea.get('/v1/users/current').expect(200)).body.id;
      await alice.post(`/v1/projects/1/assignments/viewer/${viewerId}`).expect(200);
      assert.equal((await chelsea.get(tasks).expect(200)).body.allowed, false);
      await act(chelsea, path, 'dispatch', 1, { assigneeId: collector.id }).expect(404);
      const project = (await alice.post('/v1/projects').send({ name: 'Elsewhere' }).expect(200)).body;
      await alice.get(`/v1/field-data/projects/${project.id}/reverification-tasks/${ctx.task.id}`).expect(404);
      await alice.get(`${tasks}/${uuid(404)}`).expect(404);
      await alice.get(`${tasks}/not-a-uuid`).expect(404);
    }));

  it('summarises the project queue, filters overdue work and collectors, and counts only work the caller may read',
    testService(async (service, container) => {
      const ctx = await setup(service, container);
      const { alice, collector, other } = ctx;
      const summary = async (agent = alice) => (await agent.get(`${tasks}/summary`).expect(200)).body;
      const empty = { queued: 1, dispatched: 0, closed: 0, cancelled: 0, superseded: 0, overdue: 0 };
      assert.deepEqual((await summary()).counts, empty);
      assert.deepEqual((await summary()).workload, []);

      await dispatch(ctx, 1, collector, { visitBy: future() }).expect(200);
      let now = await summary();
      assert.deepEqual(now.counts, { ...empty, queued: 0, dispatched: 1 });
      assert.deepEqual(now.workload, [{ assignee: { id: collector.id, displayName: 'Collector' }, open: 1, overdue: 0 }]);
      assert.equal(now.truncated, false);
      assert.equal((await alice.get(`${tasks}?overdue=true`).expect(200)).body.items.length, 0, 'a future deadline is not overdue');

      // Overdue is derived from the deadline, never stored.
      await container.db.query(sql`UPDATE field_data_reverification_tasks SET "visitBy" = clock_timestamp() - interval '1 day'`);
      now = await summary();
      assert.equal(now.counts.overdue, 1);
      assert.deepEqual(now.workload.map(row => [row.open, row.overdue]), [[1, 1]]);
      const overdue = (await alice.get(`${tasks}?overdue=true`).expect(200)).body.items;
      assert.equal(overdue.length, 1);
      assert.equal(overdue[0].overdue, true);
      assert.equal((await alice.get(`${tasks}?overdue=false`).expect(200)).body.items.length, 1, 'false means no filter');

      // Collector and status filters combine.
      const query = (qs) => alice.get(`${tasks}?${qs}`).expect(200).then(response => response.body.items.length);
      assert.equal(await query(`assigneeId=${collector.id}`), 1);
      assert.equal(await query(`assigneeId=${other.id}`), 0);
      assert.equal(await query(`assigneeId=${collector.id}&status=dispatched&overdue=true`), 1);
      assert.equal(await query(`assigneeId=${collector.id}&status=queued`), 0);
      assert.equal(await query('status=closed&overdue=true'), 0);

      // A bad filter is refused rather than ignored.
      await Promise.all(['overdue=maybe', 'assigneeId=abc', 'assigneeId=0', 'assigneeId=-3', 'assigneeId=1.5', 'assigneeId=99999999999',
        'assigneeId=2147483648', 'assigneeId=9999999999']
        .map(bad => alice.get(`${tasks}?${bad}`).expect(400)));

      // Access: a caller who can open the project but not read its submissions sees nothing,
      // and a caller with no project access cannot tell the queue exists.
      const chelsea = await service.login('chelsea');
      const chelseaId = (await chelsea.get('/v1/users/current').expect(200)).body.id;
      await chelsea.get(`${tasks}/summary`).expect(404);
      await alice.post(`/v1/projects/1/assignments/formfill/${chelseaId}`).expect(200);
      const blind = await chelsea.get(`${tasks}/summary`).expect(200);
      assert.deepEqual(blind.body.counts, { queued: 0, dispatched: 0, closed: 0, cancelled: 0, superseded: 0, overdue: 0 });
      assert.deepEqual(blind.body.workload, []);
      assert.deepEqual((await chelsea.get(tasks).expect(200)).body.items, []);
      // The case the early return above cannot reach: a caller who may read SOME forms. Give the
      // project a second task on another form, and let this caller read only that form.
      await alice.post('/v1/projects/1/forms?publish=true').send(testData.forms.simple2)
        .set('Content-Type', 'application/xml').expect(200);
      const second = await alice.post(ctx.root).send({ requestId: next(), name: 'Pump', assetType: 'pump',
        externalId: 'PU-01', xmlFormId: 'simple2' }).expect(201);
      await alice.post('/v1/projects/1/forms/simple2/submissions').send(testData.instances.simple2.one)
        .set('Content-Type', 'application/xml').expect(200);
      const claim2 = (await alice.get('/v1/projects/1/forms/simple2/submissions/s2one/claim').expect(200)).body.currentVersionId;
      await alice.post(`${ctx.root}/${second.body.id}/observations`).set('If-Match', second.headers.etag).send({
        requestId: next(), claimVersionId: claim2, predicate: 'condition', state: 'known', value: 'working',
        validFrom: '2026-01-01T00:00:00Z', validityDays: 10, graceDays: 0, note: 'Recorded from the inspected original.'
      }).expect(201);
      await generateReverification(container.db);
      assert.equal((await alice.get(tasks).expect(200)).body.items.length, 2, 'the manager sees both forms');
      assert.equal((await summary()).counts.queued, 1);
      await alice.post(`/v1/projects/1/forms/simple2/assignments/viewer/${chelseaId}`).expect(200);
      const partial = (await chelsea.get(tasks).expect(200)).body.items;
      assert.deepEqual(partial.map(task => [task.xmlFormId, task.externalId]), [['simple2', 'PU-01']],
        'only the readable form\'s task is listed, and the page is not short-changed');
      const partialSummary = await summary(chelsea);
      assert.deepEqual(partialSummary.counts, { queued: 1, dispatched: 0, closed: 0, cancelled: 0, superseded: 0, overdue: 0 },
        'counts describe only readable work, not the overdue dispatched task on the other form');
      assert.deepEqual(partialSummary.workload, [], 'a collector\'s open work on a form the caller cannot read is not revealed');
      assert.deepEqual(partialSummary.collectors, [], 'nor are the names of collectors who only work on forms the caller cannot read');
      assert.equal((await chelsea.get(`${tasks}?overdue=true`).expect(200)).body.items.length, 0);
      assert.equal((await chelsea.get(`${tasks}?assigneeId=${collector.id}`).expect(200)).body.items.length, 0);
      await alice.delete(`/v1/projects/1/forms/simple2/assignments/viewer/${chelseaId}`).expect(200);
      // Cancelling removes work from the open count and keeps the history count.
      const detail = (await alice.get(ctx.path).expect(200)).body;
      await act(alice, ctx.path, 'cancel', detail.task.revision, { reasonCode: 'access-blocked' }).expect(200);
      now = await summary();
      assert.deepEqual(now.counts, { ...empty, queued: 1, cancelled: 1 }); // the second form's task is still queued
      assert.deepEqual(now.workload, []);
      // ...but the collector who held the cancelled task can still be chosen as a filter.
      assert.deepEqual(now.collectors, [{ id: collector.id, displayName: 'Collector' }]);
      assert.equal((await alice.get(`${tasks}?assigneeId=${collector.id}&status=cancelled`).expect(200)).body.items.length, 1);

      await alice.delete(`/v1/projects/1/assignments/formfill/${chelseaId}`).expect(200);
      await alice.post(`/v1/projects/1/assignments/viewer/${chelseaId}`).expect(200);
      assert.equal((await chelsea.get(`${tasks}/summary`).expect(200)).body.counts.cancelled, 1);
      assert.equal((await chelsea.get(tasks).expect(200)).body.allowed, false);
      assert.equal((await alice.get(tasks).expect(200)).body.allowed, true);
      const elsewhere = (await alice.post('/v1/projects').send({ name: 'Elsewhere queue' }).expect(200)).body;
      assert.deepEqual((await alice.get(`/v1/field-data/projects/${elsewhere.id}/reverification-tasks/summary`).expect(200)).body.workload, []);
      await alice.get('/v1/field-data/projects/abc/reverification-tasks/summary').expect(404);
    }));

  it('does not close a task on a source submission that is being deleted at the same moment',
    testServiceFullTrx(async (service, container) => {
      const ctx = await setup(service, container);
      const { alice, collector, path } = ctx;
      await dispatch(ctx, 1, collector).expect(200);
      const claim = await ctx.submitAs(collector, 'two');
      const fresh = await ctx.observe(claim, { validFrom: new Date().toISOString(), validityDays: 90 });
      const { revision } = (await alice.get(path).expect(200)).body.task;

      // A deletion of the source is in flight: its transaction has updated the row
      // but not yet committed. The closure must wait for it, then see the deletion.
      let commitDeletion;
      const held = new Promise((resolve) => { commitDeletion = resolve; });
      let deleting;
      const deletionStarted = new Promise((resolve) => {
        deleting = container.db.transaction(async (tx) => {
          await tx.query(sql`UPDATE submissions SET "deletedAt" = clock_timestamp() WHERE "instanceId" = 'two'`);
          resolve();
          await held;
        });
      });
      await deletionStarted;

      let finished = false;
      const closing = act(alice, path, 'close', revision, { observationId: fresh }).then((response) => {
        finished = true;
        return response;
      });
      let response;
      try {
        await new Promise((resolve) => { setTimeout(resolve, 400); });
        assert.equal(finished, false, 'closing must wait for the in-flight deletion instead of racing it');
      } finally {
        // Always release the deletion, so a failed assertion cannot leave a transaction open.
        commitDeletion();
        await deleting;
        response = await closing;
      }
      assert.equal(response.status, 409);
      assert.match(response.body.message, /source-unavailable/);
      const [row] = await container.db.any(sql`SELECT status, "closureObservationId" FROM field_data_reverification_tasks
        WHERE id = ${ctx.task.id}`);
      assert.equal(row.status, 'dispatched');
      assert.equal(row.closureObservationId, null);
    }));

  it('serialises concurrent writers and keeps events append-only', testServiceFullTrx(async (service, container) => {
    const ctx = await setup(service, container);
    const { alice, collector, path } = ctx;
    const results = await Promise.all([
      dispatch(ctx, 1, collector),
      act(alice, path, 'cancel', 1, { reasonCode: 'duplicate' })
    ]);
    const statuses = results.map(r => r.status).sort();
    assert.equal(statuses[0], 200, 'exactly one writer wins');
    assert([409, 412].includes(statuses[1]), `the loser is told the task changed, got ${statuses[1]}`);
    const events = await container.db.any(sql`SELECT id, sequence FROM field_data_reverification_task_events`);
    assert.equal(events.length, 1);
    await assert.rejects(container.db.query(sql`UPDATE field_data_reverification_task_events SET note = 'edited'`),
      error => /append-only/.test(error.message));
    await assert.rejects(container.db.query(sql`DELETE FROM field_data_reverification_task_events`),
      error => /append-only/.test(error.message));
    await assert.rejects(container.db.query(sql`UPDATE field_data_reverification_tasks SET status = 'closed' WHERE id = ${ctx.task.id}`),
      error => /state_check/.test(error.message));
  }));
});
