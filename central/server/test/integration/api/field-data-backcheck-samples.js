// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// O3 random backcheck sample through the real routes:
// docs/field-intelligence/O3-backcheck-sample.md

require('should');
const config = require('config');
const { sql } = require('slonik');
const { knexConnect } = require('../../../lib/model/knex-migrator');
const sampleMigration = require('../../../lib/model/migrations/20261010-05-add-backcheck-samples');
const { LIMITS, draw } = require('../../../lib/util/backcheck-sample');
const { testService, testServiceFullTrx } = require('../setup');
const testData = require('../../data/xml');

/* eslint-disable no-await-in-loop */

const base = '/v1/projects/1/forms/simple/backcheck-samples';
const requestId = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const instance = (id) => testData.instances.simple.one.replace('one</instanceID>', `${id}</instanceID>`);

// Two App User collectors (six and two submissions) and alice on the web (one).
const setUp = async (service) => {
  const alice = await service.login('alice');
  const collectors = [];
  for (const [name, count] of [['Collector A', 6], ['Collector B', 2]]) {
    const appUser = (await alice.post('/v1/projects/1/app-users').send({ displayName: name }).expect(200)).body;
    await alice.post(`/v1/projects/1/forms/simple/assignments/app-user/${appUser.id}`).expect(200);
    for (let i = 0; i < count; i += 1)
      await service.post(`/v1/key/${appUser.token}/projects/1/forms/simple/submissions`)
        .send(instance(`${name.slice(-1)}${i}`)).set('Content-Type', 'application/xml').expect(200);
    collectors.push(appUser);
  }
  await alice.post('/v1/projects/1/forms/simple/submissions').send(instance('web0')).set('Content-Type', 'application/xml').expect(200);
  return { alice, a: collectors[0], b: collectors[1] };
};

const casesOf = (all, prefix) => all(sql`SELECT s."instanceId", c.id, c.status, c."reasonCodes", c.revision
  FROM submissions s JOIN submission_defs sd ON sd."submissionId" = s.id AND sd.current
  JOIN field_data_claim_versions v ON v."submissionDefId" = sd.id
  JOIN field_data_review_cases c ON c."claimVersionId" = v.id
  WHERE s."instanceId" LIKE ${`${prefix}%`} ORDER BY s."instanceId"`);

const polygonBox = (value, x, y, size = 2) => ({ value, geometry: { type: 'Polygon', coordinates: [[[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]] } });
const publishGeopoint = alice => alice.post('/v1/projects/1/forms?publish=true').send(testData.forms.simple.replace('id="simple"', 'id="locations"').replace('type="int"', 'type="geopoint"')).set('Content-Type', 'application/xml').expect(200);
const submitPoint = (alice, id, point) => alice.post('/v1/projects/1/forms/locations/submissions').send(instance(id).replace('id="simple"', 'id="locations"').replace('<age>30</age>', `<age>${point}</age>`)).set('Content-Type', 'application/xml').expect(200);

describe('api: O3 random backcheck sample', () => {
  it('draws per collector, routes into review, and can be recomputed from its seed', testService(async (service, { run, all }) => {
    const { alice, a, b } = await setUp(service);
    // A's submissions have no case yet, B's are already decided, web0's is open.
    await run(sql`DELETE FROM field_data_review_cases c USING field_data_claim_versions v, submission_defs sd, submissions s
      WHERE c."claimVersionId" = v.id AND v."submissionDefId" = sd.id AND sd."submissionId" = s.id AND s."instanceId" LIKE 'A%'`);
    await run(sql`UPDATE field_data_review_cases c SET status = 'resolved', "resolvedAt" = now()
      FROM field_data_claim_versions v, submission_defs sd, submissions s
      WHERE c."claimVersionId" = v.id AND v."submissionDefId" = sd.id AND sd."submissionId" = s.id AND s."instanceId" LIKE 'B%'`);
    const [webBefore] = await casesOf(all, 'web');
    (await casesOf(all, 'A')).length.should.equal(0);

    const created = await alice.post(base).send({ requestId: requestId(1), rate: 34, minPerCollector: 1 }).expect(201);
    created.headers['idempotency-status'].should.equal('created');
    const sample = created.body;
    sample.should.containEql({ eligible: 9, sampledBefore: 0, sampled: 5, routed: 4, alreadyDecided: 1 });
    sample.settings.should.eql({ rate: 34, minPerCollector: 1, receivedFrom: null, receivedTo: null });
    sample.seed.should.match(/^[0-9a-f]{32}$/);
    // ceil(34% of 6) = 3, ceil(34% of 2) = 1, the minimum of 1 for one.
    sample.collectors.map((c) => [c.displayName, c.eligible, c.sampled, c.requested]).should.eql([
      ['Alice', 1, 1, 0], ['Collector A', 6, 3, 0], ['Collector B', 2, 1, 0]
    ]);
    sample.items.filter((i) => i.submitterId === b.id)[0].should.containEql({ routing: 'already-decided', caseStatus: 'resolved' });

    // A: new open cases with only the sample's reason; B: untouched; web0: reason added.
    const aCases = await casesOf(all, 'A');
    aCases.length.should.equal(3);
    aCases.forEach((c) => c.should.containEql({ status: 'open', reasonCodes: ['backcheck-sample'] }));
    aCases.map((c) => c.id).sort().should.eql(sample.items.filter((i) => i.submitterId === a.id).map((i) => i.caseId).sort());
    (await casesOf(all, 'B')).forEach((c) => c.reasonCodes.should.not.containEql('backcheck-sample'));
    const [webAfter] = await casesOf(all, 'web');
    webAfter.reasonCodes.should.eql([...webBefore.reasonCodes, 'backcheck-sample']);
    webAfter.revision.should.equal(webBefore.revision + 1);
    const queue = (await alice.get('/v1/field-data/review-queue?projectId=1&xmlFormId=simple&reasonCode=backcheck-sample').expect(200)).body;
    queue.items.length.should.equal(4);

    // Anyone with the seed and the eligible list gets the same items.
    const full = (await alice.get(`${base}/${sample.id}?eligible=true`).expect(200)).body;
    full.eligibleList.length.should.equal(9);
    const again = draw(full.eligibleList, full.settings, full.seed).chosen.map((c) => c.instanceId).sort();
    again.should.eql(sample.items.map((i) => i.instanceId).sort());
    (await alice.get(`${base}/${sample.id}`).expect(200)).body.should.not.have.property('eligibleList');

    // The draw is audited.
    const [audit] = await all(sql`SELECT details FROM audits WHERE action = 'field_data.backcheck_sample.draw'`);
    audit.details.should.containEql({ sampleId: sample.id, seed: sample.seed, eligible: 9, sampled: 5 });

    // A second sample skips the first one's submissions.
    const second = (await alice.post(base).send({ requestId: requestId(2), rate: 100, minPerCollector: 0 }).expect(201)).body;
    second.should.containEql({ eligible: 4, sampledBefore: 5, sampled: 4 });
    second.items.map((i) => i.instanceId).should.not.containDeep(sample.items.map((i) => i.instanceId));
    (await alice.get(base).expect(200)).body.map((s) => s.id).should.eql([second.id, sample.id]);
    // Nothing is left to sample.
    (await alice.post(base).send({ requestId: requestId(3), rate: 100 }).expect(201)).body
      .should.containEql({ eligible: 0, sampledBefore: 9, sampled: 0 });
  }));

  it('is safe to retry, and refuses invalid or too large draws without changing anything', testService(async (service, { all }) => {
    const { alice } = await setUp(service);
    const body = { requestId: requestId(1), rate: 10 };
    const first = (await alice.post(base).send(body).expect(201)).body;
    const replay = await alice.post(base).send(body).expect(200);
    replay.headers['idempotency-status'].should.equal('replayed');
    replay.body.id.should.equal(first.id);
    (await alice.post(base).send({ ...body, rate: 20 }).expect(400)).body.should.containEql({ code: 400.58 });

    const before = await all(sql`SELECT c.id, c."reasonCodes", c.revision FROM field_data_review_cases c ORDER BY c.id`);
    for (const bad of [{ rate: 10 }, { requestId: 'x', rate: 10 }, { requestId: requestId(2), rate: 0 },
      { requestId: requestId(2), rate: 10, minPerCollector: 21 }, { requestId: requestId(2), rate: 10, receivedFrom: '2026-13-01' },
      { requestId: requestId(2), rate: 10, seed: 'f'.repeat(32) }])
      (await alice.post(base).send(bad).expect(400)).body.code.should.equal(400.58);
    const max = LIMITS.maxSample;
    LIMITS.maxSample = 2;
    try {
      const refused = (await alice.post(base).send({ requestId: requestId(2), rate: 50 }).expect(400)).body;
      refused.code.should.equal(400.59);
      refused.message.should.match(/would take 4 submissions, more than the 2 allowed/);
    } finally { LIMITS.maxSample = max; }
    (await all(sql`SELECT id FROM field_data_backcheck_samples`)).length.should.equal(1);
    (await all(sql`SELECT c.id, c."reasonCodes", c.revision FROM field_data_review_cases c ORDER BY c.id`)).should.eql(before);

    // A date range outside the submissions finds nothing.
    (await alice.post(base).send({ requestId: requestId(3), rate: 100, receivedFrom: '2000-01-01', receivedTo: '2000-01-02' }).expect(201))
      .body.should.containEql({ eligible: 0, sampled: 0 });
    const today = new Date().toISOString().slice(0, 10);
    (await alice.post(base).send({ requestId: requestId(4), rate: 100, receivedFrom: today, receivedTo: today }).expect(201))
      .body.eligible.should.be.above(0);
  }));

  it('limits who can draw and read, and follows backchecks in its coverage', testService(async (service) => {
    const { alice, a, b } = await setUp(service);
    const sample = (await alice.post(base).send({ requestId: requestId(1), rate: 100, groupField: '/name', minPerCollector: 0 }).expect(201)).body;

    const chelsea = await service.login('chelsea');
    const chelseaId = (await chelsea.get('/v1/users/current').expect(200)).body.id;
    await chelsea.get(base).expect(403);
    await chelsea.get(`${base}/${sample.id}`).expect(403);
    await alice.post(`/v1/projects/1/assignments/viewer/${chelseaId}`).expect(200);
    await chelsea.get(base).expect(200);
    await chelsea.get(`${base}/${sample.id}`).expect(200);
    await chelsea.post(base).send({ requestId: requestId(2), rate: 10 }).expect(403);
    await service.get(`/v1/key/${a.token}/projects/1/forms/simple/backcheck-samples`).expect(403);
    await alice.get(`${base}/not-a-uuid`).expect(404);
    await alice.get(`${base}/${requestId(99)}`).expect(404);
    await alice.get('/v1/projects/1/forms/nope/backcheck-samples').expect(404);

    // A backcheck of one of A's sampled submissions, by B.
    const item = sample.items.find((i) => i.submitterId === a.id);
    const caseItem = (await alice.get(`/v1/field-data/review-queue/${item.caseId}`).expect(200)).body;
    const aliceId = (await alice.get('/v1/users/current').expect(200)).body.id;
    const assigned = await alice.patch(`/v1/field-data/review-queue/${item.caseId}/assignment`)
      .set('If-Match', `"review-case-${caseItem.revision}"`).set('Idempotency-Key', 'sample-assign')
      .send({ assignedTo: aliceId, status: 'in-review' })
      .expect(200);
    const path = `/v1/field-data/review-queue/${item.caseId}/backchecks`;
    // The original collector is refused; another one is not.
    await alice.post(path).set('If-Match', assigned.headers.etag)
      .send({ requestId: requestId(10), assignedTo: a.id, question: 'Revisit.', dueAt: null }).expect(400);
    const requested = await alice.post(path).set('If-Match', assigned.headers.etag)
      .send({ requestId: requestId(11), assignedTo: b.id, question: 'Revisit.', dueAt: null }).expect(201);
    const coverage = async () => (await alice.get(`${base}/${sample.id}`).expect(200)).body;
    let view = await coverage();
    view.collectors.find((c) => c.submitterId === a.id).should.containEql({ sampled: 6, requested: 1, linked: 0 });
    view.groups[0].should.containEql({ value: 'Alice', eligible: 9, sampled: 9, requested: 1, linked: 0 });
    view.items.find((i) => i.instanceId === item.instanceId).backcheck.should.equal('requested');

    await service.post(`/v1/key/${b.token}/projects/1/forms/simple/submissions`)
      .send(instance('revisit')).set('Content-Type', 'application/xml').expect(200);
    await alice.post(`${path}/${requested.body.id}/link`).set('If-Match', requested.headers.etag)
      .send({ instanceId: 'revisit' }).expect(200);
    view = await coverage();
    view.collectors.find((c) => c.submitterId === a.id).should.containEql({ requested: 1, linked: 1 });
    view.groups[0].should.containEql({ requested: 1, linked: 1 });
    view.items.find((i) => i.instanceId === item.instanceId).backcheck.should.equal('linked');
  }));

  it('groups exact decoded answers and missing values, retains immutable coverage and supports retry', testService(async (service, { all, run }) => {
    const alice = await service.login('alice');
    const values = ['North', ' North ', '<![CDATA[No]]>rth', 'South', 'South', '', 'A &amp; B'];
    for (const [i, value] of values.entries())
      await alice.post('/v1/projects/1/forms/simple/submissions').send(instance(`group${i}`).replace('<name>Alice</name>', `<name>${value}</name>`).replace('<data id=', '<data xmlns="urn:group-fixture" id='))
        .set('Content-Type', 'application/xml').expect(200);
    const { fields } = (await alice.get(`${base}/fields`).expect(200)).body;
    fields.map(f => f.path).should.containEql('/name'); fields.map(f => f.path).should.not.containEql('/meta/instanceID');
    const body = { requestId: requestId(41), rate: 50, minPerCollector: 1, groupField: '/name' };
    const sample = (await alice.post(base).send(body).expect(201)).body;
    sample.should.containEql({ eligible: 7, sampled: 5 });
    sample.groups.map(g => [g.value, g.eligible, g.sampled]).should.eql([['A & B', 1, 1], ['North', 3, 2], ['South', 2, 1], [null, 1, 1]]);
    const full = (await alice.get(`${base}/${sample.id}?eligible=true`).expect(200)).body;
    draw(full.eligibleList, full.settings, full.seed).chosen.map(c => c.instanceId).sort().should.eql(sample.items.map(i => i.instanceId).sort());
    (await alice.post(base).send(body).expect(200)).body.id.should.equal(sample.id);
    await alice.post(base).send({ ...body, groupField: '/age' }).expect(400);
    await run(sql`UPDATE submission_defs SET xml = replace(xml, 'North', 'Changed') WHERE current AND xml LIKE '%group%'`);
    (await alice.get(`${base}/${sample.id}`).expect(200)).body.groups.should.eql(sample.groups);
    (await all(sql`SELECT count(*)::integer AS n FROM field_data_backcheck_samples`))[0].n.should.equal(1);
    const chelsea = await service.login('chelsea');
    await chelsea.get(`${base}/fields`).expect(403);
    const chelseaId = (await chelsea.get('/v1/users/current').expect(200)).body.id;
    await alice.post(`/v1/projects/1/assignments/viewer/${chelseaId}`).expect(200);
    await chelsea.get(`${base}/fields`).expect(200); await chelsea.get(`${base}/${sample.id}`).expect(200);
    await chelsea.post(base).send({ ...body, requestId: requestId(42) }).expect(403);
  }));

  it('refuses unsupported fields, excessive categories, long or unreadable answers atomically', testService(async (service, { all, run }) => {
    const { alice, a } = await setUp(service);
    const body = { requestId: requestId(51), rate: 10, groupField: '/name' };
    for (const groupField of ['/nope', '/meta/instanceID', '/name[1]', '/name/../age'])
      await alice.post(base).send({ ...body, groupField }).expect(400);
    await service.get(`/v1/key/${a.token}/projects/1/forms/simple/backcheck-samples/fields`).expect(403);
    await run(sql`UPDATE submission_defs SET xml = replace(xml, 'Alice</name>', 'Other</name>') WHERE current AND xml LIKE '%web0</instanceID>%'`);
    await run(sql`UPDATE submission_defs SET xml = replace(xml, '<name>Alice</name>', '<name>Alice</name><name></name>') WHERE current AND xml LIKE '%A0</instanceID>%'`);
    await alice.post(base).send(body).expect(400);
    await run(sql`UPDATE submission_defs SET xml = replace(xml, '<name></name>', '') WHERE current AND xml LIKE '%A0</instanceID>%'`);
    const max = LIMITS.maxGroups; LIMITS.maxGroups = 1;
    try { await alice.post(base).send(body).expect(400); } finally { LIMITS.maxGroups = max; }
    await run(sql`UPDATE submission_defs SET xml = replace(xml, 'Alice</name>', ${`${'x'.repeat(201)}</name>`}) WHERE current AND xml LIKE '%A0</instanceID>%'`);
    await alice.post(base).send(body).expect(400);
    await run(sql`UPDATE submission_defs SET xml = replace(xml, ${'x'.repeat(201)}, 'Alice'), "localKey" = 'unreadable' WHERE current AND xml LIKE '%A0</instanceID>%'`);
    await alice.post(base).send(body).expect(400);
    (await all(sql`SELECT count(*)::integer AS n FROM field_data_backcheck_samples`))[0].n.should.equal(0);
    (await all(sql`SELECT count(*)::integer AS n FROM audits WHERE action = 'field_data.backcheck_sample.draw'`))[0].n.should.equal(0);
  }));

  it('records unequal rates, canonical retries and effective coverage atomically', testService(async (service, c) => {
    const alice = await service.login('alice');
    for (const [i, value] of ['North', 'North', 'North', 'South', 'South', '', '', 'null', 'null'].entries())
      await alice.post('/v1/projects/1/forms/simple/submissions').send(instance(`rates${i}`).replace('Alice</name>', `${value}</name>`)).set('Content-Type', 'application/xml').expect(200);
    const body = { requestId: requestId(50), rate: 10, minPerCollector: 0, groupField: '/name',
      groupRates: [{ value: null, rate: 100 }, { value: ' North ', rate: 100 }, { value: 'Future', rate: 70 }] };
    const sample = (await alice.post(base).send(body).expect(201)).body;
    sample.sampled.should.equal(7);
    sample.groups.map(g => [g.value, g.rate, g.eligible, g.sampled]).should.eql([['North', 100, 3, 3], ['South', 10, 2, 1], ['null', 10, 2, 1], [null, 100, 2, 2]]);
    sample.settings.groupRates.should.eql([{ value: 'Future', rate: 70 }, { value: 'North', rate: 100 }, { value: null, rate: 100 }]);
    const retry = await alice.post(base).send({ ...body, groupRates: [...body.groupRates].reverse() }).expect(200);
    retry.headers['idempotency-status'].should.equal('replayed'); retry.body.id.should.equal(sample.id);
    await alice.post(base).send({ ...body, groupRates: [{ value: null, rate: 50 }] }).expect(400);
    await alice.post(base).send({ ...body, requestId: requestId(51), groupRates: [{ value: 'North', rate: 10 }, { value: ' North ', rate: 20 }] }).expect(400);
    (await c.oneFirst(sql`SELECT count(*)::integer FROM field_data_backcheck_samples`)).should.equal(1);
    const full = (await alice.get(`${base}/${sample.id}?eligible=true`).expect(200)).body;
    draw(full.eligibleList, full.settings, full.seed).chosen.map(i => i.instanceId).sort().should.eql(sample.items.map(i => i.instanceId).sort());
  }));

  it('draws numeric ranges at exact boundaries and retains only reproducible range membership', testService(async (service, c) => {
    const alice = await service.login('alice');
    for (const [i, value] of ['17', '17.999999999999999999', '18', '+018.00', '34.999999999999999999', '35', '9007199254740993', ''].entries())
      await alice.post('/v1/projects/1/forms/simple/submissions').send(instance(`range${i}`).replace('<age>30</age>', `<age>${value}</age>`)).set('Content-Type', 'application/xml').expect(200);
    const body = { requestId: requestId(60), rate: 10, minPerCollector: 0, groupField: '/age', groupBreaks: ['18.00', '35'], groupRates: [{ value: 'Below 18', rate: 100 }] };
    const sample = (await alice.post(base).send(body).expect(201)).body;
    sample.groups.map(g => [g.value, g.rate, g.eligible, g.sampled]).should.eql([
      ['Below 18', 100, 2, 2], ['18 to below 35', 10, 3, 1], ['35 or above', 10, 2, 1], [null, 10, 1, 1]
    ]);
    const replay = await alice.post(base).send({ ...body, groupBreaks: ['+0018', '035.0'] }).expect(200);
    replay.body.id.should.equal(sample.id);
    await alice.post(base).send({ ...body, groupBreaks: ['18', '36'] }).expect(400);
    const full = (await alice.get(`${base}/${sample.id}?eligible=true`).expect(200)).body;
    full.eligibleList.forEach(e => Object.keys(e).sort().should.eql(['groupValue', 'instanceId', 'submitterId']));
    full.eligibleList.find(e => e.instanceId === 'range1').groupValue.should.equal('Below 18');
    draw(full.eligibleList, full.settings, full.seed).chosen.map(i => i.instanceId).sort().should.eql(sample.items.map(i => i.instanceId).sort());
    await c.run(sql`UPDATE submission_defs SET xml = replace(xml, '<age>17</age>', '<age>99</age>') WHERE current`);
    (await alice.get(`${base}/${sample.id}`).expect(200)).body.groups.should.eql(sample.groups);
    const audit = await c.oneFirst(sql`SELECT details FROM audits WHERE action = 'field_data.backcheck_sample.draw'`);
    audit.settings.groupBreaks.should.eql(['18', '35']);
    const weights = (await alice.get(`${base}/${sample.id}/weights`).expect(200)).body;
    weights.available.should.equal(true); weights.items.length.should.equal(sample.sampled);
  }));

  it('supports decimal questions with more than 100 distinct numeric answers', testService(async service => {
    const alice = await service.login('alice');
    await alice.post('/v1/projects/1/forms?publish=true').send(testData.forms.simple.replace('id="simple"', 'id="measure"').replace('type="int"', 'type="decimal"')).set('Content-Type', 'application/xml').expect(200);
    for (let i = 0; i <= 100; i += 1)
      await alice.post('/v1/projects/1/forms/measure/submissions').send(instance(`measure${i}`).replace('id="simple"', 'id="measure"').replace('<age>30</age>', `<age>${i}.25</age>`)).set('Content-Type', 'application/xml').expect(200);
    const result = (await alice.post('/v1/projects/1/forms/measure/backcheck-samples').send({ requestId: requestId(62), rate: 1, minPerCollector: 0, groupField: '/age', groupBreaks: ['50.25'] }).expect(201)).body;
    result.groups.map(g => [g.value, g.eligible, g.sampled]).should.eql([['Below 50.25', 50, 1], ['50.25 or above', 51, 1]]);
  }));

  it('refuses nonnumeric questions and unsafe numeric answers before writing any sample', testService(async (service, c) => {
    const alice = await service.login('alice');
    const body = { requestId: requestId(61), rate: 10, groupField: '/age', groupBreaks: ['18'] };
    await alice.post(base).send({ ...body, groupField: '/name' }).expect(400);
    await alice.post('/v1/projects/1/forms/simple/submissions').send(instance('bad-number').replace('<age>30</age>', '<age>not-a-number</age>')).set('Content-Type', 'application/xml').expect(200);
    const before = await c.all(sql`SELECT id, revision FROM field_data_review_cases ORDER BY id`);
    await alice.post(base).send(body).expect(400);
    (await c.oneFirst(sql`SELECT count(*)::integer FROM field_data_backcheck_samples`)).should.equal(0);
    (await c.oneFirst(sql`SELECT count(*)::integer FROM audits WHERE action = 'field_data.backcheck_sample.draw'`)).should.equal(0);
    (await c.all(sql`SELECT id, revision FROM field_data_review_cases ORDER BY id`)).should.eql(before);
  }));

  it('draws named polygons including edges, overlap, outside and missing with immutable range-free snapshots', testService(async (service, c) => {
    const alice = await service.login('alice'); await publishGeopoint(alice);
    const path = '/v1/projects/1/forms/locations/backcheck-samples';
    const groupAreas = [polygonBox('North', 10, 10), polygonBox('South', 11.5, 10)];
    for (const [i, point] of ['10.1 10.1', '10.2 10.2', '10 10', '10.2 11.7', '40 40', ''].entries()) await submitPoint(alice, `point${i}`, point);
    const body = { requestId: requestId(70), rate: 10, minPerCollector: 0, groupField: '/age', groupAreas, groupRates: [{ value: 'North', rate: 100 }] };
    const sample = (await alice.post(path).send(body).expect(201)).body;
    sample.groups.map(g => [g.value, g.rate, g.eligible, g.sampled]).should.eql([
      ['North', 100, 3, 3], ['Outside areas', 10, 1, 1], ['Overlapping areas', 10, 1, 1], [null, 10, 1, 1]
    ]);
    (await alice.post(path).send({ ...body, groupAreas: [...groupAreas].reverse() }).expect(200)).body.id.should.equal(sample.id);
    await alice.post(path).send({ ...body, groupAreas: [polygonBox('North', 20, 20)] }).expect(400);
    const full = (await alice.get(`${path}/${sample.id}?eligible=true`).expect(200)).body;
    full.eligibleList.forEach(e => Object.keys(e).sort().should.eql(['groupValue', 'instanceId', 'submitterId']));
    draw(full.eligibleList, full.settings, full.seed).chosen.map(i => i.instanceId).sort().should.eql(sample.items.map(i => i.instanceId).sort());
    await c.run(sql`UPDATE submission_defs SET xml = replace(xml, '10.1 10.1', '40 40') WHERE current`);
    (await alice.get(`${path}/${sample.id}`).expect(200)).body.groups.should.eql(sample.groups);
    const audit = await c.oneFirst(sql`SELECT details FROM audits WHERE action = 'field_data.backcheck_sample.draw'`);
    audit.settings.groupAreas.should.eql(groupAreas);
    const weights = (await alice.get(`${path}/${sample.id}/weights`).expect(200)).body;
    weights.available.should.equal(true); weights.items.length.should.equal(sample.sampled);
    const { fields } = (await alice.get(`${path}/fields`).expect(200)).body;
    fields.should.containEql({ path: '/age', type: 'geopoint' });
  }));

  it('refuses missing areas, unsafe points, non-geopoint questions and excessive geometry work atomically', testService(async (service, c) => {
    const alice = await service.login('alice'); await publishGeopoint(alice);
    const path = '/v1/projects/1/forms/locations/backcheck-samples';
    const body = { requestId: requestId(71), rate: 10, groupField: '/age', groupAreas: [polygonBox('North', 10, 10)] };
    await alice.post(base).send(body).expect(400);
    await alice.post(path).send({ ...body, groupAreas: [] }).expect(400);
    await submitPoint(alice, 'badPoint', '0 0');
    await alice.post(path).send(body).expect(400);
    await c.run(sql`UPDATE submission_defs SET xml = replace(xml, '<age>0 0</age>', '<age>10.1 10.1</age>') WHERE current`);
    const { AREA_LIMITS } = require('../../../lib/util/sampling-areas'); const { work: max } = AREA_LIMITS; AREA_LIMITS.work = 1;
    try { (await alice.post(path).send(body).expect(400)).body.code.should.equal(400.59); } finally { AREA_LIMITS.work = max; }
    (await c.oneFirst(sql`SELECT count(*)::integer FROM field_data_backcheck_samples`)).should.equal(0);
    (await c.oneFirst(sql`SELECT count(*)::integer FROM audits WHERE action = 'field_data.backcheck_sample.draw'`)).should.equal(0);
  }));

  it('serves checked weights to readers, with stable snapshot-based counts and no source-value dependence', testService(async (service, c) => {
    const { alice } = await setUp(service);
    const sample = (await alice.post(base).send({ requestId: requestId(80), rate: 34, minPerCollector: 1, groupField: '/name' }).expect(201)).body;
    const path = `${base}/${sample.id}/weights`;
    const response = await alice.get(path).expect(200);
    response.headers['cache-control'].should.equal('private, no-store');
    const weights = response.body;
    weights.should.containEql({ available: true, sampleId: sample.id, eligible: 9, sampled: 5, scope: 'recorded-eligible-submissions' });
    weights.strata.map(s => [s.eligible, s.sampled, s.designWeight]).sort((a, b) => a[0] - b[0]).should.eql([[1, 1, 1], [2, 1, 2], [6, 3, 2]]);
    weights.items.map(i => i.instanceId).sort().should.eql(sample.items.map(i => i.instanceId).sort());
    weights.strata.forEach(s => s.groupValue.should.equal('Alice'));
    await c.run(sql`UPDATE submission_defs SET xml = replace(xml, 'Alice</name>', 'Changed</name>') WHERE current`);
    (await alice.get(path).expect(200)).body.should.eql(weights);
    const chelsea = await service.login('chelsea');
    await chelsea.get(path).expect(403);
    const { id } = (await chelsea.get('/v1/users/current').expect(200)).body;
    await alice.post(`/v1/projects/1/assignments/viewer/${id}`).expect(200);
    (await chelsea.get(path).expect(200)).body.should.eql(weights);
    await alice.get(`${base}/${requestId(99)}/weights`).expect(404);
    await alice.get(`${base}/bad/weights`).expect(404);
    const empty = (await alice.post(base).send({ requestId: requestId(81), rate: 100, receivedFrom: '2000-01-01', receivedTo: '2000-01-02' }).expect(201)).body;
    (await alice.get(`${base}/${empty.id}/weights`).expect(200)).body.should.containEql({ available: true, eligible: 0, sampled: 0, strata: [], items: [] });
  }));

  it('keeps samples on a migration rollback', testServiceFullTrx(async (service) => {
    const { alice } = await setUp(service);
    await alice.post(base).send({ requestId: requestId(1), rate: 10 }).expect(201);
    const db = knexConnect(config.get('test.database'));
    try {
      await db.transaction(async (trx) => {
        await sampleMigration.down(trx);
        (await trx.raw('SELECT count(*)::integer AS n FROM field_data_backcheck_sample_items')).rows[0].n.should.equal(3);
        await sampleMigration.up(trx);
      });
    } finally { await db.destroy(); }
    (await alice.get(base).expect(200)).body.length.should.equal(1);
  }));
});
