/* eslint-disable no-await-in-loop */
// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { sql } = require('slonik');
const { testService, testServiceFullTrx } = require('../setup');
const xml = require('../../data/xml');
const root = '/v1/projects/1/investigations';
const reason = 'These cases concern the same reported pattern.';
const linkBody = caseId => ({ requestId: randomUUID(), caseId, reason });
const setup = async service => {
  const alice = await service.login('alice');
  await alice.post('/v1/projects/1/forms/simple/submissions').set('Content-Type', 'application/xml').send(xml.instances.simple.one).expect(200);
  await alice.post('/v1/projects/1/forms/simple/submissions').set('Content-Type', 'application/xml').send(xml.instances.simple.two).expect(200);
  const cases = (await alice.get('/v1/field-data/review-queue?projectId=1&xmlFormId=simple').expect(200)).body.items;
  const first = cases.find(item => item.claim.rootInstanceId === 'one'); const second = cases.find(item => item.claim.rootInstanceId === 'two');
  const inv = (await alice.post(root).send({ requestId: randomUUID(), title: 'Related claim review', findingIds: [] }).expect(201)).body;
  return { alice, first, second, inv, path: `${root}/${inv.id}/cases` };
};
const write = (alice, path, revision, body) => alice.post(path).set('If-Match', `"investigation-${revision}"`).send(body);
const limitedManager = async (service, c, alice) => {
  const user = await service.login('chelsea'); const { id } = (await user.get('/v1/users/current').expect(200)).body;
  await c.db.query(sql`UPDATE roles SET verbs = '["project.update","project.read","form.list","form.read"]'::jsonb WHERE system = 'manager'`);
  await alice.post(`/v1/projects/1/assignments/manager/${id}`).expect(200);
  await alice.post(`/v1/projects/1/forms/simple/assignments/viewer/${id}`).expect(200); return { user, id };
};
const backcheck = async (service, c, alice, caseId) => {
  const checker = (await alice.post('/v1/projects/1/app-users').send({ displayName: 'Independent checker' }).expect(200)).body;
  await alice.post(`/v1/projects/1/forms/withrepeat/assignments/app-user/${checker.id}`).expect(200);
  const actorId = (await alice.get('/v1/users/current').expect(200)).body.id;
  const target = (await alice.get(`/v1/field-data/review-queue/${caseId}`).expect(200)).body;
  const assigned = await alice.patch(`/v1/field-data/review-queue/${caseId}/assignment`).set('If-Match', `"review-case-${target.revision}"`).set('Idempotency-Key', randomUUID()).send({ assignedTo: actorId, status: 'in-review' })
    .expect(200);
  const requested = await alice.post(`/v1/field-data/review-queue/${caseId}/backchecks`).set('If-Match', assigned.headers.etag)
    .send({ requestId: randomUUID(), assignedTo: checker.id, question: 'Check the reported household during a separate visit.', dueAt: null, responseXmlFormId: 'withrepeat' }).expect(201);
  await service.post('/v1/projects/1/forms/withrepeat/submissions').set('Authorization', `Bearer ${checker.token}`).set('Content-Type', 'application/xml').send(xml.instances.withrepeat.one)
    .expect(200);
  const linked = await alice.post(`/v1/field-data/review-queue/${caseId}/backchecks/${requested.body.id}/link`).set('If-Match', requested.headers.etag).send({ instanceId: 'rone' }).expect(200);
  return { id: requested.body.id, etag: linked.headers.etag };
};
describe('api: investigation review-case links', () => {
  it('links/removes/relinks with exact retries and leaves cases, claims and disposition unchanged', testService(async (service, c) => {
    const { alice, first, inv, path } = await setup(service, c);
    const original = await c.db.one(sql`SELECT * FROM field_data_review_cases WHERE id = ${first.id}`);
    const body = linkBody(first.id); await write(alice, path, 1, body).expect(200); const state = (await alice.get(path).expect(200)).body; const link = state.items[0];
    assert.equal(state.revision, 2); assert.equal(link.case.id, first.id); assert.equal(link.available, true);
    assert.equal((await alice.get(`${root}/${inv.id}`).expect(200)).body.revision, 2);
    const replay = await write(alice, path, 1, Object.fromEntries(Object.entries(body).reverse())).expect(200); assert.equal(replay.headers['idempotency-status'], 'replayed');
    await write(alice, path, 2, linkBody(first.id.toUpperCase())).expect(409); await write(alice, path, 1, linkBody(first.id)).expect(412);
    await write(alice, path, 1, { ...body, reason: 'Changed content is not the original request.' }).expect(409);
    const remove = { requestId: randomUUID(), reason: 'This case was associated with a different pattern.' };
    await write(alice, `${path}/${link.linkId}/remove`, 2, remove).expect(200); await alice.get(`${path}/${link.linkId}`).expect(404);
    await write(alice, path, 3, linkBody(first.id)).expect(200);
    const current = (await alice.get(path).expect(200)).body; assert.equal(current.items.length, 1); assert.notEqual(current.items[0].linkId, link.linkId);
    assert.deepEqual(current.history.map(e => e.action), ['linked', 'removed', 'linked']);
    assert.equal((await write(alice, `${path}/${link.linkId}/remove`, 2, remove).expect(200)).body.revision, 4);
    assert.deepEqual(await c.db.one(sql`SELECT * FROM field_data_review_cases WHERE id = ${first.id}`), original);
    const detail = (await alice.get(`${root}/${inv.id}`).expect(200)).body; assert.equal(detail.status, 'open'); assert.equal(detail.disposition, null);
    const audits = JSON.stringify(await c.db.any(sql`SELECT details FROM audits WHERE action = 'field_data.investigation.case.link'`));
    assert.equal(audits.includes(reason), false); assert.equal(audits.includes(first.id), false);
  }));
  it('limits manager visibility by live source read grants and permits blind removal after revocation', testService(async (service, c) => {
    const { alice, first, path } = await setup(service, c); const { user, id } = await limitedManager(service, c, alice);
    await write(user, path, 1, linkBody(first.id)).expect(200); const initial = (await user.get(path).expect(200)).body; const { linkId } = initial.items[0];
    await user.get(`${path}/${linkId}`).expect(200);
    await alice.delete(`/v1/projects/1/forms/simple/assignments/viewer/${id}`).expect(200);
    const hidden = (await user.get(path).expect(200)).body; assert.equal(hidden.hiddenLinks, 1); assert.deepEqual(hidden.items, [{ linkId, available: false }]);
    assert.equal(hidden.history[0].reason, undefined); assert.equal(JSON.stringify(hidden).includes(first.id), false); assert.equal(JSON.stringify(hidden).includes('simple'), false);
    await user.get(`${path}/${linkId}`).expect(404); assert.equal((await user.get(`${path}/candidates`).expect(200)).body.items.length, 0);
    await write(user, `${path}/${linkId}/remove`, 2, { requestId: randomUUID(), reason: 'The protected source is no longer part of this inquiry.' }).expect(200);
    assert.equal((await user.get(path).expect(200)).body.items.length, 0);
    await alice.delete(`/v1/projects/1/assignments/manager/${id}`).expect(200); await user.get(path).expect(403);
  }));
  it('keeps unavailable history after source deletion and case purge, never retargeting a historical claim', testService(async (service, c) => {
    const { alice, first, second, path } = await setup(service, c); await write(alice, path, 1, linkBody(first.id)).expect(200); await write(alice, path, 2, linkBody(second.id)).expect(200);
    let state = (await alice.get(path).expect(200)).body; const firstLink = state.items.find(i => i.case.id===first.id).linkId; const secondLink = state.items.find(i => i.case.id===second.id).linkId;
    await alice.post('/v1/projects/1/submission').set('X-OpenRosa-Version', '1.0')
      .attach('xml_submission_file', Buffer.from(xml.instances.simple.one.replace('<instanceID>one', '<deprecatedID>one</deprecatedID><instanceID>replacement')), { filename: 'data.xml' }).expect(201);
    const historical = (await alice.get(`${path}/${firstLink}`).expect(200)).body; assert.equal(historical.case.current, false); assert.equal(historical.case.claimVersionId, first.claimVersionId);
    await alice.delete('/v1/projects/1/forms/simple/submissions/one').expect(200); await alice.get(`${path}/${firstLink}`).expect(404);
    await c.db.query(sql`DELETE FROM field_data_review_cases WHERE id = ${second.id}`); await alice.get(`${path}/${secondLink}`).expect(404);
    state = (await alice.get(path).expect(200)).body; assert.equal(state.hiddenLinks, 2); assert.equal(state.history.every(e => !e.available), true);
    await write(alice, `${path}/${firstLink}/remove`, 3, { requestId: randomUUID(), reason: 'Source removed under its existing deletion policy.' }).expect(200);
  }));
  it('opens live decisions and pinned backchecks with source XML/comparison scope preserved', testService(async (service, c) => {
    const { alice, first, path } = await setup(service, c); const b = await backcheck(service, c, alice, first.id);
    await write(alice, path, 1, linkBody(first.id)).expect(200); const { linkId } = (await alice.get(path).expect(200)).body.items[0];
    const before = (await alice.get(`${path}/${linkId}`).expect(200)).body; assert.equal(before.backchecks[0].status, 'linked'); assert.equal(before.backchecks[0].responseInstanceId, 'rone');
    assert.equal(before.backchecks[0].responseVersionInstanceId, 'rone'); assert.equal(before.hiddenBackchecks, 0);
    await alice.post(`/v1/field-data/review-queue/${first.id}/decisions`).set('If-Match', b.etag).set('Idempotency-Key', randomUUID())
      .send({ outcome: 'needs-evidence', override: false, reasonCode: 'provenance-degraded', note: 'Backcheck considered; another source is needed.', evidenceIds: [], integrityFindingIds: [] })
      .expect(201);
    const detail = (await alice.get(`${path}/${linkId}`).expect(200)).body; assert.equal(detail.decisions[0].outcome, 'needs-evidence'); assert.equal(detail.case.status, 'open');
    assert.equal(detail.decisions[0].evidenceSnapshot, undefined); assert.equal(detail.decisions[0].integritySnapshot, undefined);
    await alice.get(`/v1/field-data/review-queue/${first.id}/backchecks/${b.id}/comparison`).expect(200);
    assert.equal((await alice.get(path).expect(200)).body.revision, 2);
  }));
  it('withholds unreadable/deleted backcheck response sources and their private metadata', testService(async (service, c) => {
    const { alice, first, path } = await setup(service, c); const b = await backcheck(service, c, alice, first.id); await write(alice, path, 1, linkBody(first.id)).expect(200);
    const { linkId } = (await alice.get(path).expect(200)).body.items[0]; const { user, id } = await limitedManager(service, c, alice);
    let detail = (await user.get(`${path}/${linkId}`).expect(200)).body; assert.equal(detail.backchecks.length, 0); assert.equal(detail.hiddenBackchecks, 1);
    assert.equal(JSON.stringify(detail).includes('rone'), false); assert.equal(JSON.stringify(detail).includes('Independent checker'), false);
    await alice.post(`/v1/projects/1/forms/withrepeat/assignments/viewer/${id}`).expect(200); detail = (await user.get(`${path}/${linkId}`).expect(200)).body; assert.equal(detail.backchecks[0].id, b.id);
    await alice.delete('/v1/projects/1/forms/withrepeat/submissions/rone').expect(200); detail = (await user.get(`${path}/${linkId}`).expect(200)).body; assert.equal(detail.backchecks.length, 0); assert.equal(detail.hiddenBackchecks, 1);
  }));
  it('filters candidates before pagination and rejects cursor/context changes and foreign sources', testService(async (service, c) => {
    const { alice, first, path } = await setup(service, c); const page = (await alice.get(`${path}/candidates?limit=1`).expect(200)).body;
    assert.equal(page.items.length, 1); assert.ok(page.nextCursor);
    const next = (await alice.get(`${path}/candidates?limit=1&cursor=${page.nextCursor}`).expect(200)).body; assert.equal(next.items.length, 1); assert.notEqual(next.items[0].id, page.items[0].id); assert.equal(next.nextCursor, null);
    await alice.get(`${path}/candidates?q=changed&cursor=${page.nextCursor}`).expect(400); await alice.get(`${path}/candidates?cursor=bad`).expect(400);
    assert.equal((await alice.get(`${path}/candidates?q=%25`).expect(200)).body.items.length, 0);
    await alice.get(`${path}/candidates?limit=51`).expect(400); await alice.get(`${path}/candidates?status=invalid`).expect(400);
    const other = (await alice.post('/v1/projects').send({ name: 'Other scope' }).expect(200)).body;
    await alice.post(`/v1/projects/${other.id}/forms?publish=true`).set('Content-Type', 'application/xml').send(xml.forms.simple).expect(200);
    await alice.post(`/v1/projects/${other.id}/forms/simple/submissions`).set('Content-Type', 'application/xml').send(xml.instances.simple.one).expect(200);
    const foreign = (await alice.get(`/v1/field-data/review-queue?projectId=${other.id}&xmlFormId=simple`).expect(200)).body.items[0];
    await write(alice, path, 1, linkBody(foreign.id)).expect(404); assert.equal((await alice.get(`${path}/candidates?q=${foreign.id}`).expect(200)).body.items.length, 0);
    await write(alice, path, 1, linkBody(first.id)).expect(200); assert.equal((await alice.get(`${path}/candidates?q=${first.id}`).expect(200)).body.items[0].linked, true);
  }));
  it('requires managers, revisions and bounded valid request bodies; closed/archive state is read-only', testService(async (service, c) => {
    const { alice, first, inv, path } = await setup(service, c); const viewer = await service.login('chelsea'); const { id } = (await viewer.get('/v1/users/current').expect(200)).body;
    await alice.post(`/v1/projects/1/assignments/viewer/${id}`).expect(200); await viewer.get(path).expect(403); await service.get(path).expect(401);
    const appUser = (await alice.post('/v1/projects/1/app-users').send({ displayName: 'Collector' }).expect(200)).body; await service.get(path).set('Authorization', `Bearer ${appUser.token}`).expect(403);
    await alice.post(path).send(linkBody(first.id)).expect(428);
    for (const patch of [{ reason: 'short' }, { requestId: 'bad' }, { caseId: 'bad' }, { extra: true }]) await write(alice, path, 1, { ...linkBody(first.id), ...patch }).expect(400);
    const body = linkBody(first.id); await write(alice, path, 1, body).expect(200);
    await alice.post(`${root}/${inv.id}/close`).set('If-Match', '"investigation-2"').send({ disposition: 'insufficient-evidence', conclusion: 'Further review will be needed.' }).expect(200);
    await write(alice, path, 3, linkBody(first.id)).expect(409); assert.equal((await alice.get(path).expect(200)).body.canRemove, false);
    await write(alice, path, 1, body).expect(200);
    await alice.post(`${root}/${inv.id}/reopen`).set('If-Match', '"investigation-3"').send({ reason: 'New evidence is available.' }).expect(200);
    await c.db.query(sql`UPDATE projects SET archived = TRUE WHERE id = 1`); assert.equal((await alice.get(path).expect(200)).body.canLink, false);
    await write(alice, path, 4, linkBody(first.id)).expect(409); await write(alice, path, 1, body).expect(200);
  }));
  it('protects append-only links, retains nonempty history on rollback and purges with its project', testService(async (service, c) => {
    const { alice, first, inv, path } = await setup(service, c); await write(alice, path, 1, linkBody(first.id)).expect(200);
    for (const statement of [sql`UPDATE field_data_investigation_case_events SET reason = 'Rewrite association history' WHERE "investigationId" = ${inv.id}`, sql`DELETE FROM field_data_investigation_case_events WHERE "investigationId" = ${inv.id}`]) {
      await c.db.query(sql`SAVEPOINT immutable_check`); await assert.rejects(c.db.query(statement)); await c.db.query(sql`ROLLBACK TO SAVEPOINT immutable_check`); await c.db.query(sql`RELEASE SAVEPOINT immutable_check`);
    }
    const migration = require('../../../lib/model/migrations/20261016-04-investigation-case-links'); const adapter = { raw: value => c.db.query(sql([value])) }; await migration.down(adapter); await migration.up(adapter);
    assert.equal((await alice.get(path).expect(200)).body.items.length, 1);
    // At the final purge stage, native forms/sources have already been removed.
    const empty = (await alice.post('/v1/projects').send({ name: 'Empty purge fixture' }).expect(200)).body;
    const retired = (await alice.post(`/v1/projects/${empty.id}/investigations`).send({ requestId: randomUUID(), title: 'Retired source history', findingIds: [] }).expect(201)).body;
    const eventId = randomUUID();
    await c.db.query(sql`INSERT INTO field_data_investigation_case_events (id,"investigationId",sequence,"investigationRevision",action,"linkId","caseId","claimVersionId","requestId","requestHash",reason,"actorId","actorName")
      SELECT ${eventId},${retired.id},1,2,'linked',${eventId},${randomUUID()},${randomUUID()},${randomUUID()},'fixture-hash',reason,"actorId","actorName" FROM field_data_investigation_case_events WHERE "investigationId" = ${inv.id}`);
    await c.db.query(sql`DELETE FROM projects WHERE id = ${empty.id}`);
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_investigation_case_events WHERE "investigationId" = ${retired.id}`), 0);
    assert.equal((await alice.get(path).expect(200)).body.items.length, 1);
  }));
  it('pages link history and reserves the final slot for removing its last active association', testService(async (service, c) => {
    const { alice, first, inv, path } = await setup(service, c); const actorId = (await alice.get('/v1/users/current').expect(200)).body.id;
    await c.db.query(sql`INSERT INTO field_data_investigation_case_events (id,"investigationId",sequence,"investigationRevision",action,"linkId","caseId","claimVersionId","requestId","requestHash",reason,"actorId","actorName")
      SELECT id,${inv.id},n,n+1,CASE WHEN n%2=1 THEN 'linked' ELSE 'removed' END,CASE WHEN n%2=1 THEN id ELSE previous END,${first.id},${first.claimVersionId},gen_random_uuid(),'fixture-hash',${reason},${actorId},'Alice'
      FROM (SELECT n,id,lag(id) OVER (ORDER BY n) previous FROM (SELECT n,gen_random_uuid() id FROM generate_series(1,499) n) generated) events`);
    await c.db.query(sql`UPDATE field_data_investigations SET revision = 500 WHERE id = ${inv.id}`);
    const state = (await alice.get(path).expect(200)).body; assert.equal(state.canLink, false); assert.equal(state.canRemove, true); assert.equal(state.history.length, 50); assert.equal(state.nextBefore, 450);
    const earlier = (await alice.get(`${path}?before=450`).expect(200)).body; assert.equal(earlier.history[0].sequence, 449);
    await write(alice, path, 500, linkBody(first.id)).expect(409);
    await write(alice, `${path}/${state.items[0].linkId}/remove`, 500, { requestId: randomUUID(), reason: 'The final association is no longer needed.' }).expect(200);
    const end = (await alice.get(path).expect(200)).body; assert.equal(end.items.length, 0); assert.equal(end.eventCount, 500); assert.equal(end.canRemove, false);
  }));
  it('serializes duplicate and competing link writes against the shared investigation revision', testServiceFullTrx(async(service, c) => {
    const { alice, first, second, path }=await setup(service, c); const body=linkBody(first.id);
    const results=await Promise.all([write(alice, path, 1, body).expect(200), write(alice, path, 1, body).expect(200)]); assert.equal(results.filter(r => r.body.replayed).length, 1);
    const state=(await alice.get(path).expect(200)).body; const removing={ requestId: randomUUID(), reason: 'Reconsidered the association after inspection.' };
    const competing=await Promise.all([write(alice, path, 2, linkBody(second.id)), write(alice, `${path}/${state.items[0].linkId}/remove`, 2, removing)]);
    assert.deepEqual(competing.map(r => r.status).sort(), [200, 412]); assert.equal((await alice.get(path).expect(200)).body.eventCount, 2);
  }));
});
