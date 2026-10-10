// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

require('should');
const { strict: assert } = require('assert');
const { sql } = require('slonik');
const { testService, testServiceFullTrx } = require('../setup');
const testData = require('../../data/xml');

describe('api: case back-check requests', () => {
  it('assigns a different App User and links their offline-compatible ODK submission',
    testService(async (service, { run }) => {
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
        .send(testData.instances.simple.one.replace('one</instanceID>', 'second</instanceID>')
          .replace('<age>30</age>', '<age>31</age>'))
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
      const comparisonPath = `${path}/${first.body.id}/comparison`;
      const comparison = await alice.get(comparisonPath).expect(200);
      assert.equal(comparison.headers['cache-control'], 'private, no-store');
      assert.deepEqual(comparison.body.summary, { same: 1, changed: 1, missingOriginal: 0, missingBackcheck: 0 });
      assert.equal(comparison.body.original.instanceId, 'one');
      assert.equal(comparison.body.backcheck.instanceId, 'second');
      assert.equal(comparison.body.original.integrityStatus, 'verified');
      assert.ok(comparison.body.original.provenance.degraded);
      await alice.get(comparison.body.backcheck.xmlDownloadUrl).expect(200);
      await chelsea.get(comparisonPath).expect(404);
      const viewerId = (await chelsea.get('/v1/users/current').expect(200)).body.id;
      await alice.post(`/v1/projects/1/assignments/viewer/${viewerId}`).expect(200);
      await chelsea.get(comparisonPath).expect(200);
      await alice.get(comparisonPath.replace(first.body.id, '00000000-0000-4000-8000-000000000099')).expect(404);
      // Editing the linked response must not silently replace its pinned bytes.
      await alice.put('/v1/projects/1/forms/simple/submissions/second')
        .send(testData.instances.simple.one.replace('one</instance',
          'edited</instanceID><deprecatedID>second</deprecated').replace('<age>30</age>', '<age>99</age>'))
        .set('Content-Type', 'application/xml').expect(200);
      const historical = (await alice.get(comparisonPath).expect(200)).body;
      assert.equal(historical.backcheck.current, false);
      assert.equal(historical.backcheck.instanceId, 'second');
      assert.equal(historical.summary.changed, 1);
      assert.equal(historical.rows.find(row => row.path === '/age[1]').backcheck, '31');
      await run(sql`UPDATE submission_defs SET xml = xml || ' ' WHERE id = ${historical.backcheck.submissionDefId}`);
      const tampered = (await alice.get(comparisonPath).expect(200)).body;
      assert.equal(tampered.unavailableReason, 'source-integrity');
      assert.equal(tampered.rows, undefined);
      assert.equal(tampered.backcheck.integrityStatus, 'mismatch');
      await run(sql`UPDATE submissions SET "deletedAt" = now() WHERE "instanceId" = 'second'`);
      await alice.get(comparisonPath).expect(404);
      const detail = (await alice.get(`/v1/field-data/review-queue/${item.id}`).expect(200)).body;
      assert.equal(detail.revision, Number(linked.headers.etag.match(/\d+/)[0]));
      assert.equal(detail.status, 'in-review');
      assert.equal(detail.decisions.length, 0);
    }));
});

describe('api: back-check cancellation', () => {
  it('retains cancellation history and permits a replacement without allowing a cancelled result',
    testService(async (service, { one }) => {
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
        .send(cancellation).expect(412);
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
      const replacementUser = (await alice.post('/v1/projects/1/app-users')
        .send({ displayName: 'replacement checker' }).expect(200)).body;
      await alice.post(`/v1/projects/1/forms/simple/assignments/app-user/${replacementUser.id}`).expect(200);
      const replacement = await alice.post(path).set('If-Match', cancelled.headers.etag)
        .send({ ...request, assignedTo: replacementUser.id,
          requestId: '00000000-0000-4000-8000-000000000013' }).expect(201);
      const history = (await alice.get(path).expect(200)).body;
      history.should.have.length(2);
      history[0].status.should.equal('cancelled');
      history[0].cancellationReason.should.equal(cancellation.reason);
      history[0].cancelledBy.should.equal(actorId);
      history[0].cancelledAt.should.not.equal(null);
      history[1].id.should.equal(replacement.body.id);
      history[0].assignedTo.should.equal(appUser.id);
      history[1].assignedTo.should.equal(replacementUser.id);
      const audit = await one(sql`SELECT count(*)::integer AS count FROM audits
        WHERE action = 'field_data.backcheck.cancel'
          AND details->>'backcheckId' = ${first.body.id}`);
      audit.count.should.equal(1);
    }));
});


describe('api: dedicated back-check forms', () => {
  it('pins a published response form, scopes collectors and links only that form',
    testServiceFullTrx(async (service, { one, run }) => {
      const alice = await service.login('alice');
      const chelsea = await service.login('chelsea');
      const viewerId = (await chelsea.get('/v1/users/current').expect(200)).body.id;
      await alice.post(`/v1/projects/1/forms/simple/assignments/viewer/${viewerId}`).expect(200);
      await alice.post('/v1/projects/1/forms?publish=true&ignoreWarnings=true')
        .set('Content-Type', 'application/xml').send(testData.forms.simple2.replaceAll('age', 'verified_age')).expect(200);
      const checker = (await alice.post('/v1/projects/1/app-users')
        .send({ displayName: 'Dedicated checker' }).expect(200)).body;
      await alice.post(`/v1/projects/1/forms/simple2/assignments/app-user/${checker.id}`).expect(200);
      await alice.post('/v1/projects/1/forms/simple/submissions')
        .set('Content-Type', 'application/xml').send(testData.instances.simple.one).expect(200);
      const item = (await alice.get('/v1/field-data/review-queue?projectId=1&xmlFormId=simple')
        .expect(200)).body.items[0];
      const actorId = (await alice.get('/v1/users/current').expect(200)).body.id;
      const assignment = await alice.patch(`/v1/field-data/review-queue/${item.id}/assignment`)
        .set('If-Match', item.etag).set('Idempotency-Key', 'dedicated-assignment')
        .send({ assignedTo: actorId, status: 'in-review' })
        .expect(200);
      const base = `/v1/field-data/review-queue/${item.id}`;
      const forms = (await alice.get(`${base}/backcheck-forms`).expect(200)).body;
      assert.ok(forms.find(f => f.xmlFormId === 'simple2').assignees.some(a => a.id === checker.id));
      assert.ok(!forms.find(f => f.xmlFormId === 'simple').assignees.some(a => a.id === checker.id));
      const body = { requestId: '00000000-0000-4000-8000-000000000021',
        assignedTo: checker.id, question: 'Verify using the dedicated form.', responseXmlFormId: 'simple2' };
      await alice.post(`${base}/backchecks`).set('If-Match', assignment.headers.etag)
        .send({ ...body, responseXmlFormId: 'simple' }).expect(400);
      await alice.patch('/v1/projects/1/forms/simple2').send({ state: 'closed' }).expect(200);
      await alice.post(`${base}/backchecks`).set('If-Match', assignment.headers.etag)
        .send(body).expect(400);
      await alice.patch('/v1/projects/1/forms/simple2').send({ state: 'open' }).expect(200);
      const created = await alice.post(`${base}/backchecks`).set('If-Match', assignment.headers.etag)
        .send(body).expect(201);
      const replay = await alice.post(`${base}/backchecks`).set('If-Match', assignment.headers.etag)
        .send(body).expect(201);
      assert.equal(replay.headers['idempotency-status'], 'replayed');
      await alice.post(`${base}/backchecks`).set('If-Match', created.headers.etag)
        .send({ ...body, responseXmlFormId: 'simple' }).expect(400);
      await service.post(`/v1/key/${checker.token}/projects/1/forms/simple2/submissions`)
        .set('Content-Type', 'application/xml').send(testData.instances.simple2.one.replaceAll('age', 'verified_age').replace('>30<', '>31<')).expect(200);
      const link = `${base}/backchecks/${created.body.id}/link`;
      await alice.post(link).set('If-Match', created.headers.etag).send({ instanceId: 'one' }).expect(400);
      const linked = await alice.post(link).set('If-Match', created.headers.etag).send({ instanceId: 's2one' }).expect(200);
      const listed = (await alice.get(`${base}/backchecks`).expect(200)).body;
      assert.equal(listed[0].responseXmlFormId, 'simple2');
      const comparison = (await alice.get(`${base}/backchecks/${created.body.id}/comparison`).expect(200)).body;
      assert.equal(comparison.backcheck.xmlFormId, 'simple2');
      assert.equal(comparison.original.xmlFormId, 'simple');
      assert.ok(comparison.backcheck.xmlDownloadUrl.includes('/forms/simple2/'));
      await alice.get(comparison.backcheck.xmlDownloadUrl).expect(200);
      await chelsea.get(`${base}/backchecks`).expect(404);
      await chelsea.get(`${base}/backchecks/${created.body.id}/comparison`).expect(404);
      await alice.post(`/v1/projects/1/forms/simple2/assignments/viewer/${viewerId}`).expect(200);
      await chelsea.get(`${base}/backchecks`).expect(200);
      await chelsea.get(`${base}/backchecks/${created.body.id}/comparison`).expect(200);
      const comparePath = `${base}/backchecks/${created.body.id}/comparison`;
      const mappingPath = `${base}/backchecks/${created.body.id}/mapping`;
      assert.equal(comparison.comparisonMode, 'unmapped');
      assert.equal(comparison.summary.same, 0);
      assert.equal(comparison.summary.unmappedOriginal, 2);
      assert.equal(comparison.summary.unmappedBackcheck, 2);
      assert.equal((await chelsea.get(comparePath).expect(200)).body.mapping.allowed, false);
      const mapping = { requestId: '00000000-0000-4000-8000-000000000031', note: 'Age questions are equivalent.',
        pairs: [{ originalPath: '/age[1]', backcheckPath: '/verified_age[1]', label: 'Age' }] };
      await chelsea.post(mappingPath).set('If-Match', comparison.mapping.etag).send(mapping).expect(403);
      await alice.post(mappingPath).send(mapping).expect(428);
      await alice.post(mappingPath).set('If-Match', '"review-case-1"').send(mapping).expect(400);
      await Promise.all([[...mapping.pairs, ...mapping.pairs],
        [{ ...mapping.pairs[0], originalPath: '/meta[1]/instanceID[1]' }],
        [{ ...mapping.pairs[0], originalPath: '/none[1]', backcheckPath: '/none[1]' }],
        [{ ...mapping.pairs[0], backcheckPath: '/verified_age[*]' }]].map(pairs =>
        alice.post(mappingPath).set('If-Match', comparison.mapping.etag).send({ ...mapping, pairs }).expect(400)));
      const saved = await alice.post(mappingPath).set('If-Match', comparison.mapping.etag).send(mapping).expect(201);
      assert.equal(saved.headers.etag, '"backcheck-mapping-1"');
      const mappingReplay = await alice.post(mappingPath).set('If-Match', comparison.mapping.etag).send(mapping).expect(201);
      assert.equal(mappingReplay.headers['idempotency-status'], 'replayed');
      await alice.post(mappingPath).set('If-Match', saved.headers.etag).send({ ...mapping, note: 'Changed retry.' }).expect(400);
      const next = { ...mapping, requestId: '00000000-0000-4000-8000-000000000032',
        note: 'Include a question missing from the response.', pairs: [...mapping.pairs,
          { originalPath: '/name[1]', backcheckPath: '/absent[1]', label: 'Respondent' }] };
      await alice.post(mappingPath).set('If-Match', comparison.mapping.etag).send(next).expect(412);
      await alice.post(mappingPath).set('If-Match', saved.headers.etag).send(next).expect(201);
      const mapped = (await chelsea.get(comparePath).expect(200)).body;
      assert.equal(mapped.comparisonMode, 'mapped');
      assert.equal(mapped.mapping.revision, 2);
      assert.equal(mapped.mapping.history.length, 2);
      assert.deepEqual(mapped.mapping.history[1].pairs, mapping.pairs);
      assert.equal(mapped.rows[0].originalPath, '/age[1]');
      assert.equal(mapped.rows[0].backcheckPath, '/verified_age[1]');
      assert.equal(mapped.summary.changed, 1);
      assert.equal(mapped.summary.missingBackcheck, 1);
      assert.equal(mapped.mapping.history[0].originalSubmissionDefId, mapped.original.submissionDefId);
      assert.equal(mapped.mapping.history[0].backcheckHash, mapped.backcheck.provenance.integrityHash);
      assert.equal(mapped.summary.unmappedBackcheck, 1);
      const audits = await one(sql`SELECT count(*)::integer AS count FROM audits
        WHERE action = 'field_data.backcheck.mapping'`);
      assert.equal(audits.count, 2);
      const detail = (await alice.get(base).expect(200)).body;
      assert.equal(detail.revision, Number(linked.headers.etag.match(/\d+/)[0]));
      assert.equal(detail.status, 'in-review');
      assert.equal(detail.decisions.length, 0);
      // Replays remain idempotent after later revisions, without restoring old mappings.
      await alice.post(mappingPath).set('If-Match', comparison.mapping.etag).send(mapping).expect(201);
      assert.equal((await alice.get(comparePath).expect(200)).body.mapping.revision, 2);
      const competing = await Promise.all(['00000000-0000-4000-8000-000000000034',
        '00000000-0000-4000-8000-000000000035'].map(requestId => alice.post(mappingPath)
        .set('If-Match', mapped.mapping.etag).send({ ...next, requestId })));
      assert.deepEqual(competing.map(result => result.status).sort(), [201, 412]);
      assert.equal((await one(sql`SELECT count(*)::integer AS count FROM audits
        WHERE action = 'field_data.backcheck.mapping'`)).count, 3);

      await run(sql`UPDATE submission_defs SET xml = xml || ' ' WHERE id = ${mapped.backcheck.submissionDefId}`);
      await alice.post(mappingPath).set('If-Match', '"backcheck-mapping-3"')
        .send({ ...next, requestId: '00000000-0000-4000-8000-000000000033' }).expect(400);
      const unavailable = (await alice.get(comparePath).expect(200)).body;
      assert.equal(unavailable.unavailableReason, 'source-integrity');
      assert.equal(unavailable.rows, undefined);

    }));
});

describe('api: O4 backcheck workload', () => {
  it('lists each App User\'s open backchecks and suggests the least loaded one, never the original collector',
    testService(async (service, { run }) => {
      const alice = await service.login('alice');
      const actorId = (await alice.get('/v1/users/current').expect(200)).body.id;
      const users = {};
      for (const name of ['Aminata', 'Bockarie', 'Christiana']) {
        users[name] = (await alice.post('/v1/projects/1/app-users').send({ displayName: name }).expect(200)).body; // eslint-disable-line no-await-in-loop
        await alice.post(`/v1/projects/1/forms/simple/assignments/app-user/${users[name].id}`).expect(200); // eslint-disable-line no-await-in-loop
      }
      // Aminata collects "one"; Alice collects "two".
      await service.post(`/v1/key/${users.Aminata.token}/projects/1/forms/simple/submissions`)
        .send(testData.instances.simple.one).set('Content-Type', 'application/xml').expect(200);
      await alice.post('/v1/projects/1/forms/simple/submissions')
        .send(testData.instances.simple.two).set('Content-Type', 'application/xml').expect(200);
      const { items } = (await alice.get('/v1/field-data/review-queue?projectId=1&xmlFormId=simple').expect(200)).body;
      const caseOf = (instanceId) => items.find((item) => item.claim.rootInstanceId === instanceId);
      // Bockarie already has an open, overdue backcheck on "two".
      const two = caseOf('two');
      const taken = await alice.patch(`/v1/field-data/review-queue/${two.id}/assignment`).set('If-Match', two.etag)
        .set('Idempotency-Key', 'o4-two').send({ assignedTo: actorId, status: 'in-review' })
        .expect(200);
      await alice.post(`/v1/field-data/review-queue/${two.id}/backchecks`).set('If-Match', taken.headers.etag)
        .send({ requestId: '00000000-0000-4000-8000-0000000000a1', assignedTo: users.Bockarie.id, question: 'Revisit.', dueAt: '2026-01-01T00:00:00Z' })
        .expect(201);

      const one = caseOf('one');
      await alice.patch(`/v1/field-data/review-queue/${one.id}/assignment`).set('If-Match', one.etag)
        .set('Idempotency-Key', 'o4-one').send({ assignedTo: actorId, status: 'in-review' })
        .expect(200);
      const assignees = (await alice.get(`/v1/field-data/review-queue/${one.id}/backcheck-assignees`).expect(200)).body;
      assignees.map((a) => [a.name, a.pending, a.overdue, a.original, a.suggested]).should.eql([
        ['Aminata', 0, 0, true, false],
        ['Bockarie', 1, 1, false, false],
        ['Christiana', 0, 0, false, true]
      ]);
      const forms = (await alice.get(`/v1/field-data/review-queue/${one.id}/backcheck-forms`).expect(200)).body;
      forms.find((f) => f.xmlFormId === 'simple').assignees.find((a) => a.suggested).name.should.equal('Christiana');

      // Without a due date it is no longer overdue, but still open.
      await run(sql`UPDATE field_data_backchecks SET "dueAt" = NULL`);
      const again = (await alice.get(`/v1/field-data/review-queue/${one.id}/backcheck-assignees`).expect(200)).body;
      again.find((a) => a.name === 'Bockarie').should.containEql({ pending: 1, overdue: 0 });
      again.find((a) => a.suggested).name.should.equal('Christiana');
    }));
});
