/* eslint-disable no-await-in-loop */
// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { sql } = require('slonik');
const { testService, testServiceFullTrx } = require('../setup');
const xml = require('../../data/xml');
const root = '/v1/field-data/app-user/capture-challenges';
const uploads = '/v1/field-data/app-user/media-uploads';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yX3cAAAAASUVORK5CYII=', 'base64');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const setup = async service => {
  const alice = await service.login('alice');
  await alice.post('/v1/projects/1/forms?publish=true').set('Content-Type', 'application/xml').send(xml.forms.binaryType).expect(200);
  const make = async displayName => {
    const user = (await alice.post('/v1/projects/1/app-users').send({ displayName }).expect(200)).body;
    await alice.post(`/v1/projects/1/forms/binaryType/assignments/app-user/${user.id}`).expect(200); return user;
  };
  const collector = await make('Collector'); const other = await make('Other');
  await service.post('/v1/projects/1/forms/binaryType/submissions').set('Authorization', `Bearer ${collector.token}`)
    .set('Content-Type', 'application/xml').send(xml.instances.binaryType.both)
    .expect(200);
  const as = (user, method, path = '') => service[method](`${root}${path}`).set('Authorization', `Bearer ${user.token}`);
  const manifest = { id: randomUUID(), xmlFormId: 'binaryType', instanceId: 'both', name: 'here_is_file2.jpg' };
  const stage = async (challenge, bytes = png, overrides = {}) => {
    const body = { id: randomUUID(), xmlFormId: challenge.xmlFormId, instanceId: challenge.instanceId, name: challenge.name,
      size: bytes.length, sha256: hash(bytes), contentType: 'image/png', priority: 1,
      challengeId: challenge.id, challengeNonce: challenge.nonce, ...overrides };
    await service.post(uploads).set('Authorization', `Bearer ${collector.token}`).send(body).expect(200);
    await service.put(`${uploads}/${body.id}/chunks/0`).set('Authorization', `Bearer ${collector.token}`)
      .set('Content-Type', 'application/octet-stream').set('X-Chunk-Sha256', hash(bytes))
      .send(bytes)
      .expect(200);
    return body;
  };
  const complete = body => service.post(`${uploads}/${body.id}/complete`).set('Authorization', `Bearer ${collector.token}`);
  return { alice, collector, other, as, manifest, stage, complete };
};
describe('api: capture challenges', () => {
  it('issues once, binds exact uploaded bytes atomically, and shows honest reviewer metadata without the nonce', testService(async (service, c) => {
    const { alice, collector, other, as, manifest, stage, complete } = await setup(service);
    const challenge = (await as(collector, 'post').send(manifest).expect(200)).body;
    assert.equal(Date.parse(challenge.expiresAt) - Date.parse(challenge.issuedAt), 20 * 60000);
    assert.match(challenge.nonce, /^[0-9a-f]{64}$/); assert.equal(challenge.code, challenge.nonce.slice(0, 8).toUpperCase());
    assert.equal((await as(collector, 'post').send(manifest).expect(200)).body.nonce, challenge.nonce);
    assert.equal((await as(collector, 'get').expect(200)).body.items.length, 1);
    await as(other, 'post').send(manifest).expect(404);
    assert.equal((await as(other, 'get').expect(200)).body.items.length, 0);
    const body = await stage(challenge);
    await complete(body).expect(200); await complete(body).expect(200);
    const path = '/v1/projects/1/forms/binaryType/submissions/both/capture-challenges';
    const response = await alice.get(path).expect(200);
    const bound = response.body.items[0]; assert.equal(bound.status, 'bound'); assert.equal(bound.bindingCurrent, true);
    assert.equal(bound.sceneReview, 'not-assessed'); assert.equal(bound.contentHash, hash(png)); assert.equal(bound.nonce, undefined);
    assert.equal(response.headers['cache-control'], 'private, no-store');
    await service.get(path).expect(401);
    await service.get(path).set('Authorization', `Bearer ${other.token}`).expect(404);
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM audits WHERE action = 'field_data.capture.bound'`), 1);
    const logs = await c.db.any(sql`SELECT details FROM audits WHERE action LIKE 'field_data.capture.%'`);
    assert.equal(JSON.stringify(logs).includes(challenge.nonce), false);
    await as(collector, 'delete', `/${challenge.id}`).expect(409);
    // A later native manager replacement cannot retain the current-binding badge.
    await alice.post('/v1/projects/1/forms/binaryType/submissions/both/attachments/here_is_file2.jpg')
      .set('Content-Type', 'image/png').send(Buffer.concat([png, Buffer.from('changed')])).expect(200);
    assert.equal((await alice.get(path).expect(200)).body.items[0].bindingCurrent, false);
  }));
  it('rejects bad manifests and inaccessible or already populated targets', testService(async service => {
    const { alice, collector, other, as, manifest } = await setup(service);
    await service.post(root).send(manifest).expect(401); await alice.post(root).send(manifest).expect(403);
    await as(other, 'post').send({ ...manifest, id: randomUUID() }).expect(404);
    for (const patch of [{ name: '../photo.jpg' }, { id: 'bad' }, { nonce: 'unexpected' }]) await as(collector, 'post').send({ ...manifest, ...patch }).expect(400);
    await as(collector, 'post').send({ ...manifest, name: 'not-expected.jpg' }).expect(404);
    await as(collector, 'post').send({ ...manifest, instanceId: 'missing' }).expect(404);
    await service.post('/v1/projects/1/forms/binaryType/submissions/both/attachments/here_is_file2.jpg')
      .set('Authorization', `Bearer ${collector.token}`).set('Content-Type', 'image/png').send(png)
      .expect(200);
    await as(collector, 'post').send(manifest).expect(409);
  }));
  it('rejects wrong nonces, target changes, expired challenges and non-image bytes without linking attachments', testService(async (service, c) => {
    const { collector, as, manifest, stage, complete } = await setup(service);
    const challenge = (await as(collector, 'post').send(manifest).expect(200)).body;
    await as(collector, 'post').send({ ...manifest, name: 'my_file1.mp4' }).expect(409);
    const badNonce = await stage(challenge, png, { challengeNonce: '0'.repeat(64) }); await complete(badNonce).expect(409);
    const badTarget = await stage(challenge, png, { name: 'my_file1.mp4' }); await complete(badTarget).expect(409);
    const notImage = await stage(challenge, Buffer.from('ordinary text')); await complete(notImage).expect(400);
    const expired = await stage(challenge);
    await c.db.query(sql`UPDATE field_data_capture_challenges SET "expiresAt" = clock_timestamp() - interval '1 second' WHERE id = ${challenge.id}`);
    await complete(expired).expect(409);
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM submission_attachments WHERE "blobId" IS NOT NULL`), 0);
    const renewed = (await as(collector, 'post').send({ ...manifest, id: randomUUID() }).expect(200)).body;
    assert.notEqual(renewed.nonce, challenge.nonce);
  }));
  it('allows owners to cancel after revocation and prevents cancelled or consumed challenge reuse', testService(async service => {
    const { alice, collector, other, as, manifest, stage, complete } = await setup(service);
    const challenge = (await as(collector, 'post').send(manifest).expect(200)).body;
    const staged = await stage(challenge);
    await as(other, 'delete', `/${challenge.id}`).expect(404);
    await alice.delete(`/v1/projects/1/forms/binaryType/assignments/app-user/${collector.id}`).expect(200);
    assert.equal((await as(collector, 'get').expect(200)).body.items.length, 0);
    await complete(staged).expect(404);
    await as(collector, 'delete', `/${challenge.id}`).expect(200); await as(collector, 'delete', `/${challenge.id}`).expect(200);
    await alice.post(`/v1/projects/1/forms/binaryType/assignments/app-user/${collector.id}`).expect(200);
    await complete(staged).expect(409);
  }));
  it('rejects a previously bound fingerprint at another target without exposing the earlier collector', testService(async (service, c) => {
    const { collector, as, manifest, stage, complete } = await setup(service);
    const first = (await as(collector, 'post').send(manifest).expect(200)).body;
    await complete(await stage(first)).expect(200);
    const second = (await as(collector, 'post').send({ ...manifest, id: randomUUID(), name: 'my_file1.mp4' }).expect(200)).body;
    await complete(await stage(second)).expect(409);
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_capture_challenges WHERE status = 'bound'`), 1);
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM submission_attachments WHERE name = 'my_file1.mp4' AND "blobId" IS NOT NULL`), 0);
  }));
  it('serializes concurrent retries and competing challenge issuance', testServiceFullTrx(async service => {
    const { collector, as, manifest, stage, complete } = await setup(service);
    const requests = await Promise.all([as(collector, 'post').send(manifest), as(collector, 'post').send({ ...manifest, id: randomUUID() })]);
    assert.deepEqual(requests.map(r => r.status).sort(), [200, 409]);
    const challenge = requests.find(r => r.status === 200).body;
    const staged = await stage(challenge);
    const finished = await Promise.all([complete(staged), complete(staged)]);
    assert.deepEqual(finished.map(r => r.status), [200, 200]);
  }));
});

describe('api: capture challenge lifecycle and concurrency', () => {
  it('rechecks closed forms and changed source definitions before binding', testService(async (service, c) => {
    const { alice, collector, as, manifest, stage, complete } = await setup(service);
    const challenge = (await as(collector, 'post').send(manifest).expect(200)).body; const staged = await stage(challenge);
    await alice.patch('/v1/projects/1/forms/binaryType').send({ state: 'closed' }).expect(200);
    await complete(staged).expect(404);
    await alice.patch('/v1/projects/1/forms/binaryType').send({ state: 'open' }).expect(200);
    await c.db.query(sql`UPDATE submission_defs SET root = FALSE WHERE id = (SELECT "submissionDefId" FROM field_data_capture_challenges WHERE id = ${challenge.id})`);
    await complete(staged).expect(404);
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_capture_challenges WHERE status = 'bound'`), 0);
  }));
  it('enforces the rolling daily issue limit and cannot reset it by cancelling', testService(async (service, c) => {
    const { collector, as, manifest } = await setup(service);
    const first = (await as(collector, 'post').send(manifest).expect(200)).body;
    await as(collector, 'delete', `/${first.id}`).expect(200);
    for (let i = 0; i < 99; i += 1) await c.db.query(sql`INSERT INTO field_data_capture_challenges
      (id, "actorId", "projectId", "submissionDefId", "xmlFormId", "instanceId", name, nonce, status)
      SELECT ${randomUUID()}, "actorId", "projectId", "submissionDefId", "xmlFormId", "instanceId", name, nonce, 'cancelled'
      FROM field_data_capture_challenges WHERE id = ${first.id}`);
    await as(collector, 'post').send({ ...manifest, id: randomUUID() }).expect(409);
  }));
  it('accepts only one image fingerprint across concurrent distinct challenges', testServiceFullTrx(async service => {
    const { collector, as, manifest, stage, complete } = await setup(service);
    const a = (await as(collector, 'post').send(manifest).expect(200)).body;
    const b = (await as(collector, 'post').send({ ...manifest, id: randomUUID(), name: 'my_file1.mp4' }).expect(200)).body;
    const first = await stage(a); const second = await stage(b);
    const results = await Promise.all([complete(first), complete(second)]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  }));
});
