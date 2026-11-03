/* eslint-disable no-await-in-loop */
// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { sql } = require('slonik');
const { testService, testServiceFullTrx } = require('../setup');
const xml = require('../../data/xml');
const root = '/v1/field-data/app-user/media-uploads';
const CHUNK = 262144;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const setup = async service => {
  const alice = await service.login('alice');
  await alice.post('/v1/projects/1/forms?publish=true').set('Content-Type', 'application/xml').send(xml.forms.binaryType).expect(200);
  const make = async name => {
    const user = (await alice.post('/v1/projects/1/app-users').send({ displayName: name }).expect(200)).body;
    await alice.post(`/v1/projects/1/forms/binaryType/assignments/app-user/${user.id}`).expect(200); return user;
  };
  const collector = await make('Collector'); const other = await make('Other');
  await service.post('/v1/projects/1/forms/binaryType/submissions').set('Authorization', `Bearer ${collector.token}`)
    .set('Content-Type', 'application/xml').send(xml.instances.binaryType.both)
    .expect(200);
  const as = (user, method, path = '') => service[method](`${root}${path}`).set('Authorization', `Bearer ${user.token}`);
  const data = Buffer.alloc(CHUNK + 13, 7);
  const manifest = { id: randomUUID(), xmlFormId: 'binaryType', instanceId: 'both', name: 'my_file1.mp4', size: data.length,
    sha256: hash(data), contentType: 'video/mp4', priority: 3 };
  const put = (user, id, offset, bytes, digest = hash(bytes)) => as(user, 'put', `/${id}/chunks/${offset}`)
    .set('Content-Type', 'application/octet-stream').set('X-Chunk-Sha256', digest).send(bytes);
  return { alice, collector, other, as, data, manifest, put };
};
describe('api: resumable media uploads', () => {
  it('resumes verified chunks, tolerates lost acknowledgements and commits the exact native attachment once', testService(async (service, c) => {
    const { alice, collector, as, data, manifest, put } = await setup(service);
    const created = await as(collector, 'post').send(manifest).expect(200);
    assert.equal(created.headers['cache-control'], 'private, no-store');
    await as(collector, 'post').send(manifest).expect(200);
    await as(collector, 'post', `/${manifest.id}/complete`).expect(409);
    const first = data.subarray(0, CHUNK); const last = data.subarray(CHUNK);
    await put(collector, manifest.id, CHUNK, last).expect(409);
    await put(collector, manifest.id, 0, first, '0'.repeat(64)).expect(400);
    await put(collector, manifest.id, 0, Buffer.alloc(CHUNK + 1)).expect(400);
    await put(collector, manifest.id, 0, first).expect(200);
    const retry = await put(collector, manifest.id, 0, first).expect(200);
    assert.equal(retry.body.offset, CHUNK);
    await put(collector, manifest.id, 0, Buffer.alloc(CHUNK, 8)).expect(409);
    assert.equal((await as(collector, 'get', `/${manifest.id}`).expect(200)).body.offset, CHUNK);
    await put(collector, manifest.id, CHUNK, last).expect(200);
    const result = await as(collector, 'post', `/${manifest.id}/complete`).expect(200);
    assert.equal(result.body.status, 'completed');
    await as(collector, 'post', `/${manifest.id}/complete`).expect(200);
    const attachment = await alice.get('/v1/projects/1/forms/binaryType/submissions/both/attachments/my_file1.mp4').expect(200);
    assert.equal(hash(attachment.body), manifest.sha256);
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_media_upload_chunks`), 0);
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM audits WHERE action = 'submission.attachment.update'
      AND details->>'uploadId' = ${manifest.id}`), 1);
    await as(collector, 'post').send({ ...manifest, id: randomUUID() }).expect(409);
  }));
  it('requires XML first, isolates actors, checks permissions and bounds manifests', testService(async service => {
    const { alice, collector, other, as, manifest, put, data } = await setup(service);
    await service.post(root).send(manifest).expect(401);
    await alice.post(root).send(manifest).expect(403);
    await as(other, 'post').send(manifest).expect(404);
    await as(collector, 'post').send({ ...manifest, instanceId: 'not-synced' }).expect(404);
    await as(collector, 'post').send({ ...manifest, name: 'not-expected.jpg' }).expect(404);
    await as(collector, 'post').send({ ...manifest, name: '../escape.jpg' }).expect(400);
    await as(collector, 'post').send({ ...manifest, size: 20 * 1024 * 1024 + 1 }).expect(400);
    await as(collector, 'post').send({ ...manifest, priority: 0 }).expect(400);
    await as(collector, 'post').send(manifest).expect(200);
    await as(collector, 'post').send({ ...manifest, sha256: '0'.repeat(64) }).expect(409);
    await as(other, 'get', `/${manifest.id}`).expect(404);
    await put(other, manifest.id, 0, data.subarray(0, CHUNK)).expect(404);
    assert.equal((await as(other, 'get').expect(200)).body.items.length, 0);
    await alice.delete(`/v1/projects/1/forms/binaryType/assignments/app-user/${collector.id}`).expect(200);
    await as(collector, 'get', `/${manifest.id}`).expect(404);
    await put(collector, manifest.id, 0, data.subarray(0, CHUNK)).expect(404);
    // The owner can still discard temporary bytes after form access is removed.
    await as(collector, 'delete', `/${manifest.id}`).expect(200);
  }));
  it('rejects a wrong whole-file hash and expires abandoned sessions', testService(async (service, c) => {
    const { collector, as, manifest, put } = await setup(service);
    const data = Buffer.from('wrong-content');
    const broken = { ...manifest, size: data.length, sha256: hash(Buffer.from('right-content')) };
    await as(collector, 'post').send(broken).expect(200);
    await put(collector, manifest.id, 0, data).expect(200);
    await as(collector, 'post', `/${manifest.id}/complete`).expect(400);
    await c.db.query(sql`UPDATE field_data_media_uploads SET "expiresAt" = clock_timestamp() - interval '1 second' WHERE id = ${manifest.id}`);
    await as(collector, 'get', `/${manifest.id}`).expect(404);
    await as(collector, 'post').send({ ...manifest, id: randomUUID() }).expect(200);
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_media_upload_chunks`), 0);
  }));
  it('serializes simultaneous retries of the same chunk', testServiceFullTrx(async service => {
    const { collector, as, manifest, put, data } = await setup(service);
    await as(collector, 'post').send(manifest).expect(200);
    const results = await Promise.all([put(collector, manifest.id, 0, data.subarray(0, CHUNK)), put(collector, manifest.id, 0, data.subarray(0, CHUNK))]);
    assert.deepEqual(results.map(r => r.status), [200, 200]);
    assert.equal((await as(collector, 'get', `/${manifest.id}`).expect(200)).body.offset, CHUNK);
  }));
});

describe('api: media upload resource limits and storage integrity', () => {
  it('reserves byte quota and releases it on cancellation', testService(async service => {
    const { collector, as, manifest } = await setup(service); const ids = [];
    for (let i = 0; i < 5; i += 1) {
      const id = randomUUID(); ids.push(id);
      await as(collector, 'post').send({ ...manifest, id, size: 20 * 1024 * 1024 }).expect(200);
    }
    await as(collector, 'post').send({ ...manifest, id: randomUUID(), size: 1 }).expect(409);
    await as(collector, 'delete', `/${ids[0]}`).expect(200);
    await as(collector, 'post').send({ ...manifest, id: randomUUID(), size: 1 }).expect(200);
  }));
  it('checks stored bytes before linking a deduplicated blob', testService(async (service, c) => {
    const { Blob } = require('../../../lib/model/frames');
    const { collector, as, manifest, put } = await setup(service); const data = Buffer.from('original');
    const body = { ...manifest, size: data.length, sha256: hash(data) };
    const blobId = await c.Blobs.ensure(Blob.fromBuffer(data, manifest.contentType));
    // Simulate an existing blob whose indexed legacy hash no longer matches its bytes.
    await c.db.query(sql`UPDATE blobs SET content = ${sql.binary(Buffer.from('tampered'))} WHERE id = ${blobId}`);
    await as(collector, 'post').send(body).expect(200);
    await put(collector, body.id, 0, data).expect(200);
    await as(collector, 'post', `/${body.id}/complete`).expect(400);
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM submission_attachments WHERE "blobId" = ${blobId}`), 0);
  }));
});

describe('api: companion and native attachment concurrency', () => {
  it('keeps the native attachment intact when normal and resumable delivery overlap', testServiceFullTrx(async service => {
    const { alice, collector, as, manifest, put } = await setup(service); const data = Buffer.from('same-file');
    const body = { ...manifest, size: data.length, sha256: hash(data) };
    await as(collector, 'post').send(body).expect(200);
    await put(collector, body.id, 0, data).expect(200);
    const responses = await Promise.all([
      as(collector, 'post', `/${body.id}/complete`),
      service.post('/v1/projects/1/forms/binaryType/submissions/both/attachments/my_file1.mp4')
        .set('Authorization', `Bearer ${collector.token}`).set('Content-Type', 'video/mp4').send(data)
    ]);
    assert(responses.every(r => [200, 403, 409].includes(r.status)));
    assert(responses.some(r => r.status === 200));
    const response = await alice.get('/v1/projects/1/forms/binaryType/submissions/both/attachments/my_file1.mp4').expect(200);
    assert.equal(hash(response.body), body.sha256);
  }));
});

describe('api: OpenRosa multipart retry with companion recovery', () => {
  it('preserves the attachment when Collect resends the XML and media during companion completion', testServiceFullTrx(async service => {
    const { alice, collector, as, manifest, put } = await setup(service); const data = Buffer.from('same-native-file');
    const body = { ...manifest, size: data.length, sha256: hash(data) };
    await as(collector, 'post').send(body).expect(200);
    await put(collector, body.id, 0, data).expect(200);
    const [resumable, native] = await Promise.all([
      as(collector, 'post', `/${body.id}/complete`),
      service.post('/v1/projects/1/submission').set('Authorization', `Bearer ${collector.token}`).set('X-OpenRosa-Version', '1.0')
        .attach('xml_submission_file', Buffer.from(xml.instances.binaryType.both), { filename: 'data.xml' })
        .attach('my_file1.mp4', data, { filename: 'my_file1.mp4', contentType: 'video/mp4' })
    ]);
    assert.equal(native.status, 201); assert([200, 409].includes(resumable.status));
    const response = await alice.get('/v1/projects/1/forms/binaryType/submissions/both/attachments/my_file1.mp4').expect(200);
    assert.equal(hash(response.body), body.sha256);
  }));
});

const withCourierSigning = async action => {
  const { generateKeyPairSync } = require('node:crypto');
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const saved = { key: process.env.FIELD_DATA_OFFLINE_SIGNING_KEY, origin: process.env.FIELD_DATA_OFFLINE_ORIGIN };
  process.env.FIELD_DATA_OFFLINE_SIGNING_KEY = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }); process.env.FIELD_DATA_OFFLINE_ORIGIN = 'https://courier.example';
  try { await action(keys); } finally {
    for (const [name, value] of [['FIELD_DATA_OFFLINE_SIGNING_KEY', saved.key], ['FIELD_DATA_OFFLINE_ORIGIN', saved.origin]]) {
      if (value == null) delete process.env[name]; else process.env[name] = value;
    }
  }
};
describe('api: delegated media couriers', () => {
  it('delegates exact bytes without owner credentials, retains signed custody and verifies independent exports', testService(async (service, c) => withCourierSigning(async keys => {
    const { collector, other, as, manifest, data, put, alice } = await setup(service);
    await alice.delete(`/v1/projects/1/forms/binaryType/assignments/app-user/${other.id}`).expect(200);
    await as(collector, 'post').send(manifest).expect(200);
    const body = { requestId: randomUUID(), courierId: other.id, minutes: 60 };
    const path = `/${manifest.id}/courier`;
    const granted = (await as(collector, 'post', path).send(body).expect(200)).body;
    await as(collector, 'post', path).send(body).expect(200);
    await as(other, 'post', path).send({ ...body, requestId: randomUUID(), courierId: collector.id }).expect(404);
    const transfers = (await as(other, 'get').expect(200)).body.items; assert.equal(transfers.length, 1); assert.equal(transfers[0].ownerId, collector.id);
    await put(other, manifest.id, 0, data.subarray(0, CHUNK)).expect(200);
    await put(other, manifest.id, 0, data.subarray(0, CHUNK)).expect(200);
    await put(other, manifest.id, CHUNK, data.subarray(CHUNK)).expect(200);
    const signing = process.env.FIELD_DATA_OFFLINE_SIGNING_KEY; delete process.env.FIELD_DATA_OFFLINE_SIGNING_KEY;
    await as(other, 'post', `/${manifest.id}/complete`).expect(400); process.env.FIELD_DATA_OFFLINE_SIGNING_KEY = signing;
    await alice.get('/v1/projects/1/forms/binaryType/submissions/both/attachments/my_file1.mp4').expect(404);
    await as(other, 'post', `/${manifest.id}/complete`).expect(200);
    await as(other, 'post', `/${manifest.id}/complete`).expect(200);
    await as(collector, 'post', path).send(body).expect(200);
    const proof = (await as(other, 'get', path).expect(200)).body;
    // eslint-disable-next-line import/extensions, import/no-relative-packages
    const { verifyMediaCourierProof } = await import('../../../../../cloudflare/verify-media-courier.mjs');
    const expected = { issuer: 'https://courier.example', projectId: 1, publicKeys: [keys.publicKey.export({ format: 'jwk' })] };
    const checked = verifyMediaCourierProof(proof, expected); assert.equal(checked.events[0].receivedBy, other.id); assert.equal(checked.grant.ownerId, collector.id);
    assert.throws(() => verifyMediaCourierProof(proof, { ...expected, projectId: 2 }));
    assert.throws(() => verifyMediaCourierProof({ ...proof, grant: { ...proof.grant, manifest: { ...proof.grant.manifest, size: 1 } } }, expected));
    assert.equal(hash((await alice.get('/v1/projects/1/forms/binaryType/submissions/both/attachments/my_file1.mp4').expect(200)).body), manifest.sha256);
    await as(other, 'delete', `/${manifest.id}`).expect(404);
    const revoke = { requestId: randomUUID(), reason: 'The handoff has now completed.' };
    await as(collector, 'post', `${path}/revoke`).send(revoke).expect(200);
    await as(collector, 'post', `${path}/revoke`).send(revoke).expect(200);
    await as(other, 'get', `/${manifest.id}`).expect(404);
    const revoked = (await as(collector, 'get', path).expect(200)).body;
    assert.equal(verifyMediaCourierProof(revoked, expected).revocation, 'recorded');
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_media_courier_events WHERE "grantId"=${granted.grant.id}`), 2);
    await assert.rejects(c.db.query(sql`UPDATE field_data_media_courier_events SET details='{}'::jsonb WHERE "grantId"=${granted.grant.id}`));
  })));
  it('stops on revocation and source grants, preserves revocation without signing, and refuses expired or unrelated delegation', testService(async service => withCourierSigning(async () => {
    const { collector, other, as, manifest, data, put, alice } = await setup(service);
    await as(collector, 'post').send(manifest).expect(200);
    const path = `/${manifest.id}/courier`; const body = { requestId: randomUUID(), courierId: other.id, minutes: 5 };
    await as(collector, 'post', path).send({ ...body, courierId: collector.id }).expect(400);
    await as(collector, 'post', path).send({ ...body, minutes: 1441 }).expect(400);
    const project = (await alice.post('/v1/projects').send({ name: 'Other courier project' }).expect(200)).body;
    const stranger = (await alice.post(`/v1/projects/${project.id}/app-users`).send({ displayName: 'Other project courier' }).expect(200)).body;
    await as(collector, 'post', path).send({ ...body, courierId: stranger.id }).expect(400);
    await as(collector, 'post', path).send(body).expect(200);
    await as(collector, 'post', path).send({ ...body, requestId: randomUUID() }).expect(409);
    await alice.delete(`/v1/projects/1/forms/binaryType/assignments/app-user/${collector.id}`).expect(200);
    await put(other, manifest.id, 0, data.subarray(0, CHUNK)).expect(404);
    await as(other, 'get', path).expect(404);
    delete process.env.FIELD_DATA_OFFLINE_SIGNING_KEY;
    const revoke = (await as(collector, 'post', `${path}/revoke`).send({ requestId: randomUUID(), reason: 'Permission withdrawn while offline signing is unavailable.' }).expect(200)).body;
    assert.equal(revoke.event.attestation, null);
    await alice.post(`/v1/projects/1/forms/binaryType/assignments/app-user/${collector.id}`).expect(200);
    await as(other, 'get', `/${manifest.id}`).expect(404);
    assert.equal((await as(other, 'get').expect(200)).body.items.length, 0);
  })));
  it('enforces database expiry, signing availability and retains custody when temporary upload rows are cleaned', testServiceFullTrx(async (service, c) => withCourierSigning(async () => {
    const { collector, other, as, manifest, data, put } = await setup(service);
    await as(collector, 'post').send(manifest).expect(200);
    const path = `/${manifest.id}/courier`; const body = { requestId: randomUUID(), courierId: other.id, minutes: 5 };
    const signingKey = process.env.FIELD_DATA_OFFLINE_SIGNING_KEY; delete process.env.FIELD_DATA_OFFLINE_SIGNING_KEY;
    await as(collector, 'post', path).send(body).expect(400); process.env.FIELD_DATA_OFFLINE_SIGNING_KEY = signingKey;
    await as(collector, 'post', path).send(body).expect(200);
    await c.db.query(sql`UPDATE field_data_media_uploads SET "expiresAt"=clock_timestamp()-interval '1 second' WHERE id=${manifest.id}`);
    await put(other, manifest.id, 0, data.subarray(0, CHUNK)).expect(404);
    // Quota cleanup removes only expired temporary chunks/uploads, preserving the signed grant.
    await as(collector, 'post').send({ ...manifest, id: randomUUID() }).expect(200);
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_media_uploads WHERE id=${manifest.id}`), 0);
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_media_couriers WHERE "uploadId"=${manifest.id}`), 1);
    await as(collector, 'get', path).expect(200);
    await as(collector, 'post').send(manifest).expect(409);
    const migration = require('../../../lib/model/migrations/20261026-01-media-couriers');
    const { knexConnect } = require('../../../lib/model/knex-migrator'); const config = require('config'); const db = knexConnect(config.get('test.database'));
    try { await db.transaction(async trx => { await migration.down(trx); await migration.up(trx); }); } finally { await db.destroy(); }
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_media_couriers WHERE "uploadId"=${manifest.id}`), 1);
  })));
});

describe('api: courier concurrency', () => {
  it('serializes grant retries and revocation against native attachment completion', testServiceFullTrx(async (service, c) => withCourierSigning(async () => {
    const { collector, other, as, manifest, put } = await setup(service); const data = Buffer.from('courier-concurrency');
    const body = { ...manifest, size: data.length, sha256: hash(data) };
    await as(collector, 'post').send(body).expect(200);
    const path = `/${manifest.id}/courier`; const grant = { requestId: randomUUID(), courierId: other.id, minutes: 60 };
    const grants = await Promise.all([as(collector, 'post', path).send(grant), as(collector, 'post', path).send(grant)]);
    assert.deepEqual(grants.map(r => r.status), [200, 200]); assert.equal(grants[0].body.grant.id, grants[1].body.grant.id);
    await put(other, manifest.id, 0, data).expect(200);
    const results = await Promise.all([as(other, 'post', `/${manifest.id}/complete`), as(collector, 'post', `${path}/revoke`).send({ requestId: randomUUID(), reason: 'Revoke courier transport during final delivery.' })]);
    assert.equal(results[1].status, 200); assert([200, 404].includes(results[0].status));
    await as(other, 'get', `/${manifest.id}`).expect(404);
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_media_courier_events WHERE kind='delivery'`), results[0].status === 200 ? 1 : 0);
    await c.db.query(sql`DELETE FROM submissions WHERE "instanceId"='both'`);
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_media_couriers`), 0);
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_media_courier_events`), 0);
  })));
});

describe('api: courier grant expiry', () => {
  it('denies an expired signed grant even while its upload and original collection permission remain valid', testService(async (service, c) => withCourierSigning(async () => {
    const { collector, other, as, manifest, data, put } = await setup(service);
    await as(collector, 'post').send(manifest).expect(200);
    const courier = require('../../../lib/util/media-couriers'); const source = await c.db.one(sql`SELECT * FROM field_data_media_uploads WHERE id=${manifest.id}`);
    const id = randomUUID(); const expiresAt = new Date(Date.now() - 300000).toISOString();
    const details = { id, uploadId: manifest.id, projectId: source.projectId, submissionDefId: source.submissionDefId, ownerId: collector.id, courierId: other.id,
      manifest: source.manifest, issuedAt: new Date(Date.now() - 600000).toISOString(), expiresAt };
    // A retained historical grant fixture exercises database time independently of upload expiry.
    await c.db.query(sql`INSERT INTO field_data_media_couriers(id,"uploadId","projectId","submissionDefId","ownerId","courierId","requestId","requestHash","expiresAt",manifest,attestation)
      VALUES(${id},${manifest.id},${source.projectId},${source.submissionDefId},${collector.id},${other.id},${randomUUID()},${'a'.repeat(64)},${expiresAt},${JSON.stringify(source.manifest)},${JSON.stringify(courier.attest(courier.config(), 'grant', details))})`);
    await as(collector, 'get', `/${manifest.id}`).expect(200);
    await as(other, 'get', `/${manifest.id}`).expect(404);
    await put(other, manifest.id, 0, data.subarray(0, CHUNK)).expect(404);
    assert.equal((await as(other, 'get').expect(200)).body.items.length, 0);
  })));
});

const backgroundSetup = async service => {
  const fixture = await setup(service); await fixture.as(fixture.collector, 'post').send(fixture.manifest).expect(200);
  const { randomBytes } = require('node:crypto'); const token = randomBytes(32).toString('base64url');
  const body = { id: randomUUID(), uploadId: fixture.manifest.id, tokenHash: hash(token), expiresAt: new Date(Date.now() + 1800000).toISOString() };
  const backgroundRoot = '/v1/field-data/app-user/media-background';
  const bg = (actor, method, path = '') => service[method](backgroundRoot + path).set('Authorization', `Bearer ${actor.token}`);
  const cap = (method, path, value = token) => service[method](`${backgroundRoot}/${body.id}${path}`).set('X-Field-Data-Delivery-Token', value);
  const chunk = (offset, bytes, digest = hash(bytes)) => cap('put', `/chunks/${offset}`).set('Content-Type', 'application/octet-stream').set('X-Chunk-Sha256', digest).send(bytes);
  return { ...fixture, body, token, bg, cap, chunk };
};
describe('api: scoped background media delivery', () => {
  it('resumes exact chunks anonymously, records one native attachment and independently verifies the signed receipt', testService(async (service, c) => withCourierSigning(async keys => {
    const { collector, other, manifest, data, body, token, bg, cap, chunk } = await backgroundSetup(service);
    const issued = (await bg(collector, 'post').send(body).expect(200)).body; assert.equal(JSON.stringify(issued).includes(token), false);
    assert.equal((await bg(collector, 'post').send(body).expect(200)).body.authorization.id, body.id);
    await bg(other, 'get', `/${body.id}`).expect(404); await cap('get', '/progress', 'A'.repeat(43)).expect(404);
    await chunk(CHUNK, data.subarray(CHUNK)).expect(409); await chunk(0, data.subarray(0, CHUNK), 'f'.repeat(64)).expect(400);
    await chunk(0, data.subarray(0, CHUNK)).expect(200); await chunk(0, data.subarray(0, CHUNK)).expect(200);
    assert.equal((await cap('get', '/progress').expect(200)).body.transfer.offset, CHUNK);
    await cap('post', '/complete').expect(409); await chunk(CHUNK, data.subarray(CHUNK)).expect(200);
    const accepted = (await cap('post', '/complete').expect(200)).body; assert.equal((await cap('post', '/complete').expect(200)).body.events.length, 1);
    const receipt = accepted.events[0].details; assert.equal(receipt.ownerId, collector.id); assert.equal(receipt.receivedBy, collector.id); assert.equal(accepted.sourceAvailable, true);
    const stored = await c.db.one(sql`SELECT b.content,sa."blobId" FROM submission_attachments sa JOIN blobs b ON b.id=sa."blobId" WHERE sa."submissionDefId"=${receipt.submissionDefId} AND sa.name=${manifest.name}`); assert.equal(hash(stored.content), hash(data));
    const audit = await c.db.one(sql`SELECT "actorId",details FROM audits WHERE action='field_data.media.background.delivery' AND details->>'authorizationId'=${body.id}`); assert.equal(audit.actorId, null);
    // eslint-disable-next-line import/extensions, import/no-relative-packages
    const { verifyMediaBackgroundProof } = await import('../../../../../cloudflare/verify-media-background.mjs'); const pins = { issuer: 'https://courier.example', projectId: 1, publicKeys: [keys.publicKey.export({ format: 'jwk' })] };
    assert.equal((await verifyMediaBackgroundProof(accepted, pins)).delivery.sha256, hash(data));
    const swapped = JSON.parse(JSON.stringify(accepted)); swapped.authorization.senderId = other.id; await assert.rejects(verifyMediaBackgroundProof(swapped, pins)); await assert.rejects(verifyMediaBackgroundProof(accepted, { ...pins, projectId: 2 }));
    await assert.rejects(verifyMediaBackgroundProof({ ...accepted, events: [...accepted.events, { authorizationId: body.id, kind: 'revoke', attestation: null }] }, pins));
    await c.db.query(sql`DELETE FROM submissions WHERE "instanceId"='both'`); assert.equal((await bg(collector, 'get', `/${body.id}`).expect(200)).body.sourceAvailable, false); await cap('post', '/complete').expect(404);
  })));
  it('continues an existing named courier grant without collection rights and binds both custody chains', testService(async (service, c) => withCourierSigning(async keys => {
    const { alice, collector, other, as, manifest, data, body, bg, cap, chunk } = await backgroundSetup(service);
    await alice.delete(`/v1/projects/1/forms/binaryType/assignments/app-user/${other.id}`).expect(200);
    const granted = (await as(collector, 'post', `/${manifest.id}/courier`).send({ requestId: randomUUID(), courierId: other.id, minutes: 60 }).expect(200)).body;
    const issued = (await bg(other, 'post').send(body).expect(200)).body; assert.equal(issued.authorization.ownerId, collector.id); assert.equal(issued.authorization.senderId, other.id); assert.equal(issued.authorization.courierGrantId, granted.grant.id);
    await chunk(0, data.subarray(0, CHUNK)).expect(200); await chunk(CHUNK, data.subarray(CHUNK)).expect(200); const accepted = (await cap('post', '/complete').expect(200)).body;
    assert.equal(accepted.courier.events[0].details.receivedBy, other.id); assert.equal(accepted.courier.events[0].details.backgroundAuthorizationId, body.id);
    assert.equal(await c.db.oneFirst(sql`SELECT "submitterId" FROM submission_defs WHERE id=${accepted.events[0].details.submissionDefId}`), collector.id);
    // eslint-disable-next-line import/extensions, import/no-relative-packages
    const { verifyMediaBackgroundProof } = await import('../../../../../cloudflare/verify-media-background.mjs'); assert.equal((await verifyMediaBackgroundProof(accepted, { issuer: 'https://courier.example', projectId: 1, publicKeys: [keys.publicKey.export({ format: 'jwk' })] })).delivery.receivedBy, other.id);
  })));
  it('stops a delegated token immediately on original collector revocation and permits either participant to cancel the browser continuation', testService(async service => withCourierSigning(async () => {
    const { collector, other, as, manifest, data, body, bg, cap, chunk } = await backgroundSetup(service);
    await as(collector, 'post', `/${manifest.id}/courier`).send({ requestId: randomUUID(), courierId: other.id, minutes: 60 }).expect(200); await bg(other, 'post').send(body).expect(200);
    await chunk(0, data.subarray(0, CHUNK)).expect(200);
    await as(collector, 'post', `/${manifest.id}/courier/revoke`).send({ requestId: randomUUID(), reason: 'Collector withdrew the original transport permission.' }).expect(200);
    await cap('get', '/progress').expect(404); await chunk(CHUNK, data.subarray(CHUNK)).expect(404); await cap('post', '/complete').expect(404);
    await bg(other, 'post', `/${body.id}/revoke`).send({ requestId: randomUUID(), reason: 'Courier stopped this separately authorized browser copy.' }).expect(200);
    const checked = (await bg(collector, 'get', `/${body.id}`).expect(200)).body; assert.equal(checked.events[0].kind, 'revoke'); assert.equal(checked.courier.events[0].kind, 'revoke');
  })));
  it('enforces live source permissions, absolute expiry, cancellation and immutable authorization retries', testService(async service => withCourierSigning(async () => {
    const { alice, collector, data, body, token, bg, cap, chunk } = await backgroundSetup(service); await bg(collector, 'post').send(body).expect(200);
    await bg(collector, 'post').send({ ...body, tokenHash: 'a'.repeat(64) }).expect(409);
    await alice.delete(`/v1/projects/1/forms/binaryType/assignments/app-user/${collector.id}`).expect(200); await chunk(0, data.subarray(0, CHUNK)).expect(404);
    await alice.post(`/v1/projects/1/forms/binaryType/assignments/app-user/${collector.id}`).expect(200);
    const revoked = (await bg(collector, 'post', `/${body.id}/revoke`).send({ requestId: randomUUID(), reason: 'Stop this exact background file authorization.' }).expect(200)).body.event;
    const retried = (await bg(collector, 'post', `/${body.id}/revoke`).send({ requestId: randomUUID(), reason: 'Confirm cancellation after its first response was lost.' }).expect(200)).body.event; assert.equal(retried.id, revoked.id); assert.equal(retried.details.reason, revoked.details.reason); await cap('get', '/progress').expect(404);
    const replacement = { ...body, id: randomUUID(), expiresAt: new Date(Date.now() + 2000).toISOString() }; await bg(collector, 'post').send(replacement).expect(200);
    await new Promise(resolve => { setTimeout(resolve, 2100); }); await service.get(`/v1/field-data/app-user/media-background/${replacement.id}/progress`).set('X-Field-Data-Delivery-Token', token).expect(404);
  })));
  it('serializes foreground completion and capability completion and retains populated history on rollback', testServiceFullTrx(async (service, c) => withCourierSigning(async () => {
    const { collector, as, manifest, data, body, bg, cap, chunk } = await backgroundSetup(service); await bg(collector, 'post').send(body).expect(200);
    await chunk(0, data.subarray(0, CHUNK)).expect(200); await chunk(CHUNK, data.subarray(CHUNK)).expect(200);
    const results = await Promise.all([as(collector, 'post', `/${manifest.id}/complete`), cap('post', '/complete'), cap('post', '/complete')]); assert.deepEqual(results.map(value => value.status), [200, 200, 200]);
    assert.equal((await bg(collector, 'get', `/${body.id}`).expect(200)).body.events.length, 1);
    const { knexConnect } = require('../../../lib/model/knex-migrator'); const migration = require('../../../lib/model/migrations/20261103-02-background-media'); const db = knexConnect(require('config').get('test.database'));
    try { await db.transaction(async trx => { await migration.down(trx); await migration.up(trx); }); } finally { await db.destroy(); }
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_media_background WHERE id=${body.id}`), 1); await assert.rejects(c.db.query(sql`DELETE FROM field_data_media_background WHERE id=${body.id}`));
  })));
});


describe('api: background media target boundaries', () => {
  it('cannot resurrect a cancelled transfer through its old capability or authorize challenged captures', testService(async service => withCourierSigning(async () => {
    const { collector, as, manifest, body, bg, cap } = await backgroundSetup(service); await bg(collector, 'post').send(body).expect(200);
    await as(collector, 'delete', `/${manifest.id}`).expect(200); await cap('get', '/progress').expect(404); await as(collector, 'post').send(manifest).expect(409);
    const camera = { ...manifest, id: randomUUID(), contentType: 'image/jpeg', challengeId: randomUUID(), challengeNonce: 'a'.repeat(64) }; await as(collector, 'post').send(camera).expect(200);
    await bg(collector, 'post').send({ ...body, id: randomUUID(), uploadId: camera.id }).expect(404);
  })));
});

const handoffSetup = async service => {
  const fixture = await setup(service); const source = Buffer.from(xml.instances.binaryType.both); const first = Buffer.from('Collect video bytes'); const second = Buffer.from([0, 255, 128, 4]);
  const send = () => service.post('/v1/projects/1/submission').set('Authorization', `Bearer ${fixture.collector.token}`).set('X-OpenRosa-Version', '1.0').attach('xml_submission_file', source, { filename: 'instance.xml' })
    .attach('my_file1.mp4', first, { filename: 'my_file1.mp4' })
    .attach('here_is_file2.jpg', second, { filename: 'here_is_file2.jpg' });
  const manifest = { xmlFormId: 'binaryType', instanceId: 'both', version: '', xml: { size: source.length, sha256: hash(source) }, files: [{ name: 'here_is_file2.jpg', size: second.length, sha256: hash(second) }, { name: 'my_file1.mp4', size: first.length, sha256: hash(first) }] };
  const verify = (actor = fixture.collector, data = manifest) => service.post('/v1/field-data/app-user/collect-handoffs/verify').set('Authorization', `Bearer ${actor.token}`).send(data);
  return { ...fixture, source, first, second, send, manifest, verify };
};
describe('api: native Collect handoff verification', () => {
  it('verifies exact multipart XML and all stored files with collector ownership and independently pinned snapshots', testService(async (service, c) => withCourierSigning(async keys => {
    const { collector, other, source, first, send, manifest, verify } = await handoffSetup(service);
    await verify().expect(409); await send().expect(201); await send().expect(201);
    const result = await verify().expect(200); assert.equal(result.headers['cache-control'], 'private, no-store');
    // eslint-disable-next-line import/extensions, import/no-relative-packages
    const { verifyCollectHandoffSnapshot } = await import('../../../../../cloudflare/verify-collect-handoff.mjs'); const pins = { issuer: 'https://courier.example', projectId: 1, ownerId: collector.id, publicKeys: [keys.publicKey.export({ format: 'jwk' })], manifest };
    const checked = verifyCollectHandoffSnapshot(result.body.snapshot, pins); assert.equal(checked.manifest.xml.sha256, hash(source)); assert.equal(checked.manifest.files[1].sha256, hash(first));
    assert.throws(() => verifyCollectHandoffSnapshot(result.body.snapshot, { ...pins, ownerId: other.id })); assert.throws(() => verifyCollectHandoffSnapshot(result.body.snapshot, { ...pins, manifest: { ...manifest, files: [] } }));
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM submissions WHERE "instanceId"='both'`), 1); assert.equal(await c.db.oneFirst(sql`SELECT "submitterId" FROM submission_defs WHERE id=${checked.submissionDefId}`), collector.id);
    await verify(other).expect(404); await verify(collector, { ...manifest, xml: { ...manifest.xml, sha256: 'a'.repeat(64) } }).expect(409); await verify(collector, { ...manifest, files: [] }).expect(409);
    await c.db.query(sql`DELETE FROM submissions WHERE "instanceId"='both'`); await verify().expect(404); assert.equal(verifyCollectHandoffSnapshot(result.body.snapshot, pins).submissionDefId, checked.submissionDefId);
  })));
  it('rejects missing, changed, oversized or unrelated files and current collection permission loss', testService(async service => withCourierSigning(async () => {
    const { alice, collector, send, manifest, verify } = await handoffSetup(service); await send().expect(201);
    await verify(collector, { ...manifest, files: manifest.files.map(f => ({ ...f, sha256: 'b'.repeat(64) })) }).expect(409);
    await verify(collector, { ...manifest, files: [...manifest.files, manifest.files[0]] }).expect(400);
    await verify(collector, { ...manifest, instanceId: 'both\u0000' }).expect(400);
    await verify(collector, { ...manifest, files: [{ name: '../file', size: 1, sha256: 'a'.repeat(64) }] }).expect(400);
    await verify(collector, { ...manifest, files: [{ ...manifest.files[0], size: 20971521 }] }).expect(400);
    await alice.delete(`/v1/projects/1/forms/binaryType/assignments/app-user/${collector.id}`).expect(200); await verify().expect(404);
  })));
  it('verifies encrypted native envelope ciphertext without decrypting or claiming Collect send status', testService(async service => withCourierSigning(async keys => {
    const alice = await service.login('alice'); const collector = (await alice.post('/v1/projects/1/app-users').send({ displayName: 'Encrypted Collect owner' }).expect(200)).body; await alice.post(`/v1/projects/1/forms/simple/assignments/app-user/${collector.id}`).expect(200);
    const source = Buffer.from('<data id="simple"><base64EncryptedKey>a2V5</base64EncryptedKey><encryptedXmlFile>submission.xml.enc</encryptedXmlFile><base64EncryptedElementSignature>c2ln</base64EncryptedElementSignature><meta><instanceID>collect-native-sealed</instanceID></meta></data>'); const ciphertext = Buffer.from([0, 255, 128, 17]);
    await service.post('/v1/projects/1/submission').set('Authorization', `Bearer ${collector.token}`).set('X-OpenRosa-Version', '1.0').attach('xml_submission_file', source, { filename: 'submission.xml' })
      .attach('submission.xml.enc', ciphertext, { filename: 'submission.xml.enc' })
      .expect(201);
    const manifest = { xmlFormId: 'simple', instanceId: 'collect-native-sealed', version: '', xml: { size: source.length, sha256: hash(source) }, files: [{ name: 'submission.xml.enc', size: ciphertext.length, sha256: hash(ciphertext) }] };
    const response = await service.post('/v1/field-data/app-user/collect-handoffs/verify').set('Authorization', `Bearer ${collector.token}`).send(manifest).expect(200);
    // eslint-disable-next-line import/extensions, import/no-relative-packages
    const { verifyCollectHandoffSnapshot } = await import('../../../../../cloudflare/verify-collect-handoff.mjs'); const result = verifyCollectHandoffSnapshot(response.body.snapshot, { issuer: 'https://courier.example', projectId: 1, ownerId: collector.id, publicKeys: [keys.publicKey.export({ format: 'jwk' })] }); assert.equal(result.manifest.files[0].sha256, hash(ciphertext)); assert.equal(Object.hasOwn(result, 'collectSendStatus'), false);
  })));
});

describe('api: Collect snapshot object storage', () => {
  it('hashes object-storage streams and rejects extra bytes without buffering an oversized object', require('../setup').testServiceWith({ s3: { enabled: true, pipeContent: async () => { throw new Error('Test stream not set'); } } }, async (service, c) => withCourierSigning(async () => {
    const { Readable } = require('node:stream'); const { PartialPipe } = require('../../../lib/util/stream');
    const { send, first, second, verify } = await handoffSetup(service); await send().expect(201);
    const streams = new Map([[createHash('sha1').update(first).digest('hex'), first], [createHash('sha1').update(second).digest('hex'), second]]);
    await c.db.query(sql`UPDATE blobs SET s3_status='uploaded',content=NULL WHERE id IN (SELECT "blobId" FROM submission_attachments)`);
    const storage = c.s3; storage.pipeContent = async blob => PartialPipe.of(Readable.from([streams.get(blob.sha)])); await verify().expect(200);
    storage.pipeContent = async blob => PartialPipe.of(Readable.from([streams.get(blob.sha), Buffer.from('extra bytes')])); await verify().expect(409);
  })));
});

describe('api: Collect server delivery inventory', () => {
  const list = (service, user, suffix = '') => service.get(`/v1/field-data/app-user/collect-delivery${suffix}`).set('Authorization', `Bearer ${user.token}`);
  it('reports missing and recorded native attachments without returning answers or claiming byte verification', testService(async service => {
    const { collector, other, send } = await handoffSetup(service);
    const before = await list(service, collector).expect(200);
    assert.equal(before.headers['cache-control'], 'private, no-store');
    assert.equal(before.body.actorId, collector.id); assert.equal(before.body.projectId, 1);
    assert.equal(before.body.items.length, 1);
    assert.equal(before.body.items[0].expectedFiles, 2); assert.equal(before.body.items[0].recordedFiles, 0);
    assert.deepEqual(before.body.items[0].missingFiles, ['here_is_file2.jpg', 'my_file1.mp4']);
    assert.equal(Object.hasOwn(before.body.items[0], 'xml'), false); assert.equal(Object.hasOwn(before.body.items[0], 'verified'), false);
    assert.deepEqual((await list(service, other).expect(200)).body.items, []);
    await service.get('/v1/field-data/app-user/collect-delivery').expect(401);
    await send().expect(201);
    const after = (await list(service, collector).expect(200)).body.items[0];
    assert.equal(after.recordedFiles, 2); assert.deepEqual(after.missingFiles, []);
  }));
  it('keeps closed-form receipts visible but excludes removed grants, deleted submissions and changed current owners', testService(async (service, c) => {
    const { alice, collector, other } = await setup(service);
    await c.db.query(sql`UPDATE forms SET state='closed' WHERE "xmlFormId"='binaryType'`);
    assert.equal((await list(service, collector).expect(200)).body.items[0].formState, 'closed');
    await c.db.query(sql`UPDATE submission_defs SET "submitterId"=${other.id} WHERE "instanceId"='both' AND current`);
    assert.deepEqual((await list(service, collector).expect(200)).body.items, []);
    await c.db.query(sql`UPDATE submission_defs SET "submitterId"=${collector.id} WHERE "instanceId"='both' AND current`);
    await c.db.query(sql`UPDATE submissions SET "deletedAt"=clock_timestamp() WHERE "instanceId"='both'`);
    assert.deepEqual((await list(service, collector).expect(200)).body.items, []);
    await c.db.query(sql`UPDATE submissions SET "deletedAt"=NULL WHERE "instanceId"='both'`);
    await alice.delete(`/v1/projects/1/forms/binaryType/assignments/app-user/${collector.id}`).expect(200);
    assert.deepEqual((await list(service, collector).expect(200)).body.items, []);
  }));
  it('supports XML-only submissions, bounds missing filenames and refuses archived projects and manager accounts', testService(async (service, c) => {
    const { alice, collector } = await setup(service);
    await alice.post(`/v1/projects/1/forms/simple/assignments/app-user/${collector.id}`).expect(200);
    await service.post('/v1/projects/1/forms/simple/submissions').set('Authorization', `Bearer ${collector.token}`).set('Content-Type', 'application/xml').send(xml.instances.simple.one)
      .expect(200);
    const definitionId = await c.db.oneFirst(sql`SELECT id FROM submission_defs WHERE "instanceId"='both' AND current`);
    for (let i = 0; i < 12; i += 1) await c.db.query(sql`INSERT INTO submission_attachments ("submissionDefId",name,"blobId") VALUES (${definitionId},${`extra-${i}.jpg`},NULL)`);
    const result = (await list(service, collector).expect(200)).body;
    const onlyXml = result.items.find(entry => entry.xmlFormId === 'simple');
    assert.equal(onlyXml.expectedFiles, 0); assert.equal(onlyXml.recordedFiles, 0); assert.deepEqual(onlyXml.missingFiles, []);
    const files = result.items.find(entry => entry.xmlFormId === 'binaryType');
    assert.equal(files.expectedFiles, 14); assert.equal(files.missingFiles.length, 10);
    await alice.get('/v1/field-data/app-user/collect-delivery').expect(403);
    await c.db.query(sql`UPDATE projects SET archived=TRUE WHERE id=1`);
    await list(service, collector).expect(404);
  }));
  it('paginates own current submissions without duplicates and rejects invalid cursors', testService(async service => {
    const { collector } = await setup(service);
    for (let i = 0; i < 21; i += 1) await service.post('/v1/projects/1/forms/binaryType/submissions').set('Authorization', `Bearer ${collector.token}`).set('Content-Type', 'application/xml').send(xml.instances.binaryType.both.replace('>both<', `>delivery-${i}<`))
      .expect(200);
    const first = (await list(service, collector).expect(200)).body;
    assert.equal(first.items.length, 20); assert.ok(first.nextCursor);
    const second = (await list(service, collector, `?cursor=${first.nextCursor}`).expect(200)).body;
    assert.equal(second.items.length, 2); assert.equal(second.nextCursor, null);
    assert.equal(new Set([...first.items, ...second.items].map(item => item.submissionDefId)).size, 22);
    for (const cursor of ['0', '-1', '2147483648', '1e2', 'abc', '1&cursor=2']) await list(service, collector, `?cursor=${cursor}`).expect(400);
  }));
});
