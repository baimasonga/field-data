require('should');
const assert = require('node:assert/strict');
const { sql } = require('slonik');
const { testService, testServiceFullTrx } = require('../setup');
const testData = require('../../data/xml');
const { runAllocations } = require('../../../lib/worker/field-data-backcheck-allocation');
/* eslint-disable no-await-in-loop */
const base = '/v1/projects/1/forms/simple';
const path = `${base}/backcheck-allocation`;
const defaults = { enabled: true, responseXmlFormId: 'responses', question: 'Verify this visit independently.', dueDays: 7, maxPending: 2, collectorLimits: [] };
const setup = async (service, count = 6) => {
  const alice = await service.login('alice');
  await alice.post('/v1/projects/1/forms?publish=true').send(testData.forms.simple.replace('id="simple"', 'id="responses"'))
    .set('Content-Type', 'application/xml').expect(200);
  const users = [];
  for (const name of ['Original', 'Checker B', 'Checker C']) {
    const user = (await alice.post('/v1/projects/1/app-users').send({ displayName: name }).expect(200)).body;
    await alice.post(`/v1/projects/1/forms/responses/assignments/app-user/${user.id}`).expect(200);
    users.push(user);
  }
  await alice.post(`${base}/assignments/app-user/${users[0].id}`).expect(200);
  for (let n = 0; n < count; n += 1)
    await service.post(`/v1/key/${users[0].token}/projects/1/forms/simple/submissions`)
      .send(testData.instances.simple.one.replace('one</instanceID>', `source${n}</instanceID>`))
      .set('Content-Type', 'application/xml').expect(200);
  await alice.post(`${base}/backcheck-samples`).send({ requestId: '11111111-1111-4111-8111-111111111111', rate: 100 }).expect(201);
  return { alice, users };
};
const save = (user, changes = {}) => user.put(path).send({ ...defaults, ...changes }).expect(200);
const checks = container => container.all(sql`SELECT * FROM field_data_backchecks ORDER BY "createdAt", id`);
const view = async alice => (await alice.get(path).expect(200)).body;
describe('api: automatic independent backcheck allocation', () => {
  it('balances independent requests within capacity, exposes the inbox, retries safely and respects cancellation', testService(async (service, container) => {
    const { alice, users } = await setup(service);
    await save(alice);
    const now = new Date('2026-10-14T12:00:00Z');
    await runAllocations(container.db, now);
    const rows = await checks(container);
    assert.equal(rows.length, 4);
    assert.ok(rows.every(r => r.assignedTo !== users[0].id && r.status === 'requested' && r.dueAt.toISOString() === '2026-10-21T12:00:00.000Z'));
    assert.equal(rows.filter(r => r.assignedTo === users[1].id).length, 2);
    assert.equal(rows.filter(r => r.assignedTo === users[2].id).length, 2);
    const { report } = (await view(alice)).policy;
    assert.equal(report.assigned, 4); assert.equal(report.atCapacity, 2);
    const inbox = (await service.get('/v1/field-data/app-user/backchecks').set('Authorization', `Bearer ${users[1].token}`).expect(200)).body;
    assert.equal(inbox.items.length, 2); assert.ok(inbox.items.every(i => i.actionable && i.question.includes('Source submission: source')));
    await runAllocations(container.db, now);
    assert.equal((await checks(container)).length, 4);
    const first = rows.find(r => r.assignedTo === users[1].id);
    const detail = await alice.get(`/v1/field-data/review-queue/${first.caseId}`).expect(200);
    await alice.post(`/v1/field-data/review-queue/${first.caseId}/backchecks/${first.id}/cancel`)
      .set('If-Match', detail.headers.etag).send({ requestId: '22222222-2222-4222-8222-222222222222', reason: 'Collector unavailable for this visit.' }).expect(200);
    await runAllocations(container.db, now);
    assert.equal((await checks(container)).length, 5);
    assert.equal((await checks(container)).filter(r => r.caseId === first.caseId).length, 1);
    assert.equal(await container.oneFirst(sql`SELECT count(*)::integer FROM audits WHERE action = 'field_data.backcheck.request'`), 5);
    assert.equal(await container.oneFirst(sql`SELECT count(*)::integer FROM field_data_review_cases WHERE status = 'in-review'`), 5);
  }));
  it('applies collector overrides, leaves blocked cases unclaimed and uses capacity freed by a linked response', testService(async (service, container) => {
    const { alice, users } = await setup(service, 2);
    await save(alice, { maxPending: 0, collectorLimits: [{ actorId: users[1].id, maxPending: 1 }] });
    await runAllocations(container.db);
    const [first] = await checks(container);
    assert.equal(first.assignedTo, users[1].id);
    assert.equal(await container.oneFirst(sql`SELECT count(*)::integer FROM field_data_review_cases WHERE status = 'open'`), 1);
    await service.post(`/v1/key/${users[1].token}/projects/1/forms/responses/submissions`)
      .send(testData.instances.simple.one.replace('id="simple"', 'id="responses"').replace('one</instanceID>', 'response1</instanceID>'))
      .set('Content-Type', 'application/xml').expect(200);
    const detail = await alice.get(`/v1/field-data/review-queue/${first.caseId}`).expect(200);
    await alice.post(`/v1/field-data/review-queue/${first.caseId}/backchecks/${first.id}/link`)
      .set('If-Match', detail.headers.etag).send({ instanceId: 'response1' }).expect(200);
    await runAllocations(container.db);
    assert.equal((await checks(container)).length, 2);
    assert.equal((await checks(container)).filter(r => r.status === 'requested').length, 1);
  }));
  it('rolls back an injected failure after writes and retries without duplicate claims or requests', testService(async (service, container) => {
    const { alice } = await setup(service, 2); await save(alice);
    const wrap = db => ({ ...db, transaction: callback => db.transaction(trx => callback(wrap(trx))), query: q => {
      if (q.sql.includes('INSERT INTO audits') && q.sql.includes('field_data.backcheck.request')) throw new Error('injected failure');
      return db.query(q);
    } });
    await runAllocations(wrap(container.db));
    assert.equal((await checks(container)).length, 0);
    assert.equal(await container.oneFirst(sql`SELECT count(*)::integer FROM field_data_review_cases WHERE status = 'in-review'`), 0);
    assert.match((await view(alice)).policy.report.failure, /retry/);
    await runAllocations(container.db);
    assert.equal((await checks(container)).length, 2);
    assert.equal(await container.oneFirst(sql`SELECT count(*)::integer FROM audits WHERE action = 'field_data.backcheck.request'`), 2);
  }));
  it('serializes overlapping allocation runs and applies current capacity to the whole project', testServiceFullTrx(async (service, container) => {
    const { alice } = await setup(service, 6); await save(alice, { maxPending: 1 });
    await Promise.all([runAllocations(container.db), runAllocations(container.db)]);
    assert.equal((await checks(container)).length, 2);
  }));
  it('enforces manager configuration, refuses invalid scope and pauses revoked or closed response access', testService(async (service, container) => {
    const { alice, users } = await setup(service, 2);
    const chelsea = await service.login('chelsea'); const { id } = (await chelsea.get('/v1/users/current').expect(200)).body;
    await chelsea.get(path).expect(403);
    await alice.post(`/v1/projects/1/assignments/viewer/${id}`).expect(200);
    await chelsea.get(path).expect(200);
    await chelsea.put(path).send(defaults).expect(403);
    await service.get(path).set('Authorization', `Bearer ${users[0].token}`).expect(403);
    for (const changes of [{ maxPending: -1 }, { question: '' }, { dueDays: 0 }, { collectorLimits: [{ actorId: id, maxPending: 2 }] }])
      await alice.put(path).send({ ...defaults, ...changes }).expect(400);
    await alice.put(path).send({ ...defaults, responseXmlFormId: 'missing' }).expect(404);
    await alice.post(`/v1/projects/1/assignments/manager/${id}`).expect(200);
    await save(chelsea);
    await container.run(sql`DELETE FROM assignments WHERE "actorId" = ${id}`);
    await runAllocations(container.db);
    assert.equal((await view(alice)).policy.enabled, false);
    assert.equal((await checks(container)).length, 0);
    await save(alice);
    await alice.patch('/v1/projects/1/forms/responses').send({ state: 'closed' }).expect(200);
    await runAllocations(container.db);
    assert.equal((await view(alice)).policy.enabled, false);
  }));
  it('counts manual requests against automatic capacity and never takes another reviewer or inactive case', testService(async (service, container) => {
    const { alice, users } = await setup(service, 5);
    const cases = await container.all(sql`SELECT c.id, s."instanceId" FROM field_data_review_cases c
      JOIN field_data_claim_versions v ON v.id = c."claimVersionId" JOIN submission_defs sd ON sd.id = v."submissionDefId"
      JOIN submissions s ON s.id = sd."submissionId" ORDER BY s."instanceId"`);
    const actorId = (await alice.get('/v1/users/current').expect(200)).body.id;
    const claim = async (user, item, id) => {
      const detail = await user.get(`/v1/field-data/review-queue/${item.id}`).expect(200);
      return user.patch(`/v1/field-data/review-queue/${item.id}/assignment`).set('If-Match', detail.headers.etag)
        .set('Idempotency-Key', `manual-${item.id}`).send({ assignedTo: id, status: 'in-review' })
        .expect(200);
    };
    const assigned = await claim(alice, cases[0], actorId);
    await alice.post(`/v1/field-data/review-queue/${cases[0].id}/backchecks`).set('If-Match', assigned.headers.etag)
      .send({ requestId: '33333333-3333-4333-8333-333333333333', assignedTo: users[1].id, responseXmlFormId: 'responses', question: 'Manual check.' }).expect(201);
    await container.run(sql`UPDATE submissions SET "deletedAt" = now() WHERE "instanceId" = 'source1'`);
    await container.run(sql`UPDATE field_data_review_cases SET status = 'resolved', "resolvedAt" = now() WHERE id = ${cases[2].id}`);
    const chelsea = await service.login('chelsea'); const { id } = (await chelsea.get('/v1/users/current').expect(200)).body;
    await alice.post(`/v1/projects/1/assignments/manager/${id}`).expect(200);
    await claim(chelsea, cases[3], id);
    await save(alice, { maxPending: 1 });
    await runAllocations(container.db);
    const rows = await checks(container);
    assert.equal(rows.length, 2); assert.equal(rows[1].assignedTo, users[2].id);
    assert.equal(rows[1].caseId, cases[4].id);
    assert.equal((await container.one(sql`SELECT "assignedTo" FROM field_data_review_cases WHERE id = ${cases[3].id}`)).assignedTo, id);
  }));

  it('leaves cases waiting with no independent checker and rotates beyond a blocked batch', testService(async (service, container) => {
    const { alice, users } = await setup(service, 101);
    await container.run(sql`DELETE FROM assignments WHERE "actorId" = ANY(${sql.array([users[1].id, users[2].id], 'int4')})`);
    const latest = await container.one(sql`SELECT c.id, s.id AS "submissionId" FROM field_data_backcheck_sample_items i
      JOIN field_data_review_cases c ON c.id = i."caseId" JOIN field_data_claim_versions v ON v.id = c."claimVersionId"
      JOIN submission_defs sd ON sd.id = v."submissionDefId" JOIN submissions s ON s.id = sd."submissionId" ORDER BY c.id DESC LIMIT 1`);
    // Fixture the last case as a submission from another collector: only the
    // first collector can check it; the preceding 100 have no independent checker.
    await container.run(sql`UPDATE submissions SET "submitterId" = ${users[1].id} WHERE id = ${latest.submissionId}`);
    await save(alice);
    await runAllocations(container.db);
    assert.equal((await checks(container)).length, 0);
    assert.equal((await view(alice)).policy.report.noIndependentCollector, 100);
    await runAllocations(container.db);
    const rows = await checks(container);
    assert.equal(rows.length, 1); assert.equal(rows[0].caseId, latest.id); assert.equal(rows[0].assignedTo, users[0].id);
    await runAllocations(container.db);
    assert.equal((await view(alice)).policy.report.examined, 100);
  }));

  it('does not allocate unsampled or non-current submissions and keeps configured policy on rollback', testServiceFullTrx(async (service, container) => {
    const { alice } = await setup(service, 1);
    await alice.post(`${base}/submissions`).send(testData.instances.simple.one.replace('one</instanceID>', 'unsampled</instanceID>'))
      .set('Content-Type', 'application/xml').expect(200);
    await container.run(sql`UPDATE submission_defs sd SET current = FALSE FROM submissions s
      WHERE s.id = sd."submissionId" AND s."instanceId" = 'source0'`);
    await save(alice);
    await runAllocations(container.db);
    assert.equal((await checks(container)).length, 0);
    const { knexConnect } = require('../../../lib/model/knex-migrator');
    const migration = require('../../../lib/model/migrations/20261013-01-add-backcheck-allocation');
    const db = knexConnect(require('config').get('test.database'));
    try {
      await db.transaction(async trx => { await migration.down(trx); await migration.up(trx); });
      assert.equal((await view(alice)).policy.enabled, true);
    } finally { await db.destroy(); }
  }));

});
