// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { strict: assert } = require('assert');
const { createECDH, randomBytes, generateKeyPairSync, verify } = require('crypto');
const { sql } = require('slonik');
const { promisify } = require('util');
const { workerQueue } = require('../../../lib/worker/worker');
const webpush = require('web-push');
const { testService } = require('../setup');
const testData = require('../../data/xml');
const { dispatchBackcheckPush } = require('../../../lib/worker/backcheck-push');
const offlineAssignments = require('../../../lib/util/offline-assignments');
const base = '/v1/field-data/app-user';
const setup = async (service) => {
  const alice = await service.login('alice');
  const checker = (await alice.post('/v1/projects/1/app-users').send({ displayName: 'Checker' }).expect(200)).body;
  const other = (await alice.post('/v1/projects/1/app-users').send({ displayName: 'Other' }).expect(200)).body;
  await alice.post(`/v1/projects/1/forms/simple/assignments/app-user/${checker.id}`).expect(200);
  await alice.post('/v1/projects/1/forms/simple/submissions').send(testData.instances.simple.one)
    .set('Content-Type', 'application/xml').expect(200);
  const item = (await alice.get('/v1/field-data/review-queue?projectId=1&xmlFormId=simple').expect(200)).body.items[0];
  const actorId = (await alice.get('/v1/users/current').expect(200)).body.id;
  const assigned = await alice.patch(`/v1/field-data/review-queue/${item.id}/assignment`)
    .set('If-Match', item.etag).set('Idempotency-Key', 'push-assignment')
    .send({ assignedTo: actorId, status: 'in-review' })
    .expect(200);
  const path = `/v1/field-data/review-queue/${item.id}/backchecks`;
  const created = await alice.post(path).set('If-Match', assigned.headers.etag)
    .send({ requestId: '00000000-0000-4000-8000-000000000031', assignedTo: checker.id,
      question: 'Verify the visit.', responseXmlFormId: 'simple' }).expect(201);
  return { alice, checker, other, item, path, created };
};
const subscription = (number = 1) => {
  const key = createECDH('prime256v1');
  return { endpoint: `https://fcm.googleapis.com/fcm/send/fixture-${number}`,
    keys: { p256dh: key.generateKeys().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
};
const withPush = async (test) => {
  const keys = webpush.generateVAPIDKeys();
  const values = { FIELD_DATA_PUSH_ENABLED: 'true', FIELD_DATA_PUSH_SUBJECT: 'mailto:push@example.test',
    FIELD_DATA_PUSH_PUBLIC_KEY: keys.publicKey, FIELD_DATA_PUSH_PRIVATE_KEY: keys.privateKey };
  const before = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  try { await test(values); } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value == null) delete process.env[key]; else process.env[key] = value;
    }
  }
};

describe('api: App User backcheck notifications', () => {
  it('signs bounded offline snapshots without leaking source answers and honors live access removal',
    testService(async (service, { one, run }) => {
      const { checker, other, alice } = await setup(service);
      const saved = { key: process.env.FIELD_DATA_OFFLINE_SIGNING_KEY,
        origin: process.env.FIELD_DATA_OFFLINE_ORIGIN };
      try {
        delete process.env.FIELD_DATA_OFFLINE_SIGNING_KEY;
        delete process.env.FIELD_DATA_OFFLINE_ORIGIN;
        const path = `${base}/offline-assignments`;
        const get = token => service.get(path).set('Authorization', `Bearer ${token}`);
        await service.get(path).expect(401);
        await alice.get(path).expect(403);
        assert.deepEqual((await get(checker.token).expect(200)).body, { enabled: false });
        const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
        process.env.FIELD_DATA_OFFLINE_SIGNING_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' });
        process.env.FIELD_DATA_OFFLINE_ORIGIN = 'https://field.example.test';
        assert.throws(() => offlineAssignments.issue(offlineAssignments.config(), {
          actorId: checker.id, projectId: 1, displayName: 'Checker', projectName: 'x'.repeat(262145)
        }, []), error => error.isProblem === true);
        const response = await get(checker.token).expect(200);
        assert.equal(response.headers['cache-control'], 'private, no-store');
        const { bundle } = response.body;
        const bytes = Buffer.from(bundle.payload, 'base64url');
        assert(verify('sha256', bytes, { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(bundle.signature, 'base64url')));
        const data = JSON.parse(bytes.toString('utf8'));
        assert.equal(data.actorId, checker.id);
        assert.equal(data.items.length, 1);
        assert.equal(data.items[0].question, 'Verify the visit.');
        assert.equal(data.items[0].claimVersionId, undefined);
        assert.equal(data.items[0].caseId, undefined);
        assert.equal(data.audience, 'https://field.example.test');
        assert.equal(Date.parse(data.expiresAt) - Date.parse(data.issuedAt), 8 * 3600000);
        assert(!JSON.stringify(response.body).includes(checker.token));
        assert.equal(JSON.parse(Buffer.from((await get(other.token).expect(200)).body.bundle.payload,
          'base64url').toString('utf8')).items.length, 0);
        const audit = await one(sql`SELECT details FROM audits
          WHERE action = 'field_data.offline.assignments.issue' AND details->>'bundleId' = ${data.id}`);
        assert.equal(audit.details.count, 1);
        assert.equal(audit.details.keyId, bundle.keyId);
        await run(sql`INSERT INTO field_data_backchecks
          ("caseId", "claimVersionId", "requestId", "requestHash", "assignedTo", question, status, "responseFormId")
          SELECT b."caseId", b."claimVersionId", gen_random_uuid(), 'offline-pagination', b."assignedTo",
            'Older instruction', 'cancelled', b."responseFormId"
          FROM field_data_backchecks b CROSS JOIN generate_series(1, 51) n WHERE b.id = ${data.items[0].id}`);
        const bounded = JSON.parse(Buffer.from((await get(checker.token).expect(200)).body.bundle.payload,
          'base64url').toString('utf8'));
        assert.equal(bounded.items.length, 50);
        assert.equal(bounded.complete, false);
        await alice.delete(`/v1/projects/1/forms/simple/assignments/app-user/${checker.id}`).expect(200);
        assert.equal(JSON.parse(Buffer.from((await get(checker.token).expect(200)).body.bundle.payload,
          'base64url').toString('utf8')).items.length, 0);
        await alice.delete(`/v1/projects/1/app-users/${checker.id}`).expect(200);
        await get(checker.token).expect(401);
        process.env.FIELD_DATA_OFFLINE_ORIGIN = 'http://untrusted.test';
        assert.deepEqual((await get(other.token).expect(200)).body, { enabled: false });
      } finally {
        if (saved.key == null) delete process.env.FIELD_DATA_OFFLINE_SIGNING_KEY;
        else process.env.FIELD_DATA_OFFLINE_SIGNING_KEY = saved.key;
        if (saved.origin == null) delete process.env.FIELD_DATA_OFFLINE_ORIGIN;
        else process.env.FIELD_DATA_OFFLINE_ORIGIN = saved.origin;
      }
    }));
  it('scopes instructions and acknowledgment to the assignee and paginates without losing microseconds',
    testService(async (service, container) => {
      const { alice, checker, other, item, created } = await setup(service);
      await service.get(`${base}/backchecks`).expect(401);
      await alice.get(`${base}/backchecks`).expect(403);
      const own = () => service.get(`${base}/backchecks`).set('Authorization', `Bearer ${checker.token}`);
      const first = await own().expect(200);
      assert.equal(first.headers['cache-control'], 'private, no-store');
      assert.equal(first.body.items.length, 1);
      assert.equal(first.body.items[0].actionable, true);
      assert.equal(first.body.items[0].question, 'Verify the visit.');
      assert.equal(first.body.items[0].claimVersionId, undefined);
      assert.equal(first.body.items[0].caseId, undefined);
      assert.equal((await service.get(`${base}/backchecks`).set('Authorization', `Bearer ${other.token}`).expect(200)).body.items.length, 0);
      const seenPath = `${base}/backchecks/${created.body.id}/seen`;
      await service.post(seenPath).set('Authorization', `Bearer ${other.token}`).expect(404);
      const seen = (await service.post(seenPath).set('Authorization', `Bearer ${checker.token}`).expect(200)).body;
      assert.equal((await service.post(seenPath).set('Authorization', `Bearer ${checker.token}`).expect(200)).body.seenAt, seen.seenAt);
      const detail = (await alice.get(`/v1/field-data/review-queue/${item.id}`).expect(200)).body;
      assert.equal(detail.status, 'in-review');
      assert.equal(detail.revision, Number(created.headers.etag.match(/\d+/)[0]));
      await container.db.query(sql`INSERT INTO field_data_backchecks
        ("caseId", "claimVersionId", "requestId", "requestHash", "assignedTo", question, status, "responseFormId", "createdAt")
        SELECT b."caseId", b."claimVersionId", gen_random_uuid(), 'pagination', b."assignedTo", 'Older instruction',
          'cancelled', b."responseFormId", '2030-01-01T00:00:00.123456Z'::timestamptz + g * interval '1 microsecond'
        FROM field_data_backchecks b CROSS JOIN generate_series(1, 51) g WHERE b.id = ${created.body.id}`);
      const page1 = (await own().expect(200)).body;
      assert.equal(page1.items.length, 50);
      const page2 = (await service.get(`${base}/backchecks?cursor=${encodeURIComponent(page1.nextCursor)}`)
        .set('Authorization', `Bearer ${checker.token}`).expect(200)).body;
      assert.equal(page2.items.length, 2);
      assert.equal(new Set([...page1.items, ...page2.items].map(row => row.id)).size, 52);
      await service.get(`${base}/backchecks?cursor=invalid`).set('Authorization', `Bearer ${checker.token}`).expect(400);
      await alice.delete(`/v1/projects/1/forms/simple/assignments/app-user/${checker.id}`).expect(200);
      assert.equal((await own().expect(200)).body.items.length, 0);
      await service.post(seenPath).set('Authorization', `Bearer ${checker.token}`).expect(404);
    }));

  it('protects subscription destinations, ownership, replay and device limits',
    testService(async (service) => withPush(async () => {
      const { checker, other, alice } = await setup(service);
      const data = subscription();
      const register = body => service.post(`${base}/push`).set('Authorization', `Bearer ${checker.token}`).send(body);
      await alice.post(`${base}/push`).send(data).expect(403);
      const invalid = ['http://fcm.googleapis.com/send/x', 'https://127.0.0.1/x',
        'https://fcm.googleapis.com.evil.test/x', 'https://user:pass@fcm.googleapis.com/x'];
      await Promise.all(invalid.map(endpoint => register({ ...data, endpoint }).expect(400)));
      await register({ ...data, keys: { ...data.keys, auth: 'invalid' } }).expect(400);
      const first = (await register(data).expect(200)).body;
      assert.equal((await register(data).expect(200)).body.id, first.id);
      await service.post(`${base}/push`).set('Authorization', `Bearer ${other.token}`).send(data).expect(409);
      await service.delete(`${base}/push/${first.id}`).set('Authorization', `Bearer ${other.token}`).expect(200);
      const config = (await service.get(`${base}/push`).set('Authorization', `Bearer ${checker.token}`).expect(200)).body;
      assert.equal(config.enabled, true);
      assert.equal(config.subscriptions.length, 1);
      assert.equal(config.privateKey, undefined);
      assert.equal(config.subscriptions[0].endpoint, undefined);
      await register(subscription(2)).expect(200);
      await register(subscription(3)).expect(200);
      await register(subscription(4)).expect(409);
      await service.delete(`${base}/push/${first.id}`).set('Authorization', `Bearer ${checker.token}`).expect(200);
      await register(subscription(4)).expect(200);
    })));

  it('queues transitions durably, sends private updates and handles retry, expiry, cancellation and revoked access',
    testService(async (service, container) => withPush(async (env) => {
      const { checker, other, alice, path, created } = await setup(service);
      await service.post(`${base}/push`).set('Authorization', `Bearer ${checker.token}`).send(subscription()).expect(200);
      await service.post(`${base}/push`).set('Authorization', `Bearer ${other.token}`).send(subscription(2)).expect(200);
      const event = await container.db.one(sql`SELECT * FROM audits WHERE action = 'field_data.backcheck.request'
        AND details->>'backcheckId' = ${created.body.id}`);
      assert.equal(event.processed, null);
      const delivered = [];
      await dispatchBackcheckPush(container, event, async (target, payload) => delivered.push({ target, payload }), env);
      assert.equal(delivered.length, 1);
      assert.equal(delivered[0].target.endpoint, subscription().endpoint);
      assert.deepEqual(JSON.parse(delivered[0].payload), { type: 'backcheck-update', tag: `backcheck-${created.body.id}` });
      await assert.rejects(dispatchBackcheckPush(container, event, async () => {
        throw Object.assign(new Error('Provider body with secrets'), { statusCode: 503 });
      }, env), { message: 'Backcheck push delivery failed' });
      const retryQueue = workerQueue(container.with({ Sentry: { captureException: () => {} } }), {
        'field_data.backcheck.request': [ (tx, queued) => dispatchBackcheckPush(tx, queued, async () => {
          throw Object.assign(new Error(), { statusCode: 503 });
        }, env) ]
      });
      await promisify(retryQueue.run)(event);
      const failed = await container.db.one(sql`SELECT * FROM audits WHERE id = ${event.id}`);
      assert.equal(failed.processed, null);
      assert.equal(failed.failures, 1);
      const successQueue = workerQueue(container, {
        'field_data.backcheck.request': [ (tx, queued) => dispatchBackcheckPush(tx, queued, async () => {}, env) ]
      });
      await promisify(successQueue.run)(failed);
      assert.ok((await container.db.one(sql`SELECT processed FROM audits WHERE id = ${event.id}`)).processed);
      await dispatchBackcheckPush(container, event, async () => {
        throw Object.assign(new Error(), { statusCode: 410 });
      }, env);
      assert.equal((await service.get(`${base}/push`).set('Authorization', `Bearer ${checker.token}`).expect(200)).body.subscriptions.length, 0);
      await service.post(`${base}/push`).set('Authorization', `Bearer ${checker.token}`).send(subscription()).expect(200);
      await service.post(`${base}/backchecks/${created.body.id}/seen`).set('Authorization', `Bearer ${checker.token}`).expect(200);
      await dispatchBackcheckPush(container, event, async () => assert.fail('acknowledged request delivered'), env);
      const cancelled = await alice.post(`${path}/${created.body.id}/cancel`).set('If-Match', created.headers.etag)
        .send({ requestId: '00000000-0000-4000-8000-000000000032', reason: 'Visit no longer needed.' }).expect(200);
      await dispatchBackcheckPush(container, event, async () => assert.fail('stale request delivered'), env);
      const cancel = await container.db.one(sql`SELECT * FROM audits WHERE action = 'field_data.backcheck.cancel'
        AND details->>'backcheckId' = ${created.body.id}`);
      await dispatchBackcheckPush(container, cancel, async () => {}, env);
      const replacement = await alice.post(path).set('If-Match', cancelled.headers.etag)
        .send({ requestId: '00000000-0000-4000-8000-000000000033', assignedTo: checker.id,
          question: 'Replacement visit.', responseXmlFormId: 'simple' }).expect(201);
      await service.post('/v1/projects/1/forms/simple/submissions').set('Authorization', `Bearer ${checker.token}`)
        .send(testData.instances.simple.one.replace('one</instanceID>', 'second</instanceID>'))
        .set('Content-Type', 'application/xml')
        .expect(200);
      await alice.post(`${path}/${replacement.body.id}/link`).set('If-Match', replacement.headers.etag)
        .send({ instanceId: 'second' }).expect(200);
      const linked = await container.db.one(sql`SELECT * FROM audits WHERE action = 'field_data.backcheck.link'
        AND details->>'backcheckId' = ${replacement.body.id}`);
      let linkedCount = 0;
      await dispatchBackcheckPush(container, linked, async () => { linkedCount += 1; }, env);
      assert.equal(linkedCount, 1);
      await alice.delete(`/v1/projects/1/forms/simple/assignments/app-user/${checker.id}`).expect(200);
      await dispatchBackcheckPush(container, cancel, async () => assert.fail('revoked assignment delivered'), env);
      await dispatchBackcheckPush(container, cancel, async () => assert.fail('disabled push delivered'), { ...env, FIELD_DATA_PUSH_ENABLED: 'false' });
    })));
});
