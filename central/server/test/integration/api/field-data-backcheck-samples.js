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
    const sample = (await alice.post(base).send({ requestId: requestId(1), rate: 100, minPerCollector: 0 }).expect(201)).body;

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
    view.items.find((i) => i.instanceId === item.instanceId).backcheck.should.equal('requested');

    await service.post(`/v1/key/${b.token}/projects/1/forms/simple/submissions`)
      .send(instance('revisit')).set('Content-Type', 'application/xml').expect(200);
    await alice.post(`${path}/${requested.body.id}/link`).set('If-Match', requested.headers.etag)
      .send({ instanceId: 'revisit' }).expect(200);
    view = await coverage();
    view.collectors.find((c) => c.submitterId === a.id).should.containEql({ requested: 1, linked: 1 });
    view.items.find((i) => i.instanceId === item.instanceId).backcheck.should.equal('linked');
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
