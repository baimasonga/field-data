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
  it('adds up how investigations ended (F7)', testService(async (service, container) => {
    const { alice, f } = await seed(service, container);
    const { one, run, all } = container;
    const bob = await service.login('bob');
    await bob.post('/v1/projects/1/forms/simple/submissions').send(testData.instances.simple.two)
      .set('Content-Type', 'application/xml').expect(200);
    const flag = (rule, instanceId, relatedInstanceId = null) => one(sql`INSERT INTO field_data_integrity_flags
        ("formId", rule, "ruleVersion", "instanceId", "relatedInstanceId", outcome, evidence)
      SELECT id, ${rule}, 1, ${instanceId}, ${relatedInstanceId}, 'concern', '{}'::jsonb
      FROM forms WHERE "projectId" = 1 AND "xmlFormId" = 'simple' RETURNING id`)
      .then((r) => r.id);
    const pair = await flag('near-duplicate', 'one', 'two');
    const contradiction = await flag('contradiction:abc', 'one');
    const nobody = await flag('manual-unknown', 'three');
    const outcomes = `${base}/outcomes`;

    const empty = (await alice.get(outcomes).expect(200)).body;
    assert.equal(empty.timeToClose, null);
    assert.deepEqual([empty.status, empty.families, empty.collectors, empty.hiddenFindings], [{ open: 0, closed: 0, reopened: 0 }, [], [], 0]);
    assert.equal(empty.months.length, 12);

    const open = async (n, findingIds) => (await alice.post(base).send({ requestId: uuid(n), title: `Inquiry ${n}`, findingIds }).expect(201)).body;
    const close = (v, disposition) => alice.post(`${base}/${v.id}/close`).set('If-Match', `"investigation-${v.revision}"`)
      .send({ disposition, conclusion: 'Done.' })
      .expect(200)
      .then((r) => r.body);
    const first = await close(await open(1, [pair, contradiction]), 'confirmed-issue');
    await run(sql`UPDATE field_data_investigations SET "openedAt" = "openedAt" - interval '10 days' WHERE id = ${first.id}`);
    await close(await open(2, [pair, nobody]), 'data-error');
    await close(await open(3, [f.c]), 'benign-pattern');
    await open(4, [contradiction]);
    const fifth = await close(await open(5, [f.a]), 'policy-exception');
    await alice.post(`${base}/${fifth.id}/reopen`).set('If-Match', `"investigation-${fifth.revision}"`).send({ reason: 'More to see.' }).expect(200);

    const before = await all(sql`SELECT * FROM field_data_investigation_events ORDER BY id`);
    const result = await alice.get(outcomes).expect(200);
    assert.equal(result.headers['cache-control'], 'private, no-store');
    const { body } = result;
    assert.deepEqual(body.status, { open: 2, closed: 3, reopened: 1 });
    assert.deepEqual(body.dispositions, { 'confirmed-issue': 1, 'data-error': 1, 'benign-pattern': 1,
      'insufficient-evidence': 0, 'policy-exception': 0, duplicate: 0 });
    assert.deepEqual(body.timeToClose, { median: 0, longest: 10 });
    const month = new Date().toISOString().slice(0, 7);
    assert.deepEqual(body.months.at(-1), { month, 'confirmed-issue': 1, 'data-error': 1, 'benign-pattern': 1,
      'insufficient-evidence': 0, 'policy-exception': 0, duplicate: 0 });
    // The pair finding is in two closed investigations: counted under the later one.
    const counts = (rows, key) => rows.map((r) => [r[key], r.total, r['confirmed-issue'], r['data-error'], r['benign-pattern']]);
    assert.deepEqual(counts(body.families, 'family'), [['contradiction', 1, 1, 0, 0], ['similarity', 1, 0, 1, 0], ['other', 2, 0, 1, 1]]);
    // Both collectors of the pair; submissions no one is known to have sent
    // (the withrepeat finding's submission was never sent).
    assert.deepEqual(counts(body.collectors, 'displayName'), [['Alice', 2, 1, 1, 0], ['Bob', 2, 1, 1, 0], [null, 2, 0, 1, 1]]);
    assert.equal(body.collectors[2].actorId, null);
    assert.equal(body.hiddenFindings, 0);
    assert.deepEqual(await all(sql`SELECT * FROM field_data_investigation_events ORDER BY id`), before);

    // Findings of a form that cannot be read are counted, not shown.
    await alice.delete('/v1/projects/1/forms/withrepeat').expect(200);
    const hidden = (await alice.get(outcomes).expect(200)).body;
    assert.equal(hidden.hiddenFindings, 1);
    assert.deepEqual(counts(hidden.families, 'family'), [['contradiction', 1, 1, 0, 0], ['similarity', 1, 0, 1, 0], ['other', 1, 0, 1, 0]]);
    assert.deepEqual(hidden.collectors.map((c) => [c.displayName, c.total]), [['Alice', 2], ['Bob', 2], [null, 1]]);
    assert.deepEqual(hidden.dispositions, body.dispositions);

    // Only for those who manage the project.
    const chelsea = await service.login('chelsea');
    const chelseaId = (await chelsea.get('/v1/users/current').expect(200)).body.id;
    await alice.post(`/v1/projects/1/assignments/viewer/${chelseaId}`).expect(200);
    await chelsea.get(outcomes).expect(403);
    const appUser = (await alice.post('/v1/projects/1/app-users').send({ displayName: 'Collector' }).expect(200)).body;
    await service.get(`/v1/key/${appUser.token}/projects/1/investigations/outcomes`).expect(403);
    await alice.get('/v1/projects/999/investigations/outcomes').expect(404);
  }));
  it('finds the other collector of a pair in the form its evidence names and counts only this project (F7)', testService(async (service, container) => {
    const { alice, f } = await seed(service, container);
    const bob = await service.login('bob');
    await bob.post('/v1/projects/1/forms/withrepeat/submissions').send(testData.instances.withrepeat.two)
      .set('Content-Type', 'application/xml').expect(200);
    // The same instance ID in another form, sent by someone else, is not the pair's.
    const chelsea = await service.login('chelsea');
    const chelseaId = (await chelsea.get('/v1/users/current').expect(200)).body.id;
    await alice.post(`/v1/projects/1/assignments/manager/${chelseaId}`).expect(200);
    await chelsea.post('/v1/projects/1/forms/simple/submissions')
      .send(testData.instances.simple.one.replace('<instanceID>one</instanceID>', '<instanceID>rtwo</instanceID>'))
      .set('Content-Type', 'application/xml')
      .expect(200);
    const evidence = JSON.stringify({ others: [{ xmlFormId: 'withrepeat', instanceId: 'rtwo' }] });
    const flag = (instanceId, relatedInstanceId, json) => container.one(sql`INSERT INTO field_data_integrity_flags
        ("formId", rule, "ruleVersion", "instanceId", "relatedInstanceId", outcome, evidence)
      SELECT id, 'near-duplicate', 1, ${instanceId}, ${relatedInstanceId}, 'concern', ${json}::jsonb
      FROM forms WHERE "projectId" = 1 AND "xmlFormId" = 'simple' RETURNING id`);
    const { id: pair } = await flag('one', 'rtwo', evidence);
    // A finding whose own submission is missing is not given another form's.
    const { id: missing } = await flag('rone', null, '{}');
    const closeOne = async (projectId, n, findingIds) => {
      const v = (await alice.post(`/v1/projects/${projectId}/investigations`)
        .send({ requestId: uuid(n), title: `Inquiry ${n}`, findingIds }).expect(201)).body;
      await alice.post(`/v1/projects/${projectId}/investigations/${v.id}/close`).set('If-Match', '"investigation-1"')
        .send({ disposition: 'insufficient-evidence', conclusion: 'Done.' })
        .expect(200);
    };
    await closeOne(1, 1, [pair, missing]);
    const otherProject = await container.oneFirst(sql`SELECT "projectId" FROM forms f
      JOIN field_data_integrity_flags i ON i."formId" = f.id WHERE i.id = ${f.foreign}`);
    await closeOne(otherProject, 2, [f.foreign]);

    const { body } = await alice.get(`${base}/outcomes`).expect(200);
    assert.deepEqual(body.status, { open: 0, closed: 1, reopened: 0 });
    assert.equal(body.hiddenFindings, 0);
    assert.deepEqual(body.families.map((r) => [r.family, r.total]), [['similarity', 2]]);
    assert.deepEqual(body.collectors.map((c) => [c.displayName, c['insufficient-evidence']]), [['Alice', 1], ['Bob', 1], [null, 1]]);
  }));
});
