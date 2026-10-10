// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
//
// Investigation records (F6): docs/field-intelligence/F6-investigations.md

require('should');
const assert = require('node:assert/strict');
const { sql } = require('slonik');
const { testService } = require('../setup');
const testData = require('../../data/xml');

const base = '/v1/projects/1/investigations';
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// Findings on two forms of project 1 and one in another project.
const seed = async (service, { one }) => {
  const alice = await service.login('alice');
  await alice.post('/v1/projects/1/forms/simple/submissions').send(testData.instances.simple.one)
    .set('Content-Type', 'application/xml').expect(200);
  const flag = (projectId, xmlFormId, instanceId, title) => one(sql`INSERT INTO field_data_integrity_flags
      ("formId", rule, "ruleVersion", "instanceId", outcome, evidence)
    SELECT id, ${`manual-${title}`}, 1, ${instanceId}, 'inconclusive', ${JSON.stringify({ title })}::jsonb
    FROM forms WHERE "projectId" = ${projectId} AND "xmlFormId" = ${xmlFormId} RETURNING id`);
  const other = (await alice.post('/v1/projects').send({ name: 'Other' }).expect(200)).body;
  await alice.post(`/v1/projects/${other.id}/forms?publish=true`).send(testData.forms.simple).set('Content-Type', 'application/xml').expect(200);
  const f = {
    a: (await flag(1, 'simple', 'one', 'Same answers as two')).id,
    b: (await flag(1, 'simple', 'one', 'Shared phone number')).id,
    c: (await flag(1, 'withrepeat', 'rone', 'Identical location')).id,
    foreign: (await flag(other.id, 'simple', 'x', 'Elsewhere')).id
  };
  return { alice, f };
};

describe('api: investigation records (F6)', () => {
  it('opens, extends, notes, closes and reopens an investigation, keeping every step', testService(async (service, container) => {
    const { alice, f } = await seed(service, container);
    const { all, oneFirst } = container;
    const findingsBefore = await all(sql`SELECT id, outcome, status, decision, note FROM field_data_integrity_flags ORDER BY id`);
    const casesBefore = await oneFirst(sql`SELECT count(*)::integer FROM field_data_review_cases`);

    const body = { requestId: uuid(1), title: 'Collectors A and B keep matching', findingIds: [f.b, f.a, f.b] };
    const created = await alice.post(base).send(body).expect(201);
    assert.equal(created.headers.etag, '"investigation-1"');
    assert.equal(created.headers['cache-control'], 'private, no-store');
    assert.equal(created.body.status, 'open');
    assert.equal(created.body.disposition, null);
    assert.equal(created.body.openedByName, 'Alice');
    assert.deepEqual(created.body.findings.map((x) => x.id), [f.a, f.b]);
    assert.deepEqual(created.body.findings[0], { ...created.body.findings[0], rule: 'manual-Same answers as two', title: 'Same answers as two', xmlFormId: 'simple', instanceId: 'one' });
    assert.deepEqual(created.body.events.map((e) => [e.kind, e.findingIds, e.actorName]), [['opened', [f.a, f.b], 'Alice']]);
    const { id } = created.body;
    const path = `${base}/${id}`;

    // Idempotent by request ID; a reused ID with other content is refused.
    const replay = await alice.post(base).send(body).expect(201);
    assert.equal(replay.headers['idempotency-status'], 'replayed');
    assert.equal(replay.body.id, id);
    const refused = await Promise.all([
      { ...body, title: 'Other' }, { ...body, requestId: uuid(2), findingIds: [f.foreign] }, { ...body, requestId: uuid(3), title: ' ' },
      { ...body, requestId: uuid(4), findingIds: ['1'] }, { ...body, requestId: uuid(5), extra: true }, { ...body, requestId: 'x' }
    ].map((b) => alice.post(base).send(b).expect(400)));
    assert.ok(refused.every((r) => r.body.code === 400.62));

    // Adding findings: revision required, checked, and only new ones recorded.
    await alice.post(`${path}/findings`).send({ findingIds: [f.c] }).expect(428);
    await alice.post(`${path}/findings`).set('If-Match', 'investigation-1').send({ findingIds: [f.c] }).expect(400);
    await alice.post(`${path}/findings`).set('If-Match', '"investigation-9"').send({ findingIds: [f.c] }).expect(412);
    await alice.post(`${path}/findings`).set('If-Match', '"investigation-1"').send({ findingIds: [f.foreign] }).expect(400);
    const added = await alice.post(`${path}/findings`).set('If-Match', '"investigation-1"').send({ findingIds: [f.b, f.c] }).expect(200);
    assert.equal(added.headers.etag, '"investigation-2"');
    assert.deepEqual(added.body.findings.map((x) => x.id), [f.a, f.b, f.c]);
    assert.deepEqual(added.body.events.at(-1).findingIds, [f.c]);
    const again = await alice.post(`${path}/findings`).set('If-Match', '"investigation-2"').send({ findingIds: [f.c] }).expect(200);
    assert.equal(again.headers.etag, '"investigation-2"');
    assert.equal(again.body.events.length, 2);

    // A note needs no revision and changes none.
    const noted = await alice.post(`${path}/notes`).send({ note: 'Both work the same villages; checking schedules.' }).expect(201);
    assert.equal(noted.headers.etag, '"investigation-2"');
    await alice.post(`${path}/notes`).send({ note: '' }).expect(400);

    // Closing needs a disposition and a conclusion, once.
    await alice.post(`${path}/close`).set('If-Match', '"investigation-2"').send({ disposition: 'guilty', conclusion: 'x' }).expect(400);
    await alice.post(`${path}/close`).set('If-Match', '"investigation-2"').send({ disposition: 'benign-pattern', conclusion: '  ' }).expect(400);
    const closed = await alice.post(`${path}/close`).set('If-Match', '"investigation-2"')
      .send({ disposition: 'benign-pattern', conclusion: 'Same households by design: a shared listing.' }).expect(200);
    assert.equal(closed.headers.etag, '"investigation-3"');
    assert.equal(closed.body.status, 'closed');
    assert.equal(closed.body.disposition, 'benign-pattern');
    const state = await alice.post(`${path}/close`).set('If-Match', '"investigation-3"').send({ disposition: 'data-error', conclusion: 'x' }).expect(409);
    assert.equal(state.body.code, 409.39);
    await alice.post(`${path}/findings`).set('If-Match', '"investigation-3"').send({ findingIds: [f.a] }).expect(409);
    await alice.post(`${path}/notes`).send({ note: 'Collector B asked for the record to be reviewed.' }).expect(201);

    // Reopening, with a reason, is how a disposition is appealed; the closure stays in the history.
    await alice.post(`${path}/reopen`).set('If-Match', '"investigation-3"').send({ reason: '' }).expect(400);
    const reopened = await alice.post(`${path}/reopen`).set('If-Match', '"investigation-3"').send({ reason: 'New backcheck results.' }).expect(200);
    assert.equal(reopened.headers.etag, '"investigation-4"');
    assert.equal(reopened.body.status, 'open');
    assert.equal(reopened.body.disposition, null);
    await alice.post(`${path}/reopen`).set('If-Match', '"investigation-4"').send({ reason: 'Again.' }).expect(409);
    assert.deepEqual(reopened.body.events.map((e) => [e.kind, e.disposition, e.note]), [
      ['opened', null, null], ['findings-added', null, null],
      ['note', null, 'Both work the same villages; checking schedules.'],
      ['closed', 'benign-pattern', 'Same households by design: a shared listing.'],
      ['note', null, 'Collector B asked for the record to be reviewed.'],
      ['reopened', null, 'New backcheck results.']
    ]);
    assert.deepEqual((await alice.get(path).expect(200)).body, reopened.body);

    // The list, newest activity first, with a status filter.
    await alice.post(base).send({ requestId: uuid(6), title: 'Second', findingIds: [] }).expect(201);
    const listed = (await alice.get(base).expect(200)).body;
    assert.deepEqual(listed.map((v) => [v.title, v.findings]), [['Second', 0], ['Collectors A and B keep matching', 3]]);
    assert.deepEqual((await alice.get(base).query({ status: 'closed' }).expect(200)).body, []);
    await alice.get(base).query({ status: 'any' }).expect(400);

    // Nothing else changed.
    assert.deepEqual(await all(sql`SELECT id, outcome, status, decision, note FROM field_data_integrity_flags ORDER BY id`), findingsBefore);
    assert.equal(await oneFirst(sql`SELECT count(*)::integer FROM field_data_review_cases`), casesBefore);
    assert.equal(await oneFirst(sql`SELECT count(*)::integer FROM audits WHERE action LIKE 'field_data.investigation.%'`), 4);
    await alice.get(`${base}/${uuid(99)}`).expect(404);
    await alice.get(`${base}/nope`).expect(404);
  }));

  it('keeps the history append-only in the database', testService(async (service, container) => {
    const { alice, f } = await seed(service, container);
    const { run, oneFirst } = container;
    const { id } = (await alice.post(base).send({ requestId: uuid(1), title: 'History', findingIds: [f.a] }).expect(201)).body;
    const refused = async (statement) => {
      await run(sql`SAVEPOINT guard`);
      await assert.rejects(run(statement), /append-only|not deleted/);
      await run(sql`ROLLBACK TO SAVEPOINT guard`);
    };
    await refused(sql`UPDATE field_data_investigation_events SET note = 'rewritten' WHERE "investigationId" = ${id}`);
    await refused(sql`UPDATE field_data_investigation_events SET kind = 'note' WHERE "investigationId" = ${id}`);
    await refused(sql`DELETE FROM field_data_investigation_events WHERE "investigationId" = ${id}`);
    await refused(sql`DELETE FROM field_data_investigations WHERE id = ${id}`);
    assert.equal(await oneFirst(sql`SELECT count(*)::integer FROM field_data_investigation_events WHERE "investigationId" = ${id}`), 1);
    // Only the actor link may clear.
    await run(sql`UPDATE field_data_investigation_events SET "actorId" = NULL WHERE "investigationId" = ${id}`);
  }));

  it('is only for those who manage the project, and hides findings of forms they may not read', testService(async (service, container) => {
    const { alice, f } = await seed(service, container);
    const { id } = (await alice.post(base).send({ requestId: uuid(1), title: 'Access', findingIds: [f.a, f.c] }).expect(201)).body;
    const chelsea = await service.login('chelsea');
    const chelseaId = (await chelsea.get('/v1/users/current').expect(200)).body.id;
    await chelsea.get(base).expect(403);
    await alice.post(`/v1/projects/1/assignments/viewer/${chelseaId}`).expect(200);
    await chelsea.get(base).expect(403);
    await chelsea.get(`${base}/${id}`).expect(403);
    await chelsea.post(`${base}/${id}/notes`).send({ note: 'Viewer note' }).expect(403);
    await alice.post(`/v1/projects/1/assignments/manager/${chelseaId}`).expect(200);
    assert.equal((await chelsea.get(base).expect(200)).body.length, 1);

    const appUser = (await alice.post('/v1/projects/1/app-users').send({ displayName: 'Collector' }).expect(200)).body;
    await service.get(`/v1/key/${appUser.token}/projects/1/investigations`).expect(403);

    // A finding of a deleted form is no longer shown, only counted.
    await alice.delete('/v1/projects/1/forms/withrepeat').expect(200);
    const detail = (await alice.get(`${base}/${id}`).expect(200)).body;
    assert.deepEqual(detail.findings.map((x) => x.id), [f.a]);
    assert.equal(detail.hiddenFindings, 1);
    await alice.get('/v1/projects/999/investigations').expect(404);
  }));
});
