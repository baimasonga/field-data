// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

require('should');
const { testService } = require('../setup');
const testData = require('../../data/xml');

describe('api: case back-check requests', () => {
  it('assigns a different App User and links their offline-compatible ODK submission',
    testService(async (service) => {
      const alice = await service.login('alice');
      const chelsea = await service.login('chelsea');
      const appUser = (await alice.post('/v1/projects/1/app-users')
        .send({ displayName: 'independent checker' }).expect(200)).body;
      await alice.post(`/v1/projects/1/forms/simple/assignments/app-user/${appUser.id}`)
        .expect(200);
      await alice.post('/v1/projects/1/forms/simple/submissions')
        .send(testData.instances.simple.one).set('Content-Type', 'application/xml').expect(200);
      const item = (await alice.get('/v1/field-data/review-queue?projectId=1&xmlFormId=simple')
        .expect(200)).body.items[0];
      const actorId = (await alice.get('/v1/users/current').expect(200)).body.id;
      const assigned = await alice.patch(`/v1/field-data/review-queue/${item.id}/assignment`)
        .set('If-Match', item.etag).set('Idempotency-Key', 'assign-backcheck')
        .send({ assignedTo: actorId, status: 'in-review' })
        .expect(200);
      const path = `/v1/field-data/review-queue/${item.id}/backchecks`;
      await chelsea.get(path).expect(404);
      const assignees = (await alice.get(`${path.replace('/backchecks', '/backcheck-assignees')}`)
        .expect(200)).body;
      assignees.map((a) => a.id).should.containEql(appUser.id);
      const body = { requestId: '00000000-0000-4000-8000-000000000001',
        assignedTo: appUser.id, question: 'Confirm the visit time with the respondent.', dueAt: null };
      await alice.post(path).send(body).expect(428);
      const first = await alice.post(path).set('If-Match', assigned.headers.etag)
        .send(body).expect(201);
      (await alice.post(path).set('If-Match', assigned.headers.etag).send(body)
        .expect(201)).headers['idempotency-status'].should.equal('replayed');
      await alice.post(path).set('If-Match', first.headers.etag)
        .send({ ...body, requestId: '00000000-0000-4000-8000-000000000002' })
        .expect(409);
      const decision = `/v1/field-data/review-queue/${item.id}/decisions`;
      await alice.post(decision).set('If-Match', first.headers.etag)
        .set('Idempotency-Key', 'pending-backcheck').send({ outcome: 'rejected',
          override: false, reasonCode: 'provenance-degraded', note: 'Needs a site visit.',
          evidenceIds: [], integrityFindingIds: [] })
        .expect(422);
      await service.post(`/v1/key/${appUser.token}/projects/1/forms/simple/submissions`)
        .send(testData.instances.simple.one.replace('one</instanceID>', 'second</instanceID>'))
        .set('Content-Type', 'application/xml').expect(200);
      const link = `${path}/${first.body.id}/link`;
      await alice.post(link).set('If-Match', first.headers.etag)
        .send({ instanceId: 'one' }).expect(400);
      const linked = await alice.post(link).set('If-Match', first.headers.etag)
        .send({ instanceId: 'second' }).expect(200);
      (await alice.post(link).set('If-Match', first.headers.etag)
        .send({ instanceId: 'second' }).expect(200))
        .headers['idempotency-status'].should.equal('replayed');
      const backchecks = (await alice.get(path).expect(200)).body;
      backchecks.should.have.length(1);
      backchecks[0].status.should.equal('linked');
      backchecks[0].responseInstanceId.should.equal('second');
      linked.headers.etag.should.not.equal(first.headers.etag);
    }));
});

describe('api: back-check cancellation', () => {
  it('retains cancellation history and permits a replacement without allowing a cancelled result',
    testService(async (service, { one }) => {
      const { sql } = require('slonik');
      const alice = await service.login('alice');
      const chelsea = await service.login('chelsea');
      const appUser = (await alice.post('/v1/projects/1/app-users')
        .send({ displayName: 'independent checker' }).expect(200)).body;
      await alice.post(`/v1/projects/1/forms/simple/assignments/app-user/${appUser.id}`).expect(200);
      await alice.post('/v1/projects/1/forms/simple/submissions')
        .send(testData.instances.simple.one).set('Content-Type', 'application/xml').expect(200);
      const item = (await alice.get('/v1/field-data/review-queue?projectId=1&xmlFormId=simple')
        .expect(200)).body.items[0];
      const actorId = (await alice.get('/v1/users/current').expect(200)).body.id;
      const assignment = await alice.patch(`/v1/field-data/review-queue/${item.id}/assignment`)
        .set('If-Match', item.etag).set('Idempotency-Key', 'assign-cancellation')
        .send({ assignedTo: actorId, status: 'in-review' })
        .expect(200);
      const path = `/v1/field-data/review-queue/${item.id}/backchecks`;
      const request = { requestId: '00000000-0000-4000-8000-000000000011',
        assignedTo: appUser.id, question: 'Verify the visit.', dueAt: null };
      const first = await alice.post(path).set('If-Match', assignment.headers.etag)
        .send(request).expect(201);
      const cancelPath = `${path}/${first.body.id}/cancel`;
      const cancellation = { requestId: '00000000-0000-4000-8000-000000000012',
        reason: 'Collector is unavailable; request another visit.' };
      await chelsea.post(cancelPath).set('If-Match', first.headers.etag)
        .send(cancellation).expect(404);
      await alice.post(cancelPath).send(cancellation).expect(428);
      await alice.post(cancelPath).set('If-Match', first.headers.etag)
        .send({ ...cancellation, reason: ' ' }).expect(400);
      await alice.post(cancelPath).set('If-Match', assignment.headers.etag)
        .send(cancellation).expect(409);
      const cancelled = await alice.post(cancelPath).set('If-Match', first.headers.etag)
        .send(cancellation).expect(200);
      const replay = await alice.post(cancelPath).set('If-Match', first.headers.etag)
        .send(cancellation).expect(200);
      replay.headers['idempotency-status'].should.equal('replayed');
      replay.headers.etag.should.equal(cancelled.headers.etag);
      (await alice.post(path).set('If-Match', assignment.headers.etag)
        .send(request).expect(201)).body.status.should.equal('cancelled');
      await alice.post(cancelPath).set('If-Match', cancelled.headers.etag)
        .send({ ...cancellation, reason: 'Changed reason' }).expect(400);
      await alice.post(`${path}/${first.body.id}/link`).set('If-Match', cancelled.headers.etag)
        .send({ instanceId: 'one' }).expect(409);
      const replacement = await alice.post(path).set('If-Match', cancelled.headers.etag)
        .send({ ...request, requestId: '00000000-0000-4000-8000-000000000013' }).expect(201);
      const history = (await alice.get(path).expect(200)).body;
      history.should.have.length(2);
      history[0].status.should.equal('cancelled');
      history[0].cancellationReason.should.equal(cancellation.reason);
      history[0].cancelledBy.should.equal(actorId);
      history[0].cancelledAt.should.not.equal(null);
      history[1].id.should.equal(replacement.body.id);
      const audit = await one(sql`SELECT count(*)::integer AS count FROM audits
        WHERE action = 'field_data.backcheck.cancel'
          AND details->>'backcheckId' = ${first.body.id}`);
      audit.count.should.equal(1);
    }));
});
