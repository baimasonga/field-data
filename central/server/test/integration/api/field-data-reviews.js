// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

require('should');
const { strict: assert } = require('assert');
const { sql } = require('slonik');
const { testService } = require('../setup');
const testData = require('../../data/xml');

describe('api: P0.5 review case detail', () => {
  it('records one needs-evidence decision with evidence and finding snapshots',
    testService(async (service, { one, oneFirst }) => {
      const alice = await service.login('alice');
      const chelsea = await service.login('chelsea');
      await alice.post('/v1/projects/1/forms/simple/submissions')
        .send(testData.instances.simple.one).set('Content-Type', 'application/xml').expect(200);
      await alice.patch('/v1/projects/1/forms/simple/submissions/one')
        .send({ reviewState: 'hasIssues' }).expect(200);
      const actorId = await oneFirst(sql`SELECT "actorId" FROM audits
        WHERE action = 'submission.update' ORDER BY id DESC LIMIT 1`);
      const item = (await alice.get('/v1/field-data/review-queue?projectId=1&xmlFormId=simple')
        .expect(200)).body.items[0];
      const assignment = await alice.patch(`/v1/field-data/review-queue/${item.id}/assignment`)
        .set('If-Match', item.etag).set('Idempotency-Key', 'decide-claim')
        .send({ assignedTo: actorId, status: 'in-review' })
        .expect(200);
      await one(sql`INSERT INTO field_data_integrity_flags
        ("formId", rule, "ruleVersion", "instanceId", outcome, evidence)
        SELECT id, 'manual-check', 1, 'one', 'inconclusive', '{"note":"review"}'::jsonb
        FROM forms WHERE "projectId" = 1 AND "xmlFormId" = 'simple'
        RETURNING id`);
      const url = `/v1/field-data/review-queue/${item.id}/decisions`;
      const body = { outcome: 'needs-evidence', override: false,
        reasonCode: 'legacy-review-state', note: 'Request the receipt.',
        evidenceIds: [], integrityFindingIds: [] };
      await chelsea.post(url).set('If-Match', assignment.headers.etag)
        .set('Idempotency-Key', 'decide-one').send(body)
        .expect(404);
      await alice.post(url).set('Idempotency-Key', 'decide-one').send(body).expect(428);
      await alice.post(url).set('If-Match', assignment.headers.etag)
        .set('Idempotency-Key', 'decide-one').send({ ...body, reasonCode: 'wrong' })
        .expect(400);
      const first = await alice.post(url).set('If-Match', assignment.headers.etag)
        .set('Idempotency-Key', 'decide-one').send(body)
        .expect(201);
      first.body.status.should.equal('open');
      const replay = await alice.post(url).set('If-Match', assignment.headers.etag)
        .set('Idempotency-Key', 'decide-one').send(body)
        .expect(201);
      replay.body.id.should.equal(first.body.id);
      replay.headers['idempotency-status'].should.equal('replayed');
      await alice.post(url).set('If-Match', assignment.headers.etag)
        .set('Idempotency-Key', 'decide-two').send(body)
        .expect(412);
      const detail = (await alice.get(`/v1/field-data/review-queue/${item.id}`)
        .expect(200)).body;
      detail.decisions.should.have.length(1);
      detail.decisions[0].evidenceSnapshot.should.have.length(1);
      detail.decisions[0].integritySnapshot.should.have.length(1);
      detail.decisions[0].evidenceSnapshot[0].integrityStatus.should.equal('verified');
      assert.equal(detail.assignedTo, null);
      (await one(sql`SELECT count(*)::integer AS count FROM audits
        WHERE action = 'field_data.review.case.decide'`)).count.should.equal(1);
    }));

  it('assigns a case once with revision and retry protection',
    testService(async (service, { one, oneFirst }) => {
      const alice = await service.login('alice');
      const chelsea = await service.login('chelsea');
      await alice.post('/v1/projects/1/forms/simple/submissions')
        .send(testData.instances.simple.one).set('Content-Type', 'application/xml').expect(200);
      await alice.patch('/v1/projects/1/forms/simple/submissions/one')
        .send({ reviewState: 'hasIssues' }).expect(200);
      const actorId = await oneFirst(sql`SELECT "actorId" FROM audits
        WHERE action = 'submission.update' ORDER BY id DESC LIMIT 1`);
      const item = (await alice.get('/v1/field-data/review-queue?projectId=1&xmlFormId=simple')
        .expect(200)).body.items[0];
      const path = `/v1/field-data/review-queue/${item.id}/assignment`;
      const body = { assignedTo: actorId, status: 'in-review' };
      await chelsea.patch(path).set('If-Match', item.etag)
        .set('Idempotency-Key', 'assignment-1').send(body)
        .expect(404);
      await alice.patch(path).set('Idempotency-Key', 'assignment-1').send(body)
        .expect(428);
      const first = await alice.patch(path).set('If-Match', item.etag)
        .set('Idempotency-Key', 'assignment-1').send(body)
        .expect(200);
      first.body.revision.should.equal(item.revision + 1);
      first.headers['idempotency-status'].should.equal('created');
      const replay = await alice.patch(path).set('If-Match', item.etag)
        .set('Idempotency-Key', 'assignment-1').send(body)
        .expect(200);
      replay.headers['idempotency-status'].should.equal('replayed');
      await alice.patch(path).set('If-Match', item.etag)
        .set('Idempotency-Key', 'assignment-2').send(body)
        .expect(412);
      const assigned = (await alice.get(
        '/v1/field-data/review-queue?projectId=1&xmlFormId=simple&status=in-review'
      ).expect(200)).body.items;
      assigned.should.have.length(1);
      assigned[0].assignedTo.should.equal(actorId);
      (await one(sql`SELECT count(*)::integer AS count FROM audits
        WHERE action = 'field_data.review.case.assign'`)).count.should.equal(1);
      const releaseBody = { assignedTo: null, status: 'open' };
      await alice.patch(path).set('If-Match', assigned[0].etag)
        .set('Idempotency-Key', 'assignment-1').send(releaseBody)
        .expect(409);
      const released = await alice.patch(path).set('If-Match', assigned[0].etag)
        .set('Idempotency-Key', 'release-1').send(releaseBody)
        .expect(200);
      released.body.status.should.equal('open');
      assert.equal(released.body.assignedTo, null);
      (await alice.patch(path).set('If-Match', assigned[0].etag)
        .set('Idempotency-Key', 'release-1').send(releaseBody)
        .expect(200)).headers['idempotency-status'].should.equal('replayed');
      await alice.patch(path).set('If-Match', assigned[0].etag)
        .set('Idempotency-Key', 'release-2').send(releaseBody)
        .expect(412);
      (await one(sql`SELECT count(*)::integer AS count FROM audits
        WHERE action = 'field_data.review.case.release'`)).count.should.equal(1);
      (await alice.get('/v1/field-data/review-queue?projectId=1&xmlFormId=simple')
        .expect(200)).body.items[0].id.should.equal(item.id);
    }));

  it('opens a review case when a submission is flagged and lists it only to form readers',
    testService(async (service) => {
      const alice = await service.login('alice');
      const chelsea = await service.login('chelsea');
      await alice.post('/v1/projects/1/forms/simple/submissions')
        .send(testData.instances.simple.one).set('Content-Type', 'application/xml').expect(200);
      const list = '/v1/field-data/review-queue?projectId=1&xmlFormId=simple';
      (await alice.get(list).expect(200)).body.items.should.have.length(0);
      await alice.patch('/v1/projects/1/forms/simple/submissions/one')
        .send({ reviewState: 'hasIssues' }).expect(200);
      const { body } = await alice.get(list).expect(200);
      body.items.should.have.length(1);
      body.items[0].reasonCodes.should.deepEqual(['legacy-review-state']);
      body.items[0].claim.rootInstanceId.should.equal('one');
      assert.equal(body.nextCursor, null);
      await alice.patch('/v1/projects/1/forms/simple/submissions/one')
        .send({ reviewState: 'hasIssues' }).expect(200);
      (await alice.get(list).expect(200)).body.items.should.have.length(1);
      await chelsea.get(list).expect(404);
      await alice.get(`${list}&cursor=invalid`).expect(400);
      await alice.get(`${list}&limit=101`).expect(400);
    }));

  it('paginates flagged cases without repeating a row', testService(async (service) => {
    const alice = await service.login('alice');
    for (const instanceId of ['one', 'two']) {
      const xml = testData.instances.simple.one.replace('one</instanceID>',
        `${instanceId}</instanceID>`);
      // Keep insertion order deterministic for the pagination assertion.
      // eslint-disable-next-line no-await-in-loop
      await alice.post('/v1/projects/1/forms/simple/submissions')
        .send(xml).set('Content-Type', 'application/xml').expect(200);
      // eslint-disable-next-line no-await-in-loop
      await alice.patch(`/v1/projects/1/forms/simple/submissions/${instanceId}`)
        .send({ reviewState: 'hasIssues' }).expect(200);
    }
    const path = '/v1/field-data/review-queue?projectId=1&xmlFormId=simple&limit=1';
    const first = (await alice.get(path).expect(200)).body;
    first.items.should.have.length(1);
    first.nextCursor.should.be.a.String();
    const second = (await alice.get(`${path}&cursor=${encodeURIComponent(first.nextCursor)}`)
      .expect(200)).body;
    second.items.should.have.length(1);
    assert.equal(second.nextCursor, null);
    second.items[0].id.should.not.equal(first.items[0].id);
  }));

  it('scopes the exact claim and decisions to authorized form readers',
    testService(async (service, { one, run }) => {
      const alice = await service.login('alice');
      const chelsea = await service.login('chelsea');
      await alice.post('/v1/projects/1/forms/simple/submissions')
        .send(testData.instances.simple.one).set('Content-Type', 'application/xml').expect(200);
      const claim = (await alice.get('/v1/projects/1/forms/simple/submissions/one/claim')
        .expect(200)).body;
      const reviewCase = await one(sql`INSERT INTO field_data_review_cases
        ("claimVersionId", "reasonCodes")
        VALUES (${claim.currentVersionId}, '["manual-referral"]'::jsonb)
        RETURNING id`);
      const decision = await one(sql`INSERT INTO field_data_review_decisions
        ("caseId", "claimVersionId", sequence, outcome, "reasonCode",
          "evidenceSnapshot", "evidenceSnapshotHash", "integritySnapshot")
        VALUES (${reviewCase.id}, ${claim.currentVersionId}, 1, 'needs-evidence',
          'manual-referral', '[]'::jsonb, ${`sha256:${'0'.repeat(64)}`}, '[]'::jsonb)
        RETURNING id`);
      const path = `/v1/field-data/review-queue/${reviewCase.id}`;
      const response = await alice.get(path).expect(200);
      response.headers.etag.should.equal('"review-case-1"');
      response.body.claim.id.should.equal(claim.currentVersionId);
      response.body.reasonCodes.should.deepEqual(['manual-referral']);
      response.body.decisions[0].id.should.equal(decision.id);
      await chelsea.get(path).expect(404);
      await alice.get('/v1/field-data/review-queue/not-a-uuid').expect(404);
      await assert.rejects(run(sql`DELETE FROM field_data_review_decisions
        WHERE id = ${decision.id}`), /Review decisions are append-only/);
    }));
});
