// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

require('should');
const { strict: assert } = require('assert');
const { sql } = require('slonik');
const { testService } = require('../setup');
const testData = require('../../data/xml');

// The fixture must create and transition cases in order within its transaction.
/* eslint-disable no-await-in-loop */
describe('api: review workload metrics', () => {
  it('returns empty aggregates and hides inaccessible forms', testService(async (service) => {
    const alice = await service.login('alice');
    const chelsea = await service.login('chelsea');
    const path = '/v1/field-data/review-queue/metrics?projectId=1&xmlFormId=simple';
    const result = await alice.get(path).expect(200);
    result.headers['cache-control'].should.equal('private, no-store');
    assert.deepEqual(result.body.counts, { open: 0, inReview: 0, resolved: 0, superseded: 0 });
    assert.equal(result.body.oldestActiveSeconds, null);
    assert.equal(result.body.averageFirstAssignmentSeconds, null);
    assert.equal(result.body.averageResolutionSeconds, null);
    assert.deepEqual(result.body.activeReasons, []);
    assert.deepEqual(result.body.backchecks, { pending: 0, overdue: 0 });
    await chelsea.get(path).expect(404);
    const viewerId = (await chelsea.get('/v1/users/current').expect(200)).body.id;
    await alice.post(`/v1/projects/1/assignments/viewer/${viewerId}`).expect(200);
    await chelsea.get(path).expect(200);
    await alice.get('/v1/field-data/review-queue/metrics?projectId=1').expect(400);
    await alice.get('/v1/field-data/review-queue/metrics?projectId=9007199254740992&xmlFormId=simple').expect(400);
    await alice.get('/v1/field-data/review-queue/metrics?projectId=1&xmlFormId=missing').expect(404);
  }));

  it('aggregates elapsed times, distinct reasons and active overdue visits within the form',
    testService(async (service, { run }) => {
      const alice = await service.login('alice');
      const actorId = (await alice.get('/v1/users/current').expect(200)).body.id;
      for (const instance of ['one', 'two', 'deleted']) {
        await alice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one.replace('one</instanceID>', `${instance}</instanceID>`))
          .set('Content-Type', 'application/xml').expect(200);
      }
      const { items } = (await alice.get('/v1/field-data/review-queue?projectId=1&xmlFormId=simple')
        .expect(200)).body;
      const active = items.find(item => item.claim.rootInstanceId === 'one');
      const resolved = items.find(item => item.claim.rootInstanceId === 'two');
      for (const item of [active, resolved]) {
        const assigned = await alice.patch(`/v1/field-data/review-queue/${item.id}/assignment`)
          .set('If-Match', item.etag).set('Idempotency-Key', `metrics-assign-${item.id}`)
          .send({ assignedTo: actorId, status: 'in-review' })
          .expect(200);
        if (item === resolved) {
          await alice.post(`/v1/field-data/review-queue/${item.id}/decisions`)
            .set('If-Match', assigned.headers.etag).set('Idempotency-Key', 'metrics-decision')
            .send({ outcome: 'rejected', override: false, reasonCode: item.reasonCodes[0],
              note: 'Reviewed for metrics fixture.', evidenceIds: [], integrityFindingIds: [] })
            .expect(201);
        }
      }
      await run(sql`UPDATE submissions SET "deletedAt" = now() WHERE "instanceId" = 'deleted'`);
      await run(sql`UPDATE field_data_review_cases SET "openedAt" = now() - interval '2 hours',
        "resolvedAt" = CASE WHEN status = 'resolved' THEN now() - interval '1 hour' ELSE NULL END`);
      await run(sql`UPDATE audits SET "loggedAt" = now() - interval '1 hour'
        WHERE action = 'field_data.review.case.assign'`);
      await run(sql`UPDATE field_data_review_cases SET
        "reasonCodes" = ' ["provenance-degraded", "provenance-degraded"]'::jsonb
        WHERE id = ${active.id}`);
      for (const item of [active, resolved]) {
        await run(sql`INSERT INTO field_data_backchecks
          ("caseId", "claimVersionId", "requestId", "requestHash", "requestedBy", "assignedTo", question, "dueAt")
          VALUES (${item.id}, ${item.claimVersionId}, ${item.id}, 'fixture', ${actorId}, ${actorId},
            'Verify the visit.', now() - interval '1 hour')`);
      }
      const { body } = await alice.get('/v1/field-data/review-queue/metrics?projectId=1&xmlFormId=simple').expect(200);
      assert.deepEqual(body.counts, { open: 0, inReview: 1, resolved: 1, superseded: 0 });
      assert.deepEqual(body.activeReasons, [{ reasonCode: 'provenance-degraded', count: 1 }]);
      assert.deepEqual(body.backchecks, { pending: 1, overdue: 1 });
      assert.deepEqual(body.decisions, { total: 1, overrides: 0 });
      assert.equal(body.assignedCaseCount, 2);
      assert.ok(Math.abs(body.oldestActiveSeconds - 7200) < 5);
      assert.ok(Math.abs(body.averageFirstAssignmentSeconds - 3600) < 5);
      assert.ok(Math.abs(body.averageResolutionSeconds - 3600) < 5);
      const other = await alice.get('/v1/field-data/review-queue/metrics?projectId=1&xmlFormId=withrepeat').expect(200);
      assert.deepEqual(other.body.counts, { open: 0, inReview: 0, resolved: 0, superseded: 0 });
      assert.deepEqual(other.body.decisions, { total: 0, overrides: 0 });
    }));
});
/* eslint-enable no-await-in-loop */

describe('api: P0.5 review case detail', () => {
  it('audits supervisor acceptance, preserves limitations and protects retries',
    testService(async (service, { one, run }) => {
      const alice = await service.login('alice');
      const actorId = (await alice.get('/v1/users/current').expect(200)).body.id;
      await alice.post('/v1/projects/1/forms/simple/submissions')
        .send(testData.instances.simple.one).set('Content-Type', 'application/xml').expect(200);
      const item = (await alice.get('/v1/field-data/review-queue?projectId=1&xmlFormId=simple')
        .expect(200)).body.items[0];
      const assignment = await alice.patch(`/v1/field-data/review-queue/${item.id}/assignment`)
        .set('If-Match', item.etag).set('Idempotency-Key', 'override-assign')
        .send({ assignedTo: actorId, status: 'in-review' })
        .expect(200);
      const finding = await one(sql`INSERT INTO field_data_integrity_flags
        ("formId", rule, "ruleVersion", "instanceId", outcome, evidence)
        SELECT id, 'manual-check', 1, 'one', 'inconclusive', '{}'::jsonb
        FROM forms WHERE "projectId" = 1 AND "xmlFormId" = 'simple' RETURNING id`);
      const detailPath = `/v1/field-data/review-queue/${item.id}`;
      assert.equal((await alice.get(detailPath).expect(200)).body.overridePolicy.allowed, true);
      const url = `${detailPath}/decisions`;
      const body = { outcome: 'accepted', override: true, reasonCode: 'verified-by-supervisor',
        note: 'Confirmed the original with the field supervisor.', evidenceIds: [], integrityFindingIds: [] };
      const decide = (payload, key = 'override-decision') => alice.post(url)
        .set('If-Match', assignment.headers.etag).set('Idempotency-Key', key).send(payload);
      await decide({ ...body, note: '   ' }).expect(400);
      await decide({ ...body, reasonCode: 'provenance-degraded' }).expect(400);
      await decide({ ...body, outcome: 'rejected' }).expect(400);
      // A normal reviewer still cannot accept these limitations.
      await decide({ ...body, override: false, reasonCode: item.reasonCodes[0] }, 'normal').expect(422);
      await run(sql`UPDATE submission_defs SET xml = xml || ' '
        WHERE id = (SELECT "submissionDefId" FROM field_data_claim_versions
          WHERE id = ${item.claimVersionId})`);
      await decide(body, 'tampered-override').expect(422);
      await run(sql`UPDATE submission_defs SET xml = left(xml, length(xml) - 1)
        WHERE id = (SELECT "submissionDefId" FROM field_data_claim_versions
          WHERE id = ${item.claimVersionId})`);
      const first = await decide(body).expect(201);
      const replay = await decide(body).expect(201);
      assert.equal(replay.body.id, first.body.id);
      assert.equal(replay.headers['idempotency-status'], 'replayed');
      await decide({ ...body, note: 'Different justification.' }).expect(409);
      await decide(body, 'new-override').expect(412);
      const detail = (await alice.get(detailPath).expect(200)).body;
      assert.equal(detail.decisions.length, 1);
      assert.equal(detail.decisions[0].override, true);
      assert.equal(detail.decisions[0].integritySnapshot[0].id, finding.id);
      assert.notEqual(detail.decisions[0].integritySnapshot[0].status, 'resolved');
      assert.equal(detail.decisions[0].evidenceSnapshot[0].integrityStatus, 'verified');
      const audit = await one(sql`SELECT details FROM audits WHERE action = 'field_data.review.case.decide'`);
      assert.equal(audit.details.override, true);
      assert.ok(audit.details.overrideContext.provenanceDegraded);
      const metrics = (await alice.get('/v1/field-data/review-queue/metrics?projectId=1&xmlFormId=simple').expect(200)).body;
      assert.deepEqual(metrics.decisions, { total: 1, overrides: 1 });
      await assert.rejects(run(sql`UPDATE field_data_review_decisions SET note = 'changed'
        WHERE id = ${first.body.id}`), /Review decisions are append-only/);
    }));

  it('denies override permission to a submission reviewer without project management',
    testService(async (service, { run }) => {
      const alice = await service.login('alice');
      const chelsea = await service.login('chelsea');
      const actorId = (await chelsea.get('/v1/users/current').expect(200)).body.id;
      await alice.post(`/v1/projects/1/assignments/viewer/${actorId}`).expect(200);
      await run(sql`UPDATE roles SET verbs = verbs || '["submission.update"]'::jsonb WHERE system = 'viewer'`);
      await alice.post('/v1/projects/1/forms/simple/submissions')
        .send(testData.instances.simple.one).set('Content-Type', 'application/xml').expect(200);
      const item = (await chelsea.get('/v1/field-data/review-queue?projectId=1&xmlFormId=simple').expect(200)).body.items[0];
      const assignment = await chelsea.patch(`/v1/field-data/review-queue/${item.id}/assignment`)
        .set('If-Match', item.etag).set('Idempotency-Key', 'reviewer-assignment')
        .send({ assignedTo: actorId, status: 'in-review' })
        .expect(200);
      assert.equal((await chelsea.get(`/v1/field-data/review-queue/${item.id}`).expect(200)).body.overridePolicy.allowed, false);
      await chelsea.post(`/v1/field-data/review-queue/${item.id}/decisions`)
        .set('If-Match', assignment.headers.etag).set('Idempotency-Key', 'reviewer-override')
        .send({ outcome: 'accepted', override: true, reasonCode: 'verified-by-supervisor',
          note: 'Verified.', evidenceIds: [], integrityFindingIds: [] })
        .expect(403);
    }));

  for (const outcome of ['accepted', 'rejected']) {
    it(`resolves a claimed case as ${outcome} and keeps its immutable decision`,
      testService(async (service, { one, oneFirst, run }) => {
        const alice = await service.login('alice');
        await alice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one).set('Content-Type', 'application/xml').expect(200);
        await alice.patch('/v1/projects/1/forms/simple/submissions/one')
          .send({ reviewState: 'hasIssues' }).expect(200);
        const actorId = await oneFirst(sql`SELECT "actorId" FROM audits
          WHERE action = 'submission.update' ORDER BY id DESC LIMIT 1`);
        const item = (await alice.get('/v1/field-data/review-queue?projectId=1&xmlFormId=simple')
          .expect(200)).body.items[0];
        const assigned = await alice.patch(`/v1/field-data/review-queue/${item.id}/assignment`)
          .set('If-Match', item.etag).set('Idempotency-Key', `take-${outcome}`)
          .send({ assignedTo: actorId, status: 'in-review' })
          .expect(200);
        const url = `/v1/field-data/review-queue/${item.id}/decisions`;
        const body = { outcome, override: false, reasonCode: 'legacy-review-state',
          note: 'Reviewed the linked originals and field report.',
          evidenceIds: [], integrityFindingIds: [] };
        if (outcome === 'accepted') {
          const finding = await one(sql`INSERT INTO field_data_integrity_flags
            ("formId", rule, "ruleVersion", "instanceId", outcome, evidence)
            SELECT id, 'manual-check', 1, 'one', 'inconclusive', '{}'::jsonb
            FROM forms WHERE "projectId" = 1 AND "xmlFormId" = 'simple'
            RETURNING id`);
          await alice.post(url).set('If-Match', assigned.headers.etag)
            .set('Idempotency-Key', 'accept-blocked').send(body)
            .expect(422);
          await run(sql`UPDATE field_data_integrity_flags SET status = 'resolved'
            WHERE id = ${finding.id}`);
          await alice.post(url).set('If-Match', assigned.headers.etag)
            .set('Idempotency-Key', 'accept-degraded').send(body)
            .expect(422);
          // This API fixture has no device capture time. Model a submission
          // whose capture time was actually supplied, then exercise acceptance.
          await run(sql`UPDATE field_data_submission_provenance SET
            "capturedAt" = "receivedAt", degraded = NULL
            WHERE "submissionDefId" = (
              SELECT "submissionDefId" FROM field_data_claim_versions
              WHERE id = ${item.claimVersionId})`);
          await run(sql`UPDATE field_data_claim_versions SET degraded = NULL
            WHERE id = ${item.claimVersionId}`);
        }
        const first = await alice.post(url).set('If-Match', assigned.headers.etag)
          .set('Idempotency-Key', `decide-${outcome}`).send(body)
          .expect(201);
        first.body.status.should.equal('resolved');
        const replay = await alice.post(url).set('If-Match', assigned.headers.etag)
          .set('Idempotency-Key', `decide-${outcome}`).send(body)
          .expect(201);
        replay.headers['idempotency-status'].should.equal('replayed');
        replay.body.id.should.equal(first.body.id);
        const detail = (await alice.get(`/v1/field-data/review-queue/${item.id}`)
          .expect(200)).body;
        detail.status.should.equal('resolved');
        detail.decisions[0].outcome.should.equal(outcome);
        detail.decisions[0].evidenceSnapshot.should.have.length(1);
        detail.submissionReviewState.should.equal('hasIssues');
        (await alice.get('/v1/field-data/review-queue?projectId=1&xmlFormId=simple&status=resolved')
          .expect(200)).body.items[0].id.should.equal(item.id);
        (await one(sql`SELECT count(*)::integer AS count FROM audits
          WHERE action = 'field_data.review.case.decide'`)).count.should.equal(1);
      }));
  }

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
      const initial = (await alice.get(list).expect(200)).body.items;
      initial.should.have.length(1);
      initial[0].reasonCodes.should.deepEqual(['provenance-degraded']);
      await alice.patch('/v1/projects/1/forms/simple/submissions/one')
        .send({ reviewState: 'hasIssues' }).expect(200);
      const { body } = await alice.get(list).expect(200);
      body.items.should.have.length(1);
      body.items[0].id.should.equal(initial[0].id);
      body.items[0].reasonCodes.should.deepEqual(['provenance-degraded', 'legacy-review-state']);
      body.items[0].claim.rootInstanceId.should.equal('one');
      assert.equal(body.nextCursor, null);
      await alice.patch('/v1/projects/1/forms/simple/submissions/one')
        .send({ reviewState: 'hasIssues' }).expect(200);
      (await alice.get(list).expect(200)).body.items.should.have.length(1);
      await chelsea.get(list).expect(404);
      await alice.get(`${list}&cursor=invalid`).expect(400);
      await alice.get(`${list}&limit=101`).expect(400);
    }));

  it('routes a missing audit capture time finding to one review case',
    testService(async (service, { one, run }) => {
      const alice = await service.login('alice');
      await alice.post('/v1/projects/1/forms/simple/submissions')
        .send(testData.instances.simple.one).set('Content-Type', 'application/xml').expect(200);
      const list = '/v1/field-data/review-queue?projectId=1&xmlFormId=simple';
      const before = (await alice.get(list).expect(200)).body.items;
      before.should.have.length(1);
      const finding = await one(sql`INSERT INTO field_data_integrity_flags
        ("formId", rule, "ruleVersion", "instanceId", outcome, evidence)
        SELECT id, 'implausible-travel', 1, 'one', 'inconclusive',
          '{"reason":"no-capture-time"}'::jsonb
        FROM forms WHERE "projectId" = 1 AND "xmlFormId" = 'simple'
        RETURNING id`);

      const after = (await alice.get(list).expect(200)).body.items;
      after.should.have.length(1);
      after[0].id.should.equal(before[0].id);
      after[0].reasonCodes.should.deepEqual([
        'provenance-degraded', 'capture-time-unavailable'
      ]);
      await run(sql`UPDATE field_data_integrity_flags
        SET evidence = '{"reason":"no-capture-time"}'::jsonb WHERE id = ${finding.id}`);
      const again = (await alice.get(list).expect(200)).body.items;
      again.should.have.length(1);
      again[0].revision.should.equal(after[0].revision);
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
      const reviewCase = await one(sql`UPDATE field_data_review_cases
        SET "reasonCodes" = '["manual-referral"]'::jsonb
        WHERE "claimVersionId" = ${claim.currentVersionId}
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
