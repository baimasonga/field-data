/* eslint-disable no-await-in-loop */
// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { sql } = require('slonik');
const { testService, testServiceFullTrx } = require('../setup');
const xml = require('../../data/xml');
const root = '/v1/projects/1/forms/binaryType/submissions/both';
const path = `${root}/media-extractions`; const name = 'here_is_file2.jpg';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yX3cAAAAASUVORK5CYII=', 'base64');
const request = () => ({ requestId: randomUUID(), name, allowExternalProcessing: true });
const review = (revision = 0, patch = {}) => ({ requestId: randomUUID(), revision, action: 'approve', text: 'Reviewed pump label 1234', reason: 'Checked the label against the original photo.', reviewedOriginal: true, ...patch });
const photo = text => Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
const setup = async service => {
  const alice = await service.login('alice');
  await alice.post('/v1/projects/1/forms?publish=true').set('Content-Type', 'application/xml').send(xml.forms.binaryType).expect(200);
  await alice.post('/v1/projects/1/forms/binaryType/submissions').set('Content-Type', 'application/xml').send(xml.instances.binaryType.both).expect(200);
  await alice.post(`${root}/attachments/${name}`).set('Content-Type', 'image/png').send(png).expect(200); return alice;
};
describe('api: reviewed media extraction', () => {
  const originalFetch = global.fetch; const saved = {};
  beforeEach(() => {
    for (const key of ['FIELD_DATA_EXTRACTION_ENABLED', 'FIELD_DATA_OPENAI_API_KEY']) { saved[key] = process.env[key]; process.env[key] = key.endsWith('ENABLED') ? 'true' : 'fixture-only-key'; }
    global.fetch = async () => photo('Pump label 12?4');
  });
  afterEach(() => {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(saved)) { if (value == null) delete process.env[key]; else process.env[key] = value; }
  });
  it('extracts exact bytes once and retains corrected approval/rejection history without altering answers', testService(async (service, c) => {
    const alice = await setup(service); let calls = 0;
    global.fetch = async (url, init) => {
      calls += 1; assert.equal(url, 'https://api.openai.com/v1/responses'); const wire = JSON.parse(init.body);
      assert.equal(wire.store, false); assert.equal(wire.input[0].content[0].image_url, `data:image/png;base64,${png.toString('base64')}`);
      assert.equal(init.body.includes(name), false); return photo('Pump label 12?4');
    };
    const beforeXml = await c.db.oneFirst(sql`SELECT xml FROM submission_defs WHERE current AND "submissionId" = (SELECT id FROM submissions WHERE "instanceId" = 'both')`);
    assert.equal((await alice.get(path).expect(200)).body.media[0].name, name);
    const body = request(); const created = await alice.post(path).send(body).expect(200); const { item } = created.body;
    assert.equal(item.status, 'ready'); assert.equal(item.bindingCurrent, true); assert.equal(item.decision, 'unreviewed');
    assert.equal(item.contentHash, createHash('sha256').update(png).digest('hex')); assert.equal(created.headers['cache-control'], 'private, no-store');
    await alice.post(path).send(body).expect(200); assert.equal(calls, 1); await alice.post(path).send({ ...body, name: 'my_file1.mp4' }).expect(409);
    const url = `${path}/${item.id}/reviews`; const approved = review();
    let changed = (await alice.post(url).send(approved).expect(200)).body.item;
    assert.equal(changed.reviews[0].text, approved.text); assert.equal(changed.proposal, 'Pump label 12?4');
    await alice.post(url).send(review()).expect(409);
    changed = (await alice.post(url).send(review(1, { action: 'reject', text: null })).expect(200)).body.item;
    assert.equal(changed.decision, 'reject'); assert.equal(changed.reviews.length, 2);
    assert.equal((await alice.post(url).send(approved).expect(200)).body.item.decision, 'reject');
    await alice.post(url).send({ ...approved, text: 'Changed retry' }).expect(409);
    assert.deepEqual((await alice.get(`${path}/${item.id}/source`).expect(200)).body, png);
    assert.equal(await c.db.oneFirst(sql`SELECT xml FROM submission_defs WHERE current AND "submissionId" = (SELECT id FROM submissions WHERE "instanceId" = 'both')`), beforeXml);
    const logs = JSON.stringify(await c.db.any(sql`SELECT details FROM audits WHERE action LIKE 'field_data.media.extraction.%'`));
    for (const secret of ['Pump label', 'Reviewed pump', 'fixture-only-key']) assert.equal(logs.includes(secret), false);
  }));
  it('marks replaced media outdated, preserves the original and permits historical rejection after archival', testService(async (service, c) => {
    const alice = await setup(service); const { item } = (await alice.post(path).send(request()).expect(200)).body; const url = `${path}/${item.id}`;
    await alice.post(`${url}/reviews`).send(review()).expect(200);
    await alice.post(`${root}/attachments/${name}`).set('Content-Type', 'image/png').send(Buffer.concat([png, Buffer.from('replacement')])).expect(200);
    const current = (await alice.get(path).expect(200)).body.items[0]; assert.equal(current.bindingCurrent, false); assert.equal(current.decision, 'outdated');
    assert.deepEqual((await alice.get(`${url}/source`).expect(200)).body, png); await alice.post(`${url}/reviews`).send(review(1)).expect(409);
    await c.db.query(sql`UPDATE projects SET archived = TRUE WHERE id = 1`); await alice.post(path).send(request()).expect(409);
    await alice.post(`${url}/reviews`).send(review(1, { action: 'reject', text: null })).expect(200);
    assert.equal((await alice.get(path).expect(200)).body.canRequest, false);
  }));
  it('allows viewer history but checks managers, App Users, revoked rights, scope and deletion', testService(async service => {
    const alice = await setup(service); const { item } = (await alice.post(path).send(request()).expect(200)).body; const url = `${path}/${item.id}`;
    const viewer = await service.login('chelsea'); const { id } = (await viewer.get('/v1/users/current').expect(200)).body;
    await viewer.get(path).expect(404); await alice.post(`/v1/projects/1/assignments/viewer/${id}`).expect(200);
    const list = (await viewer.get(path).expect(200)).body; assert.equal(list.canRequest, false); assert.equal(list.canReview, false);
    await viewer.get(`${url}/source`).expect(200); await viewer.post(path).send(request()).expect(404); await viewer.post(`${url}/reviews`).send(review()).expect(404);
    const collector = (await alice.post('/v1/projects/1/app-users').send({ displayName: 'Collector' }).expect(200)).body;
    await alice.post(`/v1/projects/1/forms/binaryType/assignments/app-user/${collector.id}`).expect(200);
    await service.post(path).set('Authorization', `Bearer ${collector.token}`).send(request()).expect(404);
    await service.get(path).expect(401); await alice.get(`${url.replace('/both/', '/missing/')}/source`).expect(404);
    await alice.delete(`/v1/projects/1/assignments/viewer/${id}`).expect(200); await viewer.get(path).expect(404); await viewer.get(`${url}/source`).expect(404);
    await alice.delete(root).expect(200); await alice.get(path).expect(404); await alice.post(`${url}/reviews`).send(review()).expect(404);
  }));
  it('requires provider configuration/consent and rejects malformed requests, bytes and reviews', testService(async service => {
    const alice = await setup(service); let calls = 0; global.fetch = async () => { calls += 1; return photo('Text'); };
    delete process.env.FIELD_DATA_EXTRACTION_ENABLED;
    assert.equal((await alice.get(path).expect(200)).body.enabled, false); await alice.post(path).send(request()).expect(501);
    process.env.FIELD_DATA_EXTRACTION_ENABLED = 'true';
    for (const patch of [{ allowExternalProcessing: false }, { model: 'custom' }, { name: '../image' }, { requestId: 'bad' }]) await alice.post(path).send({ ...request(), ...patch }).expect(400);
    await alice.post(path).send({ ...request(), name: 'missing' }).expect(404);
    await alice.post(`${root}/attachments/${name}`).set('Content-Type', 'image/png').send(Buffer.from('Not a PNG')).expect(200);
    await alice.post(path).send(request()).expect(400); assert.equal(calls, 0);
    await alice.post(`${root}/attachments/${name}`).set('Content-Type', 'image/png').send(png).expect(200);
    const { item } = (await alice.post(path).send(request()).expect(200)).body;
    for (const patch of [{ reviewedOriginal: false }, { reason: 'short' }, { action: 'reject' }, { text: ' ' }, { unknown: true }, { revision: -1 }])
      await alice.post(`${path}/${item.id}/reviews`).send(review(0, patch)).expect(400);
  }));
  it('persists provider failures without exposing raw errors or retrying media', testService(async service => {
    const alice = await setup(service); let calls = 0; global.fetch = async () => { calls += 1; return new Response('private provider error', { status: 429 }); };
    const body = request(); const { item } = (await alice.post(path).send(body).expect(200)).body;
    assert.equal(item.status, 'failed'); assert.equal(item.failure, 'provider-error'); assert.equal(item.proposal, null);
    delete process.env.FIELD_DATA_EXTRACTION_ENABLED; await alice.post(path).send(body).expect(200); assert.equal(calls, 1);
    await alice.post(`${path}/${item.id}/reviews`).send(review()).expect(409);
  }));
  it('transcribes WAV audio using a generic multipart filename and supports correction', testService(async service => {
    const alice = await setup(service); const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt '), Buffer.alloc(32)]);
    await alice.post(`${root}/attachments/my_file1.mp4`).set('Content-Type', 'audio/wav').send(wav).expect(200);
    global.fetch = async (url, init) => {
      assert.equal(url, 'https://api.openai.com/v1/audio/transcriptions'); assert.equal(init.body.get('file').name, 'recording.wav');
      assert.deepEqual(Buffer.from(await init.body.get('file').arrayBuffer()), wav); return Response.json({ text: 'Original language transcript' });
    };
    const { item } = (await alice.post(path).send({ ...request(), name: 'my_file1.mp4' }).expect(200)).body;
    assert.equal(item.kind, 'audio'); assert.equal(item.proposal, 'Original language transcript');
    await alice.post(`${path}/${item.id}/reviews`).send(review(0, { text: 'Corrected transcript' })).expect(200);
  }));
  it('preserves immutable history on rollback and original bytes during garbage collection, while allowing source purge', testService(async (service, c) => {
    const alice = await setup(service); const { item } = (await alice.post(path).send(request()).expect(200)).body;
    await alice.post(`${path}/${item.id}/reviews`).send(review()).expect(200);
    for (const statement of [sql`UPDATE field_data_media_extractions SET proposal = 'tampered' WHERE id = ${item.id}`,
      sql`DELETE FROM field_data_media_extractions WHERE id = ${item.id}`, sql`UPDATE field_data_media_extraction_reviews SET text = 'tampered' WHERE "extractionId" = ${item.id}`,
      sql`DELETE FROM field_data_media_extraction_reviews WHERE "extractionId" = ${item.id}`]) {
      await c.db.query(sql`SAVEPOINT immutable_check`); await assert.rejects(c.db.query(statement));
      await c.db.query(sql`ROLLBACK TO SAVEPOINT immutable_check`); await c.db.query(sql`RELEASE SAVEPOINT immutable_check`);
    }
    const migration = require('../../../lib/model/migrations/20261016-02-media-extractions');
    const adapter = { raw: value => c.db.query(sql([value])) }; await migration.down(adapter); await migration.up(adapter);
    await alice.post(`${root}/attachments/${name}`).set('Content-Type', 'image/png').send(Buffer.concat([png, Buffer.from('new')])).expect(200);
    await c.Blobs._purgeAllUnattached(); assert.deepEqual((await alice.get(`${path}/${item.id}/source`).expect(200)).body, png);
    await c.db.query(sql`DELETE FROM submission_defs WHERE id = ${item.submissionDefId}`);
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_media_extractions`), 0);
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_media_extraction_reviews`), 0);
  }));
  it('limits attempts/reviews and reports old processing requests as interrupted without resending', testService(async (service, c) => {
    const alice = await setup(service); const { item } = (await alice.post(path).send(request()).expect(200)).body;
    for (let i = 0; i < 20; i += 1) await alice.post(`${path}/${item.id}/reviews`).send(review(i)).expect(200);
    await alice.post(`${path}/${item.id}/reviews`).send(review(20)).expect(409);
    const retry = request();
    await c.db.query(sql`INSERT INTO field_data_media_extractions (id, "submissionDefId", name, "blobId", "contentHash", "contentType", kind, model, "requestId", "requestHash", "actorId", "actorName", "requestedAt")
      SELECT ${randomUUID()}, "submissionDefId", name, "blobId", "contentHash", "contentType", kind, model, ${retry.requestId}, "requestHash", "actorId", "actorName", clock_timestamp() - interval '3 minutes' FROM field_data_media_extractions WHERE id = ${item.id}`);
    let calls = 0; global.fetch = async () => { calls += 1; return photo('Text'); };
    assert.equal((await alice.post(path).send(retry).expect(200)).body.item.status, 'interrupted'); assert.equal(calls, 0);
    await c.db.query(sql`INSERT INTO field_data_media_extractions (id, "submissionDefId", name, "blobId", "contentHash", "contentType", kind, model, "requestId", "requestHash", "actorId", "actorName")
      SELECT gen_random_uuid(), "submissionDefId", name, "blobId", "contentHash", "contentType", kind, model, gen_random_uuid(), "requestHash", "actorId", "actorName"
      FROM field_data_media_extractions CROSS JOIN generate_series(1,18) WHERE id = ${item.id}`);
    await alice.post(path).send(request()).expect(409); assert.equal((await alice.get(path).expect(200)).body.canRequest, false);
  }));
  it('discards provider output if write access is revoked during extraction', testService(async (service, c) => {
    const alice = await setup(service); const manager = await service.login('chelsea'); const { id } = (await manager.get('/v1/users/current').expect(200)).body;
    await alice.post(`/v1/projects/1/assignments/manager/${id}`).expect(200);
    global.fetch = async () => {
      await alice.delete(`/v1/projects/1/assignments/manager/${id}`).expect(200); return photo('Do not retain revoked output');
    };
    await manager.post(path).send(request()).expect(404);
    const row = await c.db.one(sql`SELECT status, proposal FROM field_data_media_extractions`);
    assert.equal(row.status, 'processing'); assert.equal(row.proposal, null);
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM audits WHERE action = 'field_data.media.extraction.finished'`), 0);
  }));
  it('keeps superseded source history while requiring a fresh extraction for new approval', testService(async service => {
    const alice = await setup(service); const { item } = (await alice.post(path).send(request()).expect(200)).body;
    await alice.post('/v1/projects/1/submission').set('X-OpenRosa-Version', '1.0')
      .attach('xml_submission_file', Buffer.from(xml.instances.binaryType.both.replace('<instanceID>both', '<deprecatedID>both</deprecatedID><instanceID>both2')), { filename: 'data.xml' }).expect(201);
    const state = (await alice.get(path).expect(200)).body.items[0]; assert.equal(state.bindingCurrent, false);
    await alice.post(`${path}/${item.id}/reviews`).send(review()).expect(409);
    assert.deepEqual((await alice.get(`${path}/${item.id}/source`).expect(200)).body, png);
  }));
  it('reserves concurrent identical requests once and serializes competing reviews', testServiceFullTrx(async service => {
    const alice = await setup(service); const body = request(); let calls = 0;
    global.fetch = async () => { calls += 1; return photo('Source text'); };
    const results = await Promise.all([alice.post(path).send(body).expect(200), alice.post(path).send(body).expect(200)]);
    assert.equal(calls, 1); assert.equal(results[0].body.item.id, results[1].body.item.id); const url = `${path}/${results[0].body.item.id}/reviews`;
    const changes = await Promise.all([alice.post(url).send(review()), alice.post(url).send(review())]); assert.deepEqual(changes.map(r => r.status).sort(), [200, 409]);
  }));
});
