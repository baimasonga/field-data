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
