/* eslint-disable no-await-in-loop */
// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const assert = require('node:assert/strict');
const { createHash, randomUUID, generateKeyPairSync, sign, verify, createPublicKey } = require('node:crypto');
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
  it('keeps a live challenge recoverable after twenty newer completed challenges', testService(async (service, c) => {
    const { collector, as, manifest, stage, complete } = await setup(service);
    const live = (await as(collector, 'post').send(manifest).expect(200)).body;
    for (let i = 0; i < 20; i += 1) {
      const instanceId = `later-${i}`;
      await service.post('/v1/projects/1/forms/binaryType/submissions').set('Authorization', `Bearer ${collector.token}`)
        .set('Content-Type', 'application/xml').send(xml.instances.binaryType.both.replace('<instanceID>both</instanceID>', `<instanceID>${instanceId}</instanceID>`))
        .expect(200);
      const later = (await as(collector, 'post').send({ ...manifest, id: randomUUID(), instanceId }).expect(200)).body;
      await complete(await stage(later, Buffer.concat([png, Buffer.from(String(i))]))).expect(200);
    }
    // Keep ordering deterministic even on databases with millisecond timestamp ties.
    await c.db.query(sql`UPDATE field_data_capture_challenges SET "issuedAt" = "issuedAt" - interval '1 minute', "expiresAt" = "expiresAt" - interval '1 minute' WHERE id = ${live.id}`);
    const rows = (await as(collector, 'get').expect(200)).body.items;
    assert.equal(rows.length, 20); assert.equal(rows[0].id, live.id); assert.equal(rows[0].nonce, live.nonce);
    await as(collector, 'delete', `/${live.id}`).expect(200);
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

const assessmentBody = overrides => ({ requestId: randomUUID(), codeAssessment: 'visible', sceneAssessment: 'supports', note: 'Paper code and pump are clear.', reviewedOriginal: true, ...overrides });
const assessedSetup = async service => {
  const fixture = await setup(service);
  const challenge = (await fixture.as(fixture.collector, 'post').send(fixture.manifest).expect(200)).body;
  await fixture.complete(await fixture.stage(challenge)).expect(200);
  const path = `/v1/projects/1/forms/binaryType/submissions/both/capture-challenges/${challenge.id}`;
  const save = (body, revision = 0) => fixture.alice.post(`${path}/assessments`).set('If-Match', `"capture-${revision}"`).send(body);
  return { ...fixture, challenge, path, save };
};
describe('api: human capture assessments', () => {
  it('records identity, original-byte fingerprint, decisions and append-only revisions with idempotent retries', testService(async (service, c) => {
    const { alice, challenge, path, save } = await assessedSetup(service); const body = assessmentBody();
    const first = await save(body).expect(200);
    assert.equal(first.body.assessment.codeAssessment, 'visible'); assert.equal(first.body.assessment.contentHash, hash(png));
    assert.equal(first.body.assessment.reviewedOriginal, true); assert.ok(first.body.assessment.reviewerId); assert.ok(first.body.assessment.reviewerName);
    const retry = await save(body).expect(200); assert.equal(retry.headers['idempotency-status'], 'replayed'); assert.equal(retry.body.assessment.id, first.body.assessment.id);
    await save({ ...body, note: 'Changed under the same retry ID' }).expect(400);
    await save(assessmentBody({ sceneAssessment: 'does-not-support', note: 'Wrong subject.' }), 1).expect(200);
    await save(assessmentBody(), 0).expect(412);
    const records = (await alice.get(`${path}/assessments`).expect(200)).body;
    assert.deepEqual(records.items.map(r => r.sequence), [2, 1]); assert.equal(records.items[1].note, body.note);
    await c.db.query(sql`UPDATE actors SET "displayName" = 'Renamed reviewer' WHERE id = ${first.body.assessment.reviewerId}`);
    assert.equal((await alice.get(`${path}/assessments`).expect(200)).body.items[1].reviewerName, first.body.assessment.reviewerName);
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM audits WHERE action = 'field_data.capture.assessed' AND details->>'challengeId' = ${challenge.id}`), 2);
    const list = (await alice.get('/v1/projects/1/forms/binaryType/submissions/both/capture-challenges').expect(200)).body.items[0];
    assert.equal(list.sceneReview, 'assessed'); assert.equal(list.revision, 2); assert.equal(list.canAssess, true);
    const original = await alice.get(`${path}/image`).expect(200); assert.equal(hash(original.body), hash(png)); assert.equal(original.headers['cache-control'], 'private, no-store');
  }));
  it('marks replacement assessments outdated, preserves original bytes and forbids new saves against replaced attachments', testService(async (service, c) => {
    const { alice, path, save } = await assessedSetup(service); const body = assessmentBody();
    await save(body).expect(200);
    await alice.post('/v1/projects/1/forms/binaryType/submissions/both/attachments/here_is_file2.jpg').set('Content-Type', 'image/png').send(Buffer.concat([png, Buffer.from('replacement')])).expect(200);
    const item = (await alice.get('/v1/projects/1/forms/binaryType/submissions/both/capture-challenges').expect(200)).body.items[0];
    assert.equal(item.sceneReview, 'outdated'); assert.equal(item.canAssess, false); assert.equal(item.assessments.items.length, 1);
    // Retention must not depend on a later evidence-worker audit pass.
    await c.Blobs.purgeUnattached();
    assert.equal(hash((await alice.get(`${path}/image`).expect(200)).body), hash(png));
    await save(assessmentBody(), 1).expect(409);
    const replay = await save(body).expect(200); assert.equal(replay.body.bindingCurrent, false);
  }));
  it('keeps superseded submission assessments available as outdated history', testService(async service => {
    const { alice, path, save } = await assessedSetup(service);
    await save(assessmentBody()).expect(200);
    await alice.post('/v1/projects/1/submission').set('X-OpenRosa-Version', '1.0')
      .attach('xml_submission_file', Buffer.from(xml.instances.binaryType.both.replace('<instanceID>both', '<deprecatedID>both</deprecatedID><instanceID>both2')), { filename: 'data.xml' }).expect(201);
    const item = (await alice.get('/v1/projects/1/forms/binaryType/submissions/both/capture-challenges').expect(200)).body.items[0];
    assert.equal(item.sceneReview, 'outdated'); assert.equal(item.canAssess, false);
    assert.equal((await alice.get(`${path}/assessments`).expect(200)).body.items.length, 1);
    await save(assessmentBody(), 1).expect(409);
  }));
  it('enforces reviewer permissions, attestation and explanatory notes, and isolates submissions', testService(async service => {
    const { alice, collector, other, path, save } = await assessedSetup(service);
    await service.post(`${path}/assessments`).send(assessmentBody()).expect(401);
    await service.post(`${path}/assessments`).set('Authorization', `Bearer ${collector.token}`).set('If-Match', '"capture-0"').send(assessmentBody())
      .expect(404);
    await service.get(`${path}/image`).set('Authorization', `Bearer ${other.token}`).expect(404);
    await alice.post(`${path}/assessments`).send(assessmentBody()).expect(428);
    for (const body of [assessmentBody({ reviewedOriginal: false }), assessmentBody({ note: 'x'.repeat(2001) }), assessmentBody({ codeAssessment: 'unclear', note: ' ' }), assessmentBody({ sceneAssessment: 'does-not-support', note: '' }), assessmentBody({ score: 99 })]) await save(body).expect(400);
    await alice.get(path.replace('/both/', '/missing/') + '/assessments').expect(404);
    await alice.get(`${path}/assessments?before=invalid`).expect(400);
  }));
  it('paginates immutable history without duplicating or hiding the latest review', testService(async service => {
    const { alice, path, save } = await assessedSetup(service);
    for (let i = 0; i < 12; i += 1) await save(assessmentBody({ note: `Review ${i + 1}` }), i).expect(200);
    const first = (await alice.get(`${path}/assessments`).expect(200)).body;
    assert.equal(first.items.length, 10); assert.equal(first.nextBefore, 3); assert.equal(first.omitted, 2);
    const second = (await alice.get(`${path}/assessments?before=${first.nextBefore}`).expect(200)).body;
    assert.deepEqual(second.items.map(r => r.sequence), [2, 1]); assert.equal(second.nextBefore, null);
  }));
  it('serializes simultaneous reviewers at one revision and simultaneous retries of one decision', testServiceFullTrx(async service => {
    const { save } = await assessedSetup(service); const body = assessmentBody();
    const retried = await Promise.all([save(body), save(body)]); assert.deepEqual(retried.map(r => r.status), [200, 200]);
    const competing = await Promise.all([save(assessmentBody(), 1), save(assessmentBody({ note: 'Other judgment' }), 1)]);
    assert.deepEqual(competing.map(r => r.status).sort(), [200, 412]);
  }));
  it('rejects corrupted stored bytes and archived-project writes while retaining readable history', testService(async (service, c) => {
    const { alice, path, challenge, save } = await assessedSetup(service);
    await save(assessmentBody()).expect(200);
    await alice.patch('/v1/projects/1').send({ archived: true }).expect(200);
    await save(assessmentBody(), 1).expect(409);
    assert.equal((await alice.get(`${path}/assessments`).expect(200)).body.items.length, 1);
    await alice.patch('/v1/projects/1').send({ archived: false }).expect(200);
    await c.db.query(sql`UPDATE blobs SET content = ${sql.binary(Buffer.from('corrupt'))} WHERE id = (SELECT "blobId" FROM field_data_capture_challenges WHERE id = ${challenge.id})`);
    await alice.get(`${path}/image`).expect(409); await save(assessmentBody(), 1).expect(409);
  }));
});

describe('api: capture assessment read-only and deletion boundaries', () => {
  it('allows viewers to read the history and original image, but denies decisions and deleted sources', testService(async service => {
    const { alice, path, save } = await assessedSetup(service);
    await save(assessmentBody()).expect(200);
    const viewer = await service.login('chelsea'); const { id } = (await viewer.get('/v1/users/current').expect(200)).body;
    await alice.post(`/v1/projects/1/assignments/viewer/${id}`).expect(200);
    assert.equal((await viewer.get('/v1/projects/1/forms/binaryType/submissions/both/capture-challenges').expect(200)).body.items[0].canAssess, false);
    await viewer.get(`${path}/image`).expect(200); await viewer.get(`${path}/assessments`).expect(200);
    await viewer.post(`${path}/assessments`).set('If-Match', '"capture-1"').send(assessmentBody()).expect(404);
    await alice.delete('/v1/projects/1/forms/binaryType/submissions/both').expect(200);
    await alice.get(`${path}/image`).expect(404); await alice.get(`${path}/assessments`).expect(404);
    await save(assessmentBody(), 1).expect(404);
  }));
});

describe('api: assessment and attachment replacement race', () => {
  it('never commits a current assessment for a concurrently replaced image', testServiceFullTrx(async service => {
    const { alice, save } = await assessedSetup(service);
    const results = await Promise.all([save(assessmentBody()), alice.post('/v1/projects/1/forms/binaryType/submissions/both/attachments/here_is_file2.jpg')
      .set('Content-Type', 'image/png').send(Buffer.concat([png, Buffer.from('concurrent replacement')]))]);
    assert.ok([200, 409].includes(results[0].status)); assert.equal(results[1].status, 200);
    const item = (await alice.get('/v1/projects/1/forms/binaryType/submissions/both/capture-challenges').expect(200)).body.items[0];
    assert.equal(item.canAssess, false); assert.equal(item.bindingCurrent, false);
    assert.equal(item.sceneReview, results[0].status === 200 ? 'outdated' : 'not-assessed');
  }));
});

const witnessBody = (context, changes = {}) => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const requestId = randomUUID(); const signedAt = new Date().toISOString(); const statement = 'I personally observed the pump and matching paper code.';
  const fields = { requestId, signedAt, statement, ...changes };
  const payload = Buffer.from(JSON.stringify({ ...context, ...fields })).toString('base64url');
  return { ...fields, payload, publicKey: publicKey.export({ format: 'jwk' }),
    signature: sign('sha256', Buffer.from(payload, 'base64url'), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url') };
};
describe('api: signed capture witness statements', () => {
  it('verifies image-scoped signatures, records authenticated identity, and idempotently replays lost acknowledgements', testService(async (service, c) => {
    const { alice, path } = await assessedSetup(service); const url = `${path}/witnesses`;
    const view = (await alice.get(url).expect(200)).body;
    assert.equal(view.canWitness, true); assert.equal(view.context.contentHash, hash(png));
    const body = witnessBody(view.context); const first = await alice.post(url).send(body).expect(200);
    const record = first.body.witness;
    assert.equal(record.witnessId, view.context.witnessId); assert.equal(record.payload, body.payload);
    assert.ok(verify('sha256', Buffer.from(record.payload, 'base64url'), { key: createPublicKey({ key: record.publicKey, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(record.signature, 'base64url')));
    const replay = await alice.post(url).send(body).expect(200); assert.equal(replay.body.witness.id, record.id);
    assert.equal(replay.headers['idempotency-status'], 'replayed');
    const history = (await alice.get(url).expect(200)).body; assert.equal(history.canWitness, false); assert.equal(history.items.length, 1);
    await alice.post(url).send(witnessBody(view.context)).expect(409);
    await c.db.query(sql`UPDATE actors SET "displayName" = 'New name' WHERE id = ${record.witnessId}`);
    assert.equal((await alice.get(url).expect(200)).body.items[0].witnessName, record.witnessName);
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM audits WHERE action = 'field_data.capture.witnessed'`), 1);
  }));
  it('rejects altered statements, signatures, actor or image scope, unknown fields, invalid keys and stale new signatures', testService(async service => {
    const { alice, path } = await assessedSetup(service); const url = `${path}/witnesses`;
    const { context } = (await alice.get(url).expect(200)).body; const body = witnessBody(context);
    for (const change of [{ statement: 'Tampered statement' }, { signature: 'a'.repeat(86) }, { extra: true }, { publicKey: { ...body.publicKey, d: 'private' } }]) await alice.post(url).send({ ...body, ...change }).expect(400);
    for (const changed of [{ ...context, witnessId: context.witnessId + 1 }, { ...context, contentHash: 'a'.repeat(64) }, { ...context, projectId: 2 }]) await alice.post(url).send(witnessBody(changed)).expect(400);
    await alice.post(url).send(witnessBody(context, { signedAt: new Date(Date.now() - 11 * 60000).toISOString() })).expect(400);
    assert.equal((await alice.get(url).expect(200)).body.items.length, 0);
  }));
  it('keeps replaced-image statements readable and retryable but blocks new attestations', testService(async service => {
    const { alice, path } = await assessedSetup(service); const url = `${path}/witnesses`;
    const { context } = (await alice.get(url).expect(200)).body; const body = witnessBody(context);
    await alice.post(url).send(body).expect(200);
    await alice.post('/v1/projects/1/forms/binaryType/submissions/both/attachments/here_is_file2.jpg').set('Content-Type', 'image/png').send(Buffer.concat([png, Buffer.from('new')])).expect(200);
    const view = (await alice.get(url).expect(200)).body; assert.equal(view.bindingCurrent, false); assert.equal(view.items.length, 1); assert.equal(view.context, null);
    assert.equal((await alice.post(url).send(body).expect(200)).body.bindingCurrent, false);
    await alice.post(url).send(witnessBody(context)).expect(409);
  }));
  it('permits viewer history but blocks collectors, viewers, revoked grants and deleted sources', testService(async service => {
    const { alice, collector, path } = await assessedSetup(service); const url = `${path}/witnesses`;
    const { context } = (await alice.get(url).expect(200)).body; const body = witnessBody(context);
    const viewer = await service.login('chelsea'); const { id } = (await viewer.get('/v1/users/current').expect(200)).body;
    await alice.post(`/v1/projects/1/assignments/viewer/${id}`).expect(200);
    assert.equal((await viewer.get(url).expect(200)).body.canWitness, false);
    await viewer.post(url).send(body).expect(404);
    await service.get(url).expect(401);
    await service.post(url).set('Authorization', `Bearer ${collector.token}`).send(body).expect(404);
    await alice.delete(`/v1/projects/1/assignments/viewer/${id}`).expect(200); await viewer.get(url).expect(404);
    await alice.delete('/v1/projects/1/forms/binaryType/submissions/both').expect(200);
    await alice.get(url).expect(404); await alice.post(url).send(body).expect(404);
  }));
  it('serializes duplicate signatures and competing statements from the same account', testServiceFullTrx(async service => {
    const { alice, path } = await assessedSetup(service); const url = `${path}/witnesses`;
    const { context } = (await alice.get(url).expect(200)).body; const body = witnessBody(context);
    const results = await Promise.all([alice.post(url).send(body), alice.post(url).send(body)]);
    assert.deepEqual(results.map(r => r.status), [200, 200]); assert.equal(results[0].body.witness.id, results[1].body.witness.id);
  }));
  it('rechecks original-byte integrity and archived projects before commit', testService(async (service, c) => {
    const { alice, challenge, path } = await assessedSetup(service); const url = `${path}/witnesses`;
    const { context } = (await alice.get(url).expect(200)).body;
    await alice.patch('/v1/projects/1').send({ archived: true }).expect(200);
    await alice.post(url).send(witnessBody(context)).expect(409);
    await alice.patch('/v1/projects/1').send({ archived: false }).expect(200);
    await c.db.query(sql`UPDATE blobs SET content = ${sql.binary(Buffer.from('corrupt'))} WHERE id = (SELECT "blobId" FROM field_data_capture_challenges WHERE id = ${challenge.id})`);
    await alice.post(url).send(witnessBody(context)).expect(409);
  }));
});

const witnessChangeBody = (context, action = 'correct', changes = {}) => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const fields = { requestId: randomUUID(), signedAt: new Date().toISOString(), action,
    statement: action === 'withdraw' ? null : 'I saw the paper code but could not verify the pump operation.',
    reason: 'I need to clarify the limits of my original observation.', ...changes };
  const payload = Buffer.from(JSON.stringify({ ...context, ...fields })).toString('base64url');
  return { ...fields, payload, publicKey: publicKey.export({ format: 'jwk' }),
    signature: sign('sha256', Buffer.from(payload, 'base64url'), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url') };
};
describe('api: signed witness corrections and withdrawals', () => {
  it('retains the original, signs a correction and terminal withdrawal, and safely replays older changes', testService(async (service, c) => {
    const { alice, challenge, path } = await assessedSetup(service); const url = `${path}/witnesses`;
    const original = witnessBody((await alice.get(url).expect(200)).body.context);
    const record = (await alice.post(url).send(original).expect(200)).body.witness;
    const eventUrl = `${url}/${record.id}/events`;
    let view = (await alice.get(url).expect(200)).body;
    assert.equal(view.activeCount, 1); assert.equal(view.items[0].revision, 0);
    const correction = witnessChangeBody(view.items[0].changeContext);
    await alice.post(eventUrl).send(witnessChangeBody(view.items[0].changeContext, 'correct', { signedAt: new Date(Date.now() - 11 * 60000).toISOString() })).expect(400);
    await alice.post(eventUrl).send({ ...correction, extra: true }).expect(400);
    await alice.post(eventUrl).send({ ...correction, reason: 'An altered unsigned reason' }).expect(400);
    await alice.post(eventUrl).send(witnessChangeBody({ ...view.items[0].changeContext, originalPayloadHash: '0'.repeat(64) })).expect(400);
    const corrected = (await alice.post(eventUrl).send(correction).expect(200)).body.witness;
    assert.equal(corrected.payload, original.payload); assert.equal(corrected.events.length, 1); assert.equal(corrected.status, 'active');
    view = (await alice.get(url).expect(200)).body; assert.equal(view.activeCount, 1);
    const withdrawal = witnessChangeBody(view.items[0].changeContext, 'withdraw');
    const withdrawn = (await alice.post(eventUrl).send(withdrawal).expect(200)).body.witness;
    assert.equal(withdrawn.status, 'withdrawn'); assert.equal(withdrawn.revision, 2); assert.equal(withdrawn.payload, original.payload);
    view = (await alice.get(url).expect(200)).body;
    assert.equal(view.activeCount, 0); assert.equal(view.items[0].canCorrect, false); assert.equal(view.items[0].changeContext, null); assert.equal(view.canWitness, false);
    const replay = await alice.post(eventUrl).send(correction).expect(200);
    assert.equal(replay.headers['idempotency-status'], 'replayed'); assert.equal(replay.body.witness.status, 'withdrawn');
    await alice.post(eventUrl).send(withdrawal).expect(200);
    assert.equal((await alice.post(url).send(original).expect(200)).body.witness.status, 'withdrawn');
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM audits WHERE action LIKE 'field_data.capture.witness.%'`), 2);
    for (const statement of [sql`UPDATE field_data_capture_witnesses SET payload = 'tampered' WHERE id = ${record.id}`,
      sql`DELETE FROM field_data_capture_witnesses WHERE id = ${record.id}`,
      sql`UPDATE field_data_capture_witness_events SET payload = 'tampered' WHERE "witnessRecordId" = ${record.id}`,
      sql`DELETE FROM field_data_capture_witness_events WHERE "witnessRecordId" = ${record.id}`]) {
      await c.run(sql`SAVEPOINT witness_guard`);
      await assert.rejects(c.run(statement), /immutable|append-only/);
      await c.run(sql`ROLLBACK TO SAVEPOINT witness_guard`);
      await c.run(sql`RELEASE SAVEPOINT witness_guard`);
    }
    // Source purge remains compatible with the pre-existing cascading retention policy.
    await c.run(sql`DELETE FROM field_data_capture_challenges WHERE id = ${challenge.id}`);
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_capture_witness_events`), 0);
  }));
  it('only accepts the owning web account with current grants and allows historical withdrawal after replacement and archival', testService(async service => {
    const { alice, collector, path } = await assessedSetup(service); const url = `${path}/witnesses`;
    const owner = await service.login('chelsea'); const ownerId = (await owner.get('/v1/users/current').expect(200)).body.id;
    await alice.post(`/v1/projects/1/assignments/manager/${ownerId}`).expect(200);
    const record = (await owner.post(url).send(witnessBody((await owner.get(url).expect(200)).body.context)).expect(200)).body.witness;
    const change = witnessChangeBody((await owner.get(url).expect(200)).body.items[0].changeContext, 'withdraw');
    const eventUrl = `${url}/${record.id}/events`;
    await alice.post(eventUrl).send(change).expect(404);
    await service.post(eventUrl).set('Authorization', `Bearer ${collector.token}`).send(change).expect(404);
    await alice.delete(`/v1/projects/1/assignments/manager/${ownerId}`).expect(200);
    await alice.post(`/v1/projects/1/assignments/viewer/${ownerId}`).expect(200);
    assert.equal((await owner.get(url).expect(200)).body.items[0].changeContext, null);
    await owner.post(eventUrl).send(change).expect(404);
    await alice.post(`/v1/projects/1/assignments/manager/${ownerId}`).expect(200);
    await alice.post('/v1/projects/1/forms/binaryType/submissions/both/attachments/here_is_file2.jpg').set('Content-Type', 'image/png').send(Buffer.concat([png, Buffer.from('new')])).expect(200);
    await alice.patch('/v1/projects/1').send({ archived: true }).expect(200);
    const result = (await owner.post(eventUrl).send(change).expect(200)).body;
    assert.equal(result.bindingCurrent, false); assert.equal(result.witness.status, 'withdrawn');
    await alice.delete('/v1/projects/1/forms/binaryType/submissions/both').expect(200);
    await owner.post(eventUrl).send(change).expect(404);
  }));
  it('serializes identical retries and competing signed changes without overwriting history', testServiceFullTrx(async service => {
    const { alice, path } = await assessedSetup(service); const url = `${path}/witnesses`;
    const record = (await alice.post(url).send(witnessBody((await alice.get(url).expect(200)).body.context)).expect(200)).body.witness;
    const eventUrl = `${url}/${record.id}/events`;
    const change = witnessChangeBody((await alice.get(url).expect(200)).body.items[0].changeContext);
    const duplicate = await Promise.all([alice.post(eventUrl).send(change), alice.post(eventUrl).send(change)]);
    assert.deepEqual(duplicate.map(result => result.status), [200, 200]);
    assert.equal(duplicate[0].body.witness.events[0].id, duplicate[1].body.witness.events[0].id);
    const context = (await alice.get(url).expect(200)).body.items[0].changeContext;
    const competing = await Promise.all([alice.post(eventUrl).send(witnessChangeBody(context)), alice.post(eventUrl).send(witnessChangeBody(context, 'withdraw'))]);
    assert.deepEqual(competing.map(result => result.status).sort(), [200, 400]);
    assert.equal((await alice.get(url).expect(200)).body.items[0].events.length, 2);
  }));
  it('caps corrections while retaining a withdrawal slot and preserves signed history on rollback', testServiceFullTrx(async service => {
    const { alice, path } = await assessedSetup(service); const url = `${path}/witnesses`;
    const record = (await alice.post(url).send(witnessBody((await alice.get(url).expect(200)).body.context)).expect(200)).body.witness;
    const eventUrl = `${url}/${record.id}/events`;
    for (let n = 0; n < 20; n += 1) {
      const context = (await alice.get(url).expect(200)).body.items[0].changeContext;
      await alice.post(eventUrl).send(witnessChangeBody(context)).expect(200);
    }
    const view = (await alice.get(url).expect(200)).body.items[0]; assert.equal(view.canCorrect, false);
    await alice.post(eventUrl).send(witnessChangeBody(view.changeContext)).expect(409);
    await alice.post(eventUrl).send(witnessChangeBody(view.changeContext, 'withdraw')).expect(200);
    const { knexConnect } = require('../../../lib/model/knex-migrator');
    const migration = require('../../../lib/model/migrations/20261016-01-capture-witness-events');
    const db = knexConnect(require('config').get('test.database'));
    try { await db.transaction(async tx => { await migration.down(tx); await migration.up(tx); }); } finally { await db.destroy(); }
    assert.equal((await alice.get(url).expect(200)).body.items[0].events.length, 21);
  }));
});
describe('api: capture witness lifecycle and bounds', () => {
  it('rechecks witness grants after context loading and retains read-only history after revocation', testService(async service => {
    const { alice, path } = await assessedSetup(service); const url = `${path}/witnesses`;
    const witness = await service.login('chelsea'); const { id } = (await witness.get('/v1/users/current').expect(200)).body;
    await alice.post(`/v1/projects/1/assignments/manager/${id}`).expect(200);
    const { context } = (await witness.get(url).expect(200)).body; const body = witnessBody(context);
    await alice.delete(`/v1/projects/1/assignments/manager/${id}`).expect(200);
    await witness.post(url).send(body).expect(404);
    await alice.post(`/v1/projects/1/assignments/manager/${id}`).expect(200);
    await witness.post(url).send(body).expect(200);
    await alice.delete(`/v1/projects/1/assignments/manager/${id}`).expect(200);
    await alice.post(`/v1/projects/1/assignments/viewer/${id}`).expect(200);
    const view = (await witness.get(url).expect(200)).body; assert.equal(view.items.length, 1); assert.equal(view.canWitness, false);
    await witness.post(url).send(body).expect(404);
  }));
  it('keeps superseded statements readable while blocking new attestations', testService(async service => {
    const { alice, path } = await assessedSetup(service); const url = `${path}/witnesses`;
    const { context } = (await alice.get(url).expect(200)).body; await alice.post(url).send(witnessBody(context)).expect(200);
    await alice.post('/v1/projects/1/submission').set('X-OpenRosa-Version', '1.0')
      .attach('xml_submission_file', Buffer.from(xml.instances.binaryType.both.replace('<instanceID>both', '<deprecatedID>both</deprecatedID><instanceID>both2')), { filename: 'data.xml' }).expect(201);
    const view = (await alice.get(url).expect(200)).body; assert.equal(view.items.length, 1); assert.equal(view.bindingCurrent, false); assert.equal(view.context, null);
    await alice.post(url).send(witnessBody(context)).expect(409);
  }));
  it('caps witnesses at ten authenticated accounts', testService(async service => {
    const { alice, path } = await assessedSetup(service); const url = `${path}/witnesses`;
    const { context } = (await alice.get(url).expect(200)).body; const original = witnessBody(context);
    for (let i = 0; i < 10; i += 1) {
      const email = `witness${i}@example.org`; const password = 'test-only-password';
      const { id } = (await alice.post('/v1/users').send({ email, password, displayName: `Witness ${i}` }).expect(200)).body;
      await alice.post(`/v1/projects/1/assignments/manager/${id}`).expect(200);
      const user = await service.login({ email, password }); const signing = (await user.get(url).expect(200)).body.context;
      await user.post(url).send(witnessBody(signing)).expect(200);
    }
    const view = (await alice.get(url).expect(200)).body; assert.equal(view.items.length, 10); assert.equal(view.canWitness, false); assert.equal(view.context, null);
    await alice.post(url).send(original).expect(409);
  }));
  it('never treats a witness statement as current after a concurrent attachment replacement', testServiceFullTrx(async service => {
    const { alice, path } = await assessedSetup(service); const url = `${path}/witnesses`;
    const { context } = (await alice.get(url).expect(200)).body;
    const results = await Promise.all([alice.post(url).send(witnessBody(context)), alice.post('/v1/projects/1/forms/binaryType/submissions/both/attachments/here_is_file2.jpg')
      .set('Content-Type', 'image/png').send(Buffer.concat([png, Buffer.from('replacement')]))]);
    assert.ok([200, 409].includes(results[0].status)); assert.equal(results[1].status, 200);
    const view = (await alice.get(url).expect(200)).body; assert.equal(view.bindingCurrent, false); assert.equal(view.canWitness, false);
  }));
});

const captureLocation = patch => ({ source: 'browser-geolocation', latitude: 8.48, longitude: -13.23, accuracy: 15,
  sampledAt: '2026-10-14T11:00:00.000Z', capturedAt: '2026-10-14T11:00:05.000Z', ...patch });
describe('api: optional device-reported capture location', () => {
  it('atomically binds optional context to original bytes, retries unchanged manifests, and retains historical readings after replacement', testService(async (service, c) => {
    const { alice, collector, other, as, manifest, stage, complete } = await setup(service);
    const challenge = (await as(collector, 'post').send(manifest).expect(200)).body;
    const location = captureLocation(); const body = await stage(challenge, png, { captureLocation: location });
    const retry = await service.post(uploads).set('Authorization', `Bearer ${collector.token}`).send({ ...body, captureLocation: Object.fromEntries(Object.entries(location).reverse()) }).expect(200);
    assert.deepEqual(retry.body.captureLocation, location);
    await service.post(uploads).set('Authorization', `Bearer ${collector.token}`).send({ ...body, captureLocation: captureLocation({ latitude: 9 }) }).expect(409);
    await complete(body).expect(200); await complete(body).expect(200);
    const path = '/v1/projects/1/forms/binaryType/submissions/both/capture-challenges';
    const item = (await alice.get(path).expect(200)).body.items[0]; assert.deepEqual(item.captureLocation, location); assert.equal(item.bindingCurrent, true);
    assert.equal(item.contentHash, hash(png)); assert.deepEqual((await as(collector, 'get').expect(200)).body.items[0].captureLocation, location);
    await service.get(path).set('Authorization', `Bearer ${other.token}`).expect(404);
    const audits = await c.db.any(sql`SELECT details FROM audits WHERE action LIKE 'field_data.capture.%' OR action LIKE 'field_data.media.%'`);
    assert.equal(JSON.stringify(audits).includes('latitude'), false); assert.equal(JSON.stringify(audits).includes('sampledAt'), false);
    await alice.post('/v1/projects/1/forms/binaryType/submissions/both/attachments/here_is_file2.jpg').set('Content-Type', 'image/png').send(Buffer.concat([png, Buffer.from('replacement')])).expect(200);
    const old = (await alice.get(path).expect(200)).body.items[0]; assert.deepEqual(old.captureLocation, location); assert.equal(old.bindingCurrent, false);
  }));
  it('rejects malformed, stale or expanded readings and prevents location metadata on unchallenged uploads', testService(async service => {
    const { collector, as, manifest } = await setup(service); const challenge = (await as(collector, 'post').send(manifest).expect(200)).body;
    const body = { id: randomUUID(), xmlFormId: 'binaryType', instanceId: 'both', name: manifest.name, size: png.length, sha256: hash(png), contentType: 'image/png', priority: 1,
      challengeId: challenge.id, challengeNonce: challenge.nonce };
    for (const location of [null, {}, captureLocation({ source: 'verified-gps' }), captureLocation({ latitude: '8.48' }), captureLocation({ latitude: 91 }),
      captureLocation({ longitude: -181 }), captureLocation({ accuracy: -1 }), captureLocation({ accuracy: 100001 }), captureLocation({ altitude: 12 }),
      captureLocation({ sampledAt: '2026-02-30T11:00:00.000Z' }), captureLocation({ capturedAt: '2026-10-14T11:01:00.001Z' }), captureLocation({ capturedAt: '2026-10-14T10:59:59.999Z' })]) {
      await service.post(uploads).set('Authorization', `Bearer ${collector.token}`).send({ ...body, captureLocation: location }).expect(400);
    }
    const { challengeId, challengeNonce, ...ordinary } = body;
    await service.post(uploads).set('Authorization', `Bearer ${collector.token}`).send({ ...ordinary, captureLocation: captureLocation() }).expect(400);
  }));
  it('allows challenged photos with no location and labels absent context honestly', testService(async service => {
    const { alice, collector, as, manifest, stage, complete } = await setup(service);
    const challenge = (await as(collector, 'post').send(manifest).expect(200)).body; await complete(await stage(challenge)).expect(200);
    const item = (await alice.get('/v1/projects/1/forms/binaryType/submissions/both/capture-challenges').expect(200)).body.items[0];
    assert.equal(item.captureLocation, null); assert.equal(item.sceneReview, 'not-assessed');
  }));
  it('never binds sensor context when challenge or attachment validation fails', testService(async (service, c) => {
    const { collector, as, manifest, stage, complete } = await setup(service);
    const challenge = (await as(collector, 'post').send(manifest).expect(200)).body;
    const body = await stage(challenge, png, { challengeNonce: '0'.repeat(64), captureLocation: captureLocation() });
    await complete(body).expect(409);
    const row = await c.db.one(sql`SELECT status, "captureLocation" FROM field_data_capture_challenges WHERE id = ${challenge.id}`);
    assert.equal(row.status, 'issued'); assert.equal(row.captureLocation, null);
  }));
});
