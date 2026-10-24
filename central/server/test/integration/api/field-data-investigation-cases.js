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

describe('api: targeted investigation backcheck instruments (F9)', () => {
  const seed = async (service, c) => {
    const context = await setup(service); const { alice, first, inv, path } = context;
    const flag = async (rule, instanceId = 'one', status = 'open', outcome = 'concern') => (await c.db.one(sql`INSERT INTO field_data_integrity_flags
      ("formId",rule,"ruleVersion","instanceId",status,outcome,evidence)
      SELECT id,${rule},1,${instanceId},${status},${outcome},'{"title":"Private respondent identity","answer":"secret earlier answer"}'::jsonb
      FROM forms WHERE "projectId" = 1 AND "xmlFormId" = 'simple' RETURNING id`)).id;
    const finding = await flag('contradiction:instrument'); const identity = await flag('identity-reused:instrument');
    const unrelated = await flag('contradiction:other-source', 'two');
    const withdrawn = await flag('contradiction:withdrawn', 'one', 'open', 'withdrawn');
    const resolved = await flag('contradiction:resolved', 'one', 'resolved'); const unknown = await flag('unrecognized-rule');
    const unattached = await flag('contradiction:unattached');
    await alice.post(`${root}/${inv.id}/findings`).set('If-Match', '"investigation-1"').send({ findingIds: [finding, identity, unrelated, withdrawn, resolved, unknown] }).expect(200);
    await write(alice, path, 2, linkBody(first.id)).expect(200);
    const link = (await alice.get(path).expect(200)).body.items[0]; const endpoint = `${path}/${link.linkId}/instrument`;
    const user = (await alice.get('/v1/users/current').expect(200)).body;
    const target = (await alice.get(`/v1/field-data/review-queue/${first.id}`).expect(200)).body;
    await alice.patch(`/v1/field-data/review-queue/${first.id}/assignment`).set('If-Match', `"review-case-${target.revision}"`).set('Idempotency-Key', randomUUID())
      .send({ assignedTo: user.id, status: 'in-review' })
      .expect(200);
    const checker = (await alice.post('/v1/projects/1/app-users').send({ displayName: 'Independent instrument checker' }).expect(200)).body;
    await alice.post(`/v1/projects/1/forms/withrepeat/assignments/app-user/${checker.id}`).expect(200);
    const draft = (await alice.get(endpoint).expect(200)).body;
    const body = { requestId: randomUUID(), investigationRevision: draft.investigationRevision, templateVersion: draft.templateVersion,
      findingIds: [identity, finding], responseXmlFormId: 'withrepeat', assignedTo: checker.id, question: 'Confirm the household details independently, recording legitimate explanations.', dueAt: null };
    const post = (data = body, revision = draft.caseRevision) => alice.post(`${endpoint}/backchecks`).set('If-Match', `"review-case-${revision}"`).send(data);
    return { ...context, endpoint, draft, body, post, finding, identity, unrelated, unattached, checker, actorId: user.id, link };
  };
  it('drafts only supported active primary-source findings without copying evidence or answers', testService(async (service, c) => {
    const { alice, endpoint, draft, finding, identity } = await seed(service, c);
    assert.deepEqual(draft.items.map(i => i.findingId), [finding, identity]); assert.equal(draft.canRequest, true);
    const text = JSON.stringify(draft); assert.equal(text.includes('secret earlier answer'), false); assert.equal(text.includes('Private respondent'), false);
    assert.ok(draft.items.every(i => /correction|legitimately/.test(i.question))); assert.equal(draft.templateVersion, 'investigation-backcheck@1');
    const response = await alice.get(endpoint).expect(200); assert.equal(response.headers['cache-control'], 'private, no-store');
    await alice.get(`${endpoint}?extra=1`).expect(400);
  }));
  it('offers same-form peer findings for all supported pair families and dispatches to the peer case', testService(async (service, c) => {
    const { alice, endpoint, unrelated, body, draft, post, first } = await seed(service, c);
    for (const rule of ['near-duplicate', 'repeated-location', 'identity-reused:peer']) {
      await c.db.query(sql`UPDATE field_data_integrity_flags SET rule = ${rule}, "relatedInstanceId" = 'one' WHERE id = ${unrelated}`);
      const peer = (await alice.get(endpoint).expect(200)).body.items.find(item => item.findingId === unrelated);
      assert.equal(peer.targetSide, 'peer'); assert.equal(JSON.stringify(peer).includes('secret earlier answer'), false);
      assert.equal(JSON.stringify(peer).includes('two'), false);
    }
    const definition = await alice.post(`${endpoint}/form-definition`).send({ investigationRevision: draft.investigationRevision, caseRevision: draft.caseRevision, templateVersion: draft.templateVersion, findingIds: [unrelated] }).expect(200);
    assert.equal(definition.body.definition.questions.some(q => /legitimately shared/.test(q.label)), true);
    const request = { ...body, findingIds: [unrelated] }; const saved = await post(request).expect(201);
    assert.equal(await c.db.oneFirst(sql`SELECT "caseId" FROM field_data_backchecks WHERE id = ${saved.body.id}`), first.id);
    await c.db.query(sql`UPDATE field_data_integrity_flags SET outcome = 'withdrawn' WHERE id = ${unrelated}`);
    assert.equal((await post(request).expect(201)).body.id, saved.body.id);
    assert.equal((await alice.get(endpoint).expect(200)).body.items.some(item => item.findingId === unrelated), false);
  }));
  it('withholds unsupported, ambiguous, cross-form and missing-primary peer matches and rechecks before writing', testService(async (service, c) => {
    const { alice, endpoint, unrelated, body, draft, post } = await seed(service, c);
    await c.db.query(sql`UPDATE field_data_integrity_flags SET rule = 'near-duplicate', "relatedInstanceId" = 'one' WHERE id = ${unrelated}`);
    assert.equal((await alice.get(endpoint).expect(200)).body.items.some(item => item.findingId === unrelated), true);
    for (const evidence of [{ others: [{ instanceId: 'one', xmlFormId: 'withrepeat' }] }, { others: [{ instanceId: 'one', xmlFormId: null }] }, { others: {} }]) {
      await c.db.query(sql`UPDATE field_data_integrity_flags SET evidence = ${sql.json(evidence)} WHERE id = ${unrelated}`);
      assert.equal((await alice.get(endpoint).expect(200)).body.items.some(item => item.findingId === unrelated), false);
      await post({ ...body, findingIds: [unrelated] }).expect(400);
      await alice.post(`${endpoint}/form-definition`).send({ investigationRevision: draft.investigationRevision, caseRevision: draft.caseRevision, templateVersion: draft.templateVersion, findingIds: [unrelated] }).expect(400);
    }
    await c.db.query(sql`UPDATE field_data_integrity_flags SET evidence = '{}'::jsonb, rule = 'contradiction:unsupported-peer' WHERE id = ${unrelated}`);
    assert.equal((await alice.get(endpoint).expect(200)).body.items.some(item => item.findingId === unrelated), false);
    await c.db.query(sql`UPDATE field_data_integrity_flags SET rule = 'near-duplicate', "instanceId" = 'missing-primary' WHERE id = ${unrelated}`);
    await post({ ...body, findingIds: [unrelated] }).expect(400);
    assert.equal((await alice.get(endpoint).expect(200)).body.items.some(item => item.findingId === unrelated), false);
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_backchecks`), 0);
  }));
  it('dispatches explicit cross-form identity peers and hides them when the primary form grant is revoked', testService(async (service, c) => {
    const { alice, endpoint, unrelated, body, first, checker } = await seed(service, c);
    await alice.post('/v1/projects/1/forms/withrepeat/submissions').set('Content-Type', 'application/xml').send(xml.instances.withrepeat.one).expect(200);
    await c.db.query(sql`UPDATE field_data_integrity_flags SET "formId" = (SELECT id FROM forms WHERE "projectId" = 1 AND "xmlFormId" = 'withrepeat'),
      rule = 'identity-reused:cross-peer', "instanceId" = 'rone', "relatedInstanceId" = 'one',
      evidence = '{"others":[{"instanceId":"one","xmlFormId":"simple"}],"answer":"secret peer answer"}'::jsonb WHERE id = ${unrelated}`);
    const { user, id } = await limitedManager(service, c, alice);
    await c.db.query(sql`UPDATE roles SET verbs = verbs || '["submission.update","form.create"]'::jsonb WHERE system = 'manager'`);
    await c.db.query(sql`UPDATE field_data_review_cases SET "assignedTo" = ${id} WHERE id = ${first.id}`);
    assert.equal((await user.get(endpoint).expect(200)).body.items.some(item => item.findingId === unrelated), false);
    await alice.post(`/v1/projects/1/forms/withrepeat/assignments/viewer/${id}`).expect(200);
    const draft = (await user.get(endpoint).expect(200)).body;
    const item = draft.items.find(row => row.findingId === unrelated);
    assert.equal(item.targetSide, 'peer'); assert.equal(item.targetScope, 'cross-form');
    assert.equal(JSON.stringify(item).includes('rone'), false); assert.equal(JSON.stringify(item).includes('secret peer answer'), false);
    const definitionBody = { investigationRevision: draft.investigationRevision, caseRevision: draft.caseRevision, templateVersion: draft.templateVersion, findingIds: [unrelated] };
    await user.post(`${endpoint}/form-definition`).send(definitionBody).expect(200);
    await alice.post(`/v1/projects/1/forms/simple/assignments/app-user/${checker.id}`).expect(200);
    const request = { ...body, responseXmlFormId: 'simple', findingIds: [unrelated] }; const send = () => user.post(`${endpoint}/backchecks`).set('If-Match', `"review-case-${draft.caseRevision}"`).send(request);
    const saved = await send().expect(201);
    assert.equal(await c.db.oneFirst(sql`SELECT "caseId" FROM field_data_backchecks WHERE id = ${saved.body.id}`), first.id);
    await c.db.query(sql`UPDATE field_data_integrity_flags SET outcome = 'withdrawn' WHERE id = ${unrelated}`);
    assert.equal((await send().expect(201)).body.id, saved.body.id);
    await alice.delete(`/v1/projects/1/forms/withrepeat/assignments/viewer/${id}`).expect(200);
    assert.equal((await user.get(endpoint).expect(200)).body.items.some(row => row.findingId === unrelated), false);
    await send().expect(404);
    await user.post(`${endpoint}/form-definition`).send(definitionBody).expect(400);
  }));
  it('rejects missing, conflicting and unsupported cross-form peer mappings before dispatch', testService(async (service, c) => {
    const { alice, endpoint, unrelated, body, post } = await seed(service, c);
    await alice.post('/v1/projects/1/forms/withrepeat/submissions').set('Content-Type', 'application/xml').send(xml.instances.withrepeat.one).expect(200);
    await c.db.query(sql`UPDATE field_data_integrity_flags SET "formId" = (SELECT id FROM forms WHERE "projectId" = 1 AND "xmlFormId" = 'withrepeat'),
      rule = 'identity-reused:cross-peer', "instanceId" = 'rone', "relatedInstanceId" = 'one' WHERE id = ${unrelated}`);
    for (const others of [[], [{ instanceId: 'one' }], [{ instanceId: 'one', xmlFormId: 'simple' }, { instanceId: 'one' }], [{ instanceId: 'one', xmlFormId: 'simple' }, { instanceId: 'one', xmlFormId: 'withrepeat' }]]) {
      await c.db.query(sql`UPDATE field_data_integrity_flags SET evidence = ${sql.json({ others })} WHERE id = ${unrelated}`);
      assert.equal((await alice.get(endpoint).expect(200)).body.items.some(row => row.findingId === unrelated), false);
      await post({ ...body, findingIds: [unrelated] }).expect(400);
    }
    await c.db.query(sql`UPDATE field_data_integrity_flags SET rule = 'near-duplicate', evidence = '{"others":[{"instanceId":"one","xmlFormId":"simple"}]}'::jsonb WHERE id = ${unrelated}`);
    await post({ ...body, findingIds: [unrelated] }).expect(400);
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_backchecks`), 0);
  }));
  it('creates an ordinary dedicated-form backcheck with atomic investigation audit and normalized exact retries', testService(async (service, c) => {
    const { alice, first, inv, draft, body, post, checker, path, link } = await seed(service, c);
    const saved = await post().expect(201); assert.equal(saved.headers.etag, `"review-case-${draft.caseRevision + 1}"`);
    const replay = await post({ ...body, requestId: body.requestId.toUpperCase(), findingIds: [...body.findingIds].reverse(), question: ` ${body.question} ` }).expect(201);
    assert.equal(replay.body.id, saved.body.id); assert.equal(replay.headers['idempotency-status'], 'replayed');
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_backchecks WHERE "caseId" = ${first.id}`), 1);
    const native = (await alice.get(`/v1/field-data/review-queue/${first.id}/backchecks`).expect(200)).body[0];
    assert.equal(native.responseXmlFormId, 'withrepeat'); assert.equal(native.assignedTo, checker.id); assert.equal(native.question, body.question);
    const audits = await c.db.any(sql`SELECT details FROM audits WHERE action = 'field_data.investigation.instrument.request'`); assert.equal(audits.length, 1);
    assert.equal(audits[0].details.templateVersion, draft.templateVersion); assert.equal(audits[0].details.findingCount, 2);
    assert.equal(JSON.stringify(audits).includes(body.question), false); assert.equal(JSON.stringify(audits).includes(first.id), false);
    const investigation = (await alice.get(`${root}/${inv.id}`).expect(200)).body; assert.equal(investigation.revision, body.investigationRevision); assert.equal(investigation.disposition, null);
    await post({ ...body, question: 'Changed request contents must be rejected.' }).expect(400);
    await service.post('/v1/projects/1/forms/withrepeat/submissions').set('Authorization', `Bearer ${checker.token}`)
      .set('Content-Type', 'application/xml').send(xml.instances.withrepeat.one)
      .expect(200);
    await alice.post(`/v1/field-data/review-queue/${first.id}/backchecks/${saved.body.id}/link`).set('If-Match', saved.headers.etag).send({ instanceId: 'rone' }).expect(200);
    const inspection = (await alice.get(`${path}/${link.linkId}`).expect(200)).body;
    assert.equal(inspection.backchecks[0].status, 'linked'); assert.equal(inspection.backchecks[0].responseInstanceId, 'rone');
    await alice.get(`/v1/field-data/review-queue/${first.id}/backchecks/${saved.body.id}/comparison`).expect(200);
    assert.equal((await post().expect(201)).body.status, 'linked');
  }));
  it('rechecks findings and both revisions before writing, while exact retries survive closure and withdrawal', testService(async (service, c) => {
    const { alice, inv, body, post, finding, unrelated, unattached, endpoint } = await seed(service, c);
    for (const id of [unrelated, unattached]) await post({ ...body, requestId: randomUUID(), findingIds: [id] }).expect(400);
    await post({ ...body, investigationRevision: body.investigationRevision - 1 }).expect(412);
    await post(body, 999).expect(412);
    await c.db.query(sql`UPDATE field_data_integrity_flags SET outcome = 'withdrawn' WHERE id = ${finding}`);
    await post().expect(400);
    const valid = { ...body, findingIds: [body.findingIds[0]] }; await post(valid).expect(201);
    await alice.post(`${root}/${inv.id}/close`).set('If-Match', `"investigation-${body.investigationRevision}"`).send({ disposition: 'insufficient-evidence', conclusion: 'Awaiting an independent follow-up.' }).expect(200);
    await post(valid).expect(201); const closed = (await alice.get(endpoint).expect(200)).body; assert.equal(closed.canRequest, false);
    await post({ ...valid, requestId: randomUUID(), investigationRevision: body.investigationRevision + 1 }).expect(409);
  }));
  it('requires source update/read grants and hides drafts after source or investigation access revocation', testService(async (service, c) => {
    const { alice, endpoint, body, draft, actorId } = await seed(service, c); const { user, id } = await limitedManager(service, c, alice);
    assert.equal((await user.get(endpoint).expect(200)).body.canRequest, false);
    await user.post(`${endpoint}/backchecks`).set('If-Match', `"review-case-${draft.caseRevision}"`).send(body).expect(404);
    await alice.delete(`/v1/projects/1/forms/simple/assignments/viewer/${id}`).expect(200); await user.get(endpoint).expect(404);
    await alice.delete(`/v1/projects/1/assignments/manager/${id}`).expect(200); await user.get(endpoint).expect(403);
    assert.notEqual(id, actorId); await service.get(endpoint).expect(401);
  }));
  it('keeps native independence, reviewer ownership, published form, pending-request and collector grants', testService(async (service, c) => {
    const { first, body, post, checker, endpoint, alice } = await seed(service, c);
    await c.db.query(sql`UPDATE submissions SET "submitterId" = ${checker.id} WHERE "formId" = (SELECT id FROM forms WHERE "projectId" = 1 AND "xmlFormId" = 'simple') AND "instanceId" = 'one'`);
    await post().expect(400);
    await c.db.query(sql`UPDATE submissions SET "submitterId" = NULL WHERE "formId" = (SELECT id FROM forms WHERE "projectId" = 1 AND "xmlFormId" = 'simple') AND "instanceId" = 'one'`);
    await post({ ...body, responseXmlFormId: 'missing' }).expect(404);
    await post({ ...body, responseXmlFormId: 'simple' }).expect(400);
    await c.db.query(sql`UPDATE forms SET state = 'closing' WHERE "projectId" = 1 AND "xmlFormId" = 'withrepeat'`); await post().expect(400);
    await c.db.query(sql`UPDATE forms SET state = 'open' WHERE "projectId" = 1 AND "xmlFormId" = 'withrepeat'`);
    await c.db.query(sql`UPDATE field_data_review_cases SET "assignedTo" = NULL WHERE id = ${first.id}`); await post().expect(409);
    const self = (await alice.get('/v1/users/current').expect(200)).body.id; await c.db.query(sql`UPDATE field_data_review_cases SET "assignedTo" = ${self} WHERE id = ${first.id}`);
    await post().expect(201); assert.equal((await alice.get(endpoint).expect(200)).body.canRequest, false);
    const current = (await alice.get(endpoint).expect(200)).body;
    await post({ ...body, requestId: randomUUID() }, current.caseRevision).expect(409);
  }));
  it('blocks archived, removed and historical links and bounds draft selection', testService(async (service, c) => {
    const { alice, path, link, endpoint, body, post, draft } = await seed(service, c);
    for (const patch of [{ findingIds: [] }, { findingIds: [1, 1] }, { findingIds: Array.from({ length: 21 }, (_, n) => n + 1) }, { templateVersion: 'future' }, { question: '' }, { extra: true }, { dueAt: 'bad' }]) await post({ ...body, ...patch }).expect(400);
    await alice.post(`${endpoint}/backchecks`).send(body).expect(428);
    await c.db.query(sql`UPDATE projects SET archived = TRUE WHERE id = 1`); assert.equal((await alice.get(endpoint).expect(200)).body.canRequest, false); await post().expect(409);
    await c.db.query(sql`UPDATE projects SET archived = FALSE WHERE id = 1`);
    await c.db.query(sql`UPDATE submission_defs SET current = FALSE WHERE id = (SELECT "submissionDefId" FROM field_data_claim_versions WHERE id = (SELECT "claimVersionId" FROM field_data_review_cases WHERE id = ${link.case.id}))`);
    assert.equal((await alice.get(endpoint).expect(200)).body.canRequest, false); await post().expect(409);
    await write(alice, `${path}/${link.linkId}/remove`, draft.investigationRevision, { requestId: randomUUID(), reason: 'Association no longer applies to this inquiry.' }).expect(200);
    await alice.get(endpoint).expect(404); await post().expect(404);
  }));
  it('requires the response-form read grant even for a manager assigned the source case', testService(async (service, c) => {
    const { alice, endpoint, body, first } = await seed(service, c); const { user, id } = await limitedManager(service, c, alice);
    await c.db.query(sql`UPDATE roles SET verbs = verbs || '["submission.update"]'::jsonb WHERE system = 'manager'`);
    await c.db.query(sql`UPDATE field_data_review_cases SET "assignedTo" = ${id} WHERE id = ${first.id}`);
    const draft = (await user.get(endpoint).expect(200)).body; assert.equal(draft.canRequest, true);
    const send = () => user.post(`${endpoint}/backchecks`).set('If-Match', `"review-case-${draft.caseRevision}"`).send(body);
    await send().expect(404); assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_backchecks WHERE "caseId" = ${first.id}`), 0);
    await alice.post(`/v1/projects/1/forms/withrepeat/assignments/viewer/${id}`).expect(200); await send().expect(201);
    await alice.delete(`/v1/projects/1/forms/withrepeat/assignments/viewer/${id}`).expect(200); await send().expect(404);
  }));
  it('bounds drafts to twenty findings and excludes selections outside the displayed batch', testService(async (service, c) => {
    const { alice, inv, endpoint, body, post, first } = await seed(service, c);
    const more = await c.db.any(sql`INSERT INTO field_data_integrity_flags ("formId",rule,"ruleVersion","instanceId",outcome,evidence)
      SELECT f.id,'contradiction:bounded-' || n,1,'one','concern','{}'::jsonb FROM forms f CROSS JOIN generate_series(1,21) n
      WHERE f."projectId" = 1 AND f."xmlFormId" = 'simple' RETURNING id`);
    await alice.post(`${root}/${inv.id}/findings`).set('If-Match', `"investigation-${body.investigationRevision}"`).send({ findingIds: more.map(row => row.id) }).expect(200);
    const draft = (await alice.get(endpoint).expect(200)).body; assert.equal(draft.items.length, 20); assert.equal(draft.omitted, 3);
    await post({ ...body, investigationRevision: draft.investigationRevision, findingIds: [more.at(-1).id] }, draft.caseRevision).expect(400);
    await alice.delete('/v1/projects/1/forms/simple/submissions/one').expect(200); await alice.get(endpoint).expect(404);
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_backchecks WHERE "caseId" = ${first.id}`), 0);
  }));
  it('generates a reviewable form definition without creating or publishing any form', testService(async (service, c) => {
    const { alice, endpoint, draft, body, finding, inv } = await seed(service, c);
    const before = await c.db.oneFirst(sql`SELECT count(*)::integer FROM forms`);
    const generate = data => alice.post(`${endpoint}/form-definition`).send(data);
    const input = { investigationRevision: draft.investigationRevision, caseRevision: draft.caseRevision, templateVersion: draft.templateVersion, findingIds: [finding] };
    const response = await generate(input).expect(200); assert.equal(response.headers['cache-control'], 'private, no-store');
    assert.equal(response.body.definition.schemaVersion, 2); assert.equal(response.body.definition.title, 'Independent verification');
    assert.equal(response.body.definition.questions.some(q => q.name === 'visit_consent'), true);
    assert.equal(JSON.stringify(response.body).includes('secret earlier answer'), false); assert.equal(JSON.stringify(response.body).includes(inv.id), false);
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM forms`), before);
    assert.notEqual((await generate(input).expect(200)).body.definition.formId, response.body.definition.formId);
    assert.equal((await alice.get(endpoint).expect(200)).body.canGenerateForm, true);
    assert.equal((await alice.get(`${root}/${inv.id}`).expect(200)).body.revision, body.investigationRevision);
    await generate({ ...input, investigationRevision: 1 }).expect(412); await generate({ ...input, caseRevision: 999 }).expect(412);
  }));
  it('requires form-create and live source grants when generating a definition', testService(async (service, c) => {
    const { alice, endpoint, draft, finding } = await seed(service, c); const { user, id } = await limitedManager(service, c, alice);
    const input = { investigationRevision: draft.investigationRevision, caseRevision: draft.caseRevision, templateVersion: draft.templateVersion, findingIds: [finding] };
    assert.equal((await user.get(endpoint).expect(200)).body.canGenerateForm, false);
    await user.post(`${endpoint}/form-definition`).send(input).expect(404);
    await c.db.query(sql`UPDATE roles SET verbs = verbs || '["form.create"]'::jsonb WHERE system = 'manager'`);
    assert.equal((await user.get(endpoint).expect(200)).body.canGenerateForm, true);
    await user.post(`${endpoint}/form-definition`).send(input).expect(200);
    await alice.delete(`/v1/projects/1/forms/simple/assignments/viewer/${id}`).expect(200);
    await user.post(`${endpoint}/form-definition`).send(input).expect(404);
    await service.post(`${endpoint}/form-definition`).send(input).expect(401);
  }));
  it('rechecks selected findings and refuses archived, closed, historical and removed generation sources', testService(async (service, c) => {
    const { alice, endpoint, draft, finding, unrelated, inv, path, link, first } = await seed(service, c);
    const input = { investigationRevision: draft.investigationRevision, caseRevision: draft.caseRevision, templateVersion: draft.templateVersion, findingIds: [finding] };
    const generate = data => alice.post(`${endpoint}/form-definition`).send(data);
    await generate({ ...input, findingIds: [unrelated] }).expect(400); await generate({ ...input, extra: true }).expect(400);
    await c.db.query(sql`UPDATE field_data_integrity_flags SET outcome = 'withdrawn' WHERE id = ${finding}`); await generate(input).expect(400);
    await c.db.query(sql`UPDATE field_data_integrity_flags SET outcome = 'concern' WHERE id = ${finding}`);
    await c.db.query(sql`UPDATE projects SET archived = TRUE WHERE id = 1`); await generate(input).expect(409);
    await c.db.query(sql`UPDATE projects SET archived = FALSE WHERE id = 1`);
    await c.db.query(sql`UPDATE field_data_investigations SET status = 'closed',disposition = 'insufficient-evidence' WHERE id = ${inv.id}`); await generate(input).expect(409);
    await c.db.query(sql`UPDATE field_data_investigations SET status = 'open',disposition = NULL WHERE id = ${inv.id}`);
    await c.db.query(sql`UPDATE field_data_review_cases SET status = 'resolved',"resolvedAt" = clock_timestamp() WHERE id = ${first.id}`); await generate(input).expect(409);
    await c.db.query(sql`UPDATE field_data_review_cases SET status = 'in-review',"resolvedAt" = NULL WHERE id = ${first.id}`);
    await c.db.query(sql`UPDATE submission_defs SET current = FALSE WHERE id = (SELECT "submissionDefId" FROM field_data_claim_versions WHERE id = ${first.claimVersionId})`); await generate(input).expect(409);
    await write(alice, `${path}/${link.linkId}/remove`, draft.investigationRevision, { requestId: randomUUID(), reason: 'This source is no longer part of the investigation.' }).expect(200);
    await generate(input).expect(404);
  }));
  it('generates without a lock cycle when an integrity writer locks a finding before its case', testServiceFullTrx(async (service, c) => {
    const { alice, endpoint, draft, finding, first } = await seed(service, c);
    let signal; let release;
    const held = new Promise(resolve => { signal = resolve; }); const gate = new Promise(resolve => { release = resolve; });
    const writer = c.transacting(async tx => {
      await tx.db.query(sql`SELECT id FROM field_data_integrity_flags WHERE id = ${finding} FOR UPDATE`); signal(); await gate;
      await tx.db.query(sql`SET LOCAL lock_timeout = '3s'`);
      await tx.db.query(sql`SELECT id FROM field_data_review_cases WHERE id = ${first.id} FOR UPDATE`);
      await tx.db.query(sql`UPDATE field_data_integrity_flags SET outcome = 'withdrawn' WHERE id = ${finding}`);
    });
    await held;
    const generated = alice.post(`${endpoint}/form-definition`).send({ investigationRevision: draft.investigationRevision, caseRevision: draft.caseRevision, templateVersion: draft.templateVersion, findingIds: [finding] }).then(response => response);
    let waiting = false;
    try {
      const deadline = Date.now() + 3000;
      while (!waiting && Date.now() < deadline) {
        waiting = (await c.db.oneFirst(sql`SELECT count(*)::integer FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%field_data_investigation_findings x%'`)) > 0;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 25));
      }
    } finally { release(); }
    const [written, result] = await Promise.allSettled([writer, generated]);
    assert.equal(waiting, true, 'generation reached the finding lock');
    assert.equal(written.status, 'fulfilled'); assert.equal(result.status, 'fulfilled'); assert.equal(result.value.status, 400);
  }));
  it('serializes concurrent requests without duplicate backchecks or investigation audit', testServiceFullTrx(async (service, c) => {
    const { post, first } = await seed(service, c); const results = await Promise.all([post().expect(201), post().expect(201)]);
    assert.equal(results.filter(r => r.body.replayed).length, 1);
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_backchecks WHERE "caseId" = ${first.id}`), 1);
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM audits WHERE action = 'field_data.investigation.instrument.request'`), 1);
  }));
});
