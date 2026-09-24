// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

require('should');
const { strict: assert } = require('assert');
const { sql } = require('slonik');
const { testService } = require('../setup');
const testData = require('../../data/xml');

describe('api: P0.5 review case detail', () => {
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
