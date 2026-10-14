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
