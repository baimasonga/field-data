// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
//
// Backcheck agreement (O5): docs/field-intelligence/O5-backcheck-agreement.md

require('should');
const assert = require('node:assert/strict');
const { sql } = require('slonik');
const { testService } = require('../setup');
const testData = require('../../data/xml');

// Start and end are recorded automatically and a calculation copies the name:
// only name and age are asked.
const visitForm = `<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa">
  <h:head><h:title>Visit</h:title><model>
    <instance><data id="visit"><start/><end/><name/><age/><copy/><meta><instanceID/></meta></data></instance>
    <bind nodeset="/data/start" type="dateTime" jr:preload="timestamp" jr:preloadParams="start"/>
    <bind nodeset="/data/end" type="dateTime" jr:preload="timestamp" jr:preloadParams="end"/>
    <bind nodeset="/data/name" type="string"/>
    <bind nodeset="/data/age" type="int"/>
    <bind nodeset="/data/copy" type="string" calculate="/data/name"/>
    <bind nodeset="/data/meta/instanceID" type="string" readonly="true()" calculate="concat('uuid:', uuid())"/>
  </model></h:head>
  <h:body>
    <input ref="/data/name"><label>Respondent name</label></input>
    <input ref="/data/age"><label>Respondent age</label></input>
  </h:body>
</h:html>`;
const visit = (id, name, age, at) => `<data id="visit"><start>${at}</start><end>${at}</end><name>${name}</name><age>${age}</age><copy>${name}</copy><meta><instanceID>${id}</instanceID></meta></data>`;
const simple2 = (id, name, age) => testData.instances.simple2.one.replace('s2one', id).replace('>Alice<', `>${name}<`).replace('>30<', `>${age}<`);
const path = '/v1/projects/1/forms/visit/backcheck-agreement';

const setup = async (service, { one, run }) => {
  const alice = await service.login('alice');
  await alice.post('/v1/projects/1/forms?publish=true').send(visitForm).set('Content-Type', 'application/xml').expect(200);
  await alice.post('/v1/projects/1/forms?publish=true').send(testData.forms.simple2).set('Content-Type', 'application/xml').expect(200);
  const appUser = async (displayName, forms) => {
    const user = (await alice.post('/v1/projects/1/app-users').send({ displayName }).expect(200)).body;
    await Promise.all(forms.map((f) => alice.post(`/v1/projects/1/forms/${f}/assignments/app-user/${user.id}`).expect(200)));
    return user;
  };
  const awa = await appUser('Awa', ['visit']);
  const bai = await appUser('Bai', ['visit']);
  const checker = await appUser('Checker', ['visit', 'simple2']);
  const submit = (user, xmlFormId, xml) => service.post(`/v1/key/${user.token}/projects/1/forms/${xmlFormId}/submissions`)
    .send(xml).set('Content-Type', 'application/xml').expect(200);
  const requested = (await alice.get('/v1/users/current').expect(200)).body.id;
  let n = 0;
  // A linked backcheck of `original` (a visit) answered by `response`.
  const link = async (original, xmlFormId, response) => {
    n += 1;
    const instanceId = /<(?:orx:)?instanceID>([^<]+)</.exec(response)[1];
    await submit(checker, xmlFormId, response);
    const version = await one(sql`SELECT v.id FROM field_data_claim_versions v
      JOIN submission_defs sd ON sd.id = v."submissionDefId" AND sd.current
      JOIN submissions s ON s.id = sd."submissionId" JOIN forms f ON f.id = s."formId"
      WHERE f."projectId" = 1 AND f."xmlFormId" = 'visit' AND s."instanceId" = ${original}`);
    const existing = await one(sql`SELECT count(*)::integer AS n FROM field_data_review_cases WHERE "claimVersionId" = ${version.id}`);
    const reviewCase = existing.n > 0
      ? await one(sql`SELECT id FROM field_data_review_cases WHERE "claimVersionId" = ${version.id} ORDER BY "openedAt" DESC LIMIT 1`)
      : await one(sql`INSERT INTO field_data_review_cases ("claimVersionId", "reasonCodes") VALUES (${version.id}, '["manual"]'::jsonb) RETURNING id`);
    return one(sql`INSERT INTO field_data_backchecks ("caseId", "claimVersionId", "requestId", "requestHash", "requestedBy", "assignedTo",
        question, status, "responseSubmissionDefId", "responseInstanceId", "linkedBy", "linkedAt", "responseFormId")
      SELECT ${reviewCase.id}, ${version.id}, gen_random_uuid(), repeat('0', 64), ${requested}, ${checker.id}, 'Revisit.', 'linked',
        sd.id, s."instanceId", ${requested}, clock_timestamp() + ${n} * interval '1 second', ${xmlFormId === 'visit' ? null : sql`f.id`}
      FROM submission_defs sd JOIN submissions s ON s.id = sd."submissionId" AND sd.current JOIN forms f ON f.id = s."formId"
      WHERE f."projectId" = 1 AND f."xmlFormId" = ${xmlFormId} AND s."instanceId" = ${instanceId}
      RETURNING id, "caseId"`);
  };
  return { alice, awa, bai, checker, submit, link, run };
};

describe('api: backcheck agreement (O5)', () => {
  it('adds up comparisons by collector and question, counting only asked questions', testService(async (service, container) => {
    const { alice, awa, bai, submit, link } = await setup(service, container);
    await submit(awa, 'visit', visit('a1', 'Ama', 30, '2026-01-01T08:00:00Z'));
    await submit(awa, 'visit', visit('a2', 'Abu', 41, '2026-01-01T09:00:00Z'));
    await submit(bai, 'visit', visit('b1', 'Binta', 25, '2026-01-01T10:00:00Z'));
    await submit(bai, 'visit', visit('b2', 'Bockarie', 52, '2026-01-01T11:00:00Z'));
    assert.deepEqual((await alice.get(path).expect(200)).body, {
      backchecks: { linked: 0, used: 0, truncated: false, compared: 0, unavailable: {}, notReadable: 0 }, collectors: [], questions: []
    });

    // Revisits on another day: start, end differ but are not asked; the copy follows the name.
    await link('a1', 'visit', visit('r1', 'Ama', 31, '2026-02-01T08:00:00Z'));
    await link('a2', 'visit', visit('r2', 'Abu', 41, '2026-02-01T09:00:00Z'));
    await link('b1', 'visit', visit('r3', 'Binta', 25, '2026-02-01T10:00:00Z'));
    // Another form: compared through its mapping once one is saved.
    const mapped = await link('b2', 'simple2', simple2('r4', 'Bockarie', 50));
    const unmapped = await link('a1', 'simple2', simple2('r5', 'Ama', 30));

    const before = (await alice.get(path).expect(200)).body;
    assert.deepEqual(before.backchecks, { linked: 5, used: 5, truncated: false, compared: 3, unavailable: { 'no-mapping': 2 }, notReadable: 0 });
    const comparison = (await alice.get(`/v1/field-data/review-queue/${mapped.caseId}/backchecks/${mapped.id}/comparison`).expect(200)).body;
    await alice.post(`/v1/field-data/review-queue/${mapped.caseId}/backchecks/${mapped.id}/mapping`)
      .set('If-Match', comparison.mapping.etag)
      .send({ requestId: '00000000-0000-4000-8000-000000000501', note: 'Same questions.',
        pairs: [{ originalPath: '/age[1]', backcheckPath: '/age[1]', label: 'Age (mapped)' },
          { originalPath: '/name[1]', backcheckPath: '/name[1]', label: '' }] })
      .expect(201);

    const { body, headers } = await alice.get(path).expect(200);
    assert.equal(headers['cache-control'], 'private, no-store');
    assert.deepEqual(body.backchecks, { linked: 5, used: 5, truncated: false, compared: 4, unavailable: { 'no-mapping': 1 }, notReadable: 0 });
    assert.deepEqual(body.collectors, [
      { actorId: awa.id, displayName: 'Awa', backchecks: 2, withDifferences: 1, fields: 4, different: 1, missing: 0 },
      { actorId: bai.id, displayName: 'Bai', backchecks: 2, withDifferences: 1, fields: 4, different: 1, missing: 0 }
    ]);
    assert.deepEqual(body.questions, [
      { question: 'mapped:Age (mapped)', label: 'Age (mapped)', fields: 1, different: 1, missing: 0 },
      { question: '/age', label: 'Respondent age', fields: 3, different: 1, missing: 0 },
      { question: '/name', label: 'Respondent name', fields: 3, different: 0, missing: 0 },
      { question: 'mapped:Respondent name', label: 'Respondent name', fields: 1, different: 0, missing: 0 }
    ]);
    // Only counts: no answer leaves the server.
    for (const answer of ['Ama', 'Abu', 'Binta', 'Bockarie', '2026-'])
      assert.ok(!JSON.stringify(body).includes(answer), answer);
    assert.ok(unmapped.id);
  }));

  it('leaves out deleted sources, and counts integrity failures and unreadable response forms', testService(async (service, container) => {
    const { alice, awa, submit, link, run } = await setup(service, container);
    await submit(awa, 'visit', visit('a1', 'Ama', 30, '2026-01-01T08:00:00Z'));
    await submit(awa, 'visit', visit('a2', 'Abu', 41, '2026-01-01T09:00:00Z'));
    await submit(awa, 'visit', visit('a3', 'Aisha', 19, '2026-01-01T10:00:00Z'));
    await link('a1', 'visit', visit('r1', 'Ama', 30, '2026-02-01T08:00:00Z'));
    await link('a2', 'visit', visit('r2', 'Abu', 41, '2026-02-01T09:00:00Z'));
    await link('a3', 'simple2', simple2('r3', 'Aisha', 19));
    await link('a3', 'visit', visit('r4', 'Aisha', 19, '2026-02-01T10:00:00Z'));

    // Stored bytes no longer match what was received.
    await run(sql`UPDATE submission_defs SET xml = replace(xml, '>41<', '>14<') WHERE "instanceId" = 'r2'`);
    // A deleted response or original takes its backcheck out.
    await alice.delete('/v1/projects/1/forms/visit/submissions/r4').expect(200);
    const { body } = await alice.get(path).expect(200);
    assert.deepEqual(body.backchecks, { linked: 3, used: 3, truncated: false, compared: 1, unavailable: { 'source-integrity': 1, 'no-mapping': 1 }, notReadable: 0 });
    await alice.delete('/v1/projects/1/forms/visit/submissions/a1').expect(200);
    assert.equal((await alice.get(path).expect(200)).body.backchecks.linked, 2);

    // Someone who may read this form's submissions but not the response form's.
    const chelsea = await service.login('chelsea');
    await chelsea.get(path).expect(403);
    const chelseaId = (await chelsea.get('/v1/users/current').expect(200)).body.id;
    await alice.post(`/v1/projects/1/forms/visit/assignments/viewer/${chelseaId}`).expect(200);
    const viewed = (await chelsea.get(path).expect(200)).body;
    assert.equal(viewed.backchecks.notReadable, 1);
    assert.deepEqual(viewed.backchecks.unavailable, { 'source-integrity': 1 });
    await alice.post(`/v1/projects/1/forms/simple2/assignments/viewer/${chelseaId}`).expect(200);
    assert.equal((await chelsea.get(path).expect(200)).body.backchecks.notReadable, 0);

    await service.get(`/v1/key/${awa.token}/projects/1/forms/visit/backcheck-agreement`).expect(403);
    await alice.get('/v1/projects/1/forms/missing/backcheck-agreement').expect(404);
  }));
});
