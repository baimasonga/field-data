// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
/* eslint-disable no-await-in-loop */
const assert = require('node:assert/strict');
const { generateKeyPairSync, randomUUID, randomBytes, sign } = require('node:crypto');
const { sql } = require('slonik');
const { testService, testServiceFullTrx } = require('../setup');
const testData = require('../../data/xml');
const xml = require('../../../lib/util/xml-couriers');
const root = '/v1/field-data/app-user/xml-background';
const withSigning = async action => {
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }); const saved = { key: process.env.FIELD_DATA_OFFLINE_SIGNING_KEY, origin: process.env.FIELD_DATA_OFFLINE_ORIGIN };
  process.env.FIELD_DATA_OFFLINE_SIGNING_KEY = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }); process.env.FIELD_DATA_OFFLINE_ORIGIN = 'https://background.example';
  try { await action(keys); } finally { for (const [name, value] of [['FIELD_DATA_OFFLINE_SIGNING_KEY', saved.key], ['FIELD_DATA_OFFLINE_ORIGIN', saved.origin]]) { if (value == null) delete process.env[name]; else process.env[name] = value; } }
};
const setup = async service => {
  const alice = await service.login('alice');
  const owner = (await alice.post('/v1/projects/1/app-users').send({ displayName: 'Background collector' }).expect(200)).body;
  const other = (await alice.post('/v1/projects/1/app-users').send({ displayName: 'Other collector' }).expect(200)).body;
  await alice.post(`/v1/projects/1/forms/simple/assignments/app-user/${owner.id}`).expect(200);
  const bytes = Buffer.from(testData.instances.simple.one.replace('one</instanceID>', 'background-new</instanceID>')); const token = randomBytes(32).toString('base64url');
  const { manifest } = await xml.parse(bytes); const body = { id: randomUUID(), manifest, tokenHash: xml.digest(token), expiresAt: new Date(Date.now() + 3600000).toISOString() };
  const as = (user, method, path = '') => service[method](root + path).set('Authorization', `Bearer ${user.token}`);
  const deliver = (id, data = bytes, capability = token) => service.put(`${root}/${id}/deliver`).set('Content-Type', 'application/octet-stream').set('X-Field-Data-Delivery-Token', capability).send(data);
  return { alice, owner, other, bytes, token, body, as, deliver };
};
describe('api: background XML capability delivery', () => {
  it('authorizes metadata only and delivers exact bytes without an App User key with native collector attribution', testService(async (service, c) => withSigning(async keys => {
    const { owner, other, bytes, token, body, as, deliver } = await setup(service);
    const issued = (await as(owner, 'post').send(body).expect(200)).body; assert.equal(JSON.stringify(issued).includes(token), false); assert.equal(JSON.stringify(issued).includes('<data'), false);
    assert.equal((await as(owner, 'post').send(body).expect(200)).body.authorization.id, body.id);
    await as(other, 'get', `/${body.id}`).expect(404); await service.get(`${root}/${body.id}`).expect(401);
    await deliver(body.id, bytes, randomBytes(32).toString('base64url')).expect(404);
    await deliver(body.id, Buffer.from(bytes.toString().replace('</data>', '<changed/></data>'))).expect(409);
    const accepted = (await deliver(body.id).expect(200)).body; await deliver(body.id).expect(200);
    assert.equal(accepted.events[0].details.transport, 'background-capability'); assert.equal(accepted.events[0].details.ownerId, owner.id); assert.equal(accepted.sourceAvailable, true);
    const source = await c.db.one(sql`SELECT sd.xml,sd."submitterId",p."sourceRef" FROM submission_defs sd JOIN field_data_submission_provenance p ON p."submissionDefId"=sd.id WHERE sd.id=${accepted.events[0].details.submissionDefId}`);
    assert.equal(xml.digest(source.xml), body.manifest.sha256); assert.equal(source.submitterId, owner.id); assert.equal(source.sourceRef, `xml-background:${body.id}`);
    const audit = await c.db.one(sql`SELECT "actorId","acteeId",details FROM audits WHERE action='field_data.xml.background.delivery' AND details->>'authorizationId'=${body.id}`); assert.equal(audit.actorId, null); assert.equal(audit.details.ownerId, owner.id); assert.equal(audit.details.transport, 'background-capability'); assert.equal(audit.acteeId, await c.db.oneFirst(sql`SELECT "acteeId" FROM forms WHERE id=${accepted.target.formId}`));
    // eslint-disable-next-line import/extensions, import/no-relative-packages
    const { verifyXmlBackgroundProof } = await import('../../../../../cloudflare/verify-xml-background.mjs');
    const pins = { issuer: 'https://background.example', projectId: 1, publicKeys: [keys.publicKey.export({ format: 'jwk' })] };
    assert.equal(verifyXmlBackgroundProof(accepted, pins).events[0].sha256, body.manifest.sha256);
    assert.throws(() => verifyXmlBackgroundProof(accepted, { ...pins, projectId: 2 }));
    const bad = JSON.parse(JSON.stringify(accepted)); bad.target.manifest.sha256 = 'a'.repeat(64); assert.throws(() => verifyXmlBackgroundProof(bad, pins));
    assert.equal((await as(owner, 'get').expect(200)).body.items.length, 1);
    assert.equal((await as(owner, 'get', '?xmlFormId=simple&instanceId=background-new').expect(200)).body.items.length, 1);
    assert.equal((await as(owner, 'get', '?xmlFormId=simple&instanceId=other').expect(200)).body.items.length, 0);
    await as(owner, 'get', '?xmlFormId=simple').expect(400);
    await assert.rejects(c.db.query(sql`UPDATE field_data_xml_background_events SET details='{}'::jsonb WHERE "authorizationId"=${body.id}`));
  })));
  it('enforces current collection permission, closed forms, signing availability and permanent unsigned revocation', testService(async service => withSigning(async () => {
    const { alice, owner, other, bytes, body, as, deliver } = await setup(service);
    await as(owner, 'post').send({ ...body, expiresAt: new Date(Date.now() + 25 * 3600000).toISOString() }).expect(400);
    await as(owner, 'post').send(body).expect(200);
    await as(owner, 'post').send({ ...body, tokenHash: '0'.repeat(64) }).expect(409);
    await as(other, 'post', `/${body.id}/revoke`).send({ requestId: randomUUID(), reason: 'Not my authorization to revoke.' }).expect(404);
    await alice.delete(`/v1/projects/1/forms/simple/assignments/app-user/${owner.id}`).expect(200); await deliver(body.id).expect(404);
    await alice.post(`/v1/projects/1/forms/simple/assignments/app-user/${owner.id}`).expect(200);
    const signing = process.env.FIELD_DATA_OFFLINE_SIGNING_KEY; delete process.env.FIELD_DATA_OFFLINE_SIGNING_KEY; await deliver(body.id).expect(400);
    const revoke = { requestId: randomUUID(), reason: 'Stop this background authorization permanently.' };
    const cancelled = (await as(owner, 'post', `/${body.id}/revoke`).send(revoke).expect(200)).body; assert.equal(cancelled.event.attestation, null);
    process.env.FIELD_DATA_OFFLINE_SIGNING_KEY = signing; await as(owner, 'post', `/${body.id}/revoke`).send(revoke).expect(200); await deliver(body.id).expect(404);
    const replacement = { ...body, id: randomUUID() }; await as(owner, 'post').send(replacement).expect(200);
    await alice.patch('/v1/projects/1/forms/simple').send({ state: 'closed' }).expect(200); await deliver(replacement.id, bytes).expect(404);
    await as(owner, 'post', `/${replacement.id}/revoke`).send({ requestId: randomUUID(), reason: 'Cancel while the collection form is closed.' }).expect(200);
  })));
  it('shares a purge-resistant target tombstone with couriers and serializes exact cross-transport retries', testServiceFullTrx(async (service, c) => withSigning(async () => {
    const { owner, other, bytes, body, as, deliver } = await setup(service);
    await as(owner, 'post').send(body).expect(200);
    const courier = (await service.post('/v1/field-data/app-user/xml-couriers').set('Authorization', `Bearer ${owner.token}`).send({ requestId: randomUUID(), courierId: other.id, minutes: 60, manifest: body.manifest }).expect(200)).body;
    const courierSend = () => service.put(`/v1/field-data/app-user/xml-couriers/${courier.grant.id}/deliver`).set('Authorization', `Bearer ${other.token}`).set('Content-Type', 'application/octet-stream').send(bytes);
    const responses = await Promise.all([deliver(body.id), deliver(body.id), courierSend()]); assert.deepEqual(responses.map(r => r.status), [200, 200, 200]);
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM submissions WHERE "instanceId"='background-new'`), 1);
    await c.db.query(sql`DELETE FROM submissions WHERE "instanceId"='background-new'`);
    assert.equal((await as(owner, 'get', `/${body.id}`).expect(200)).body.sourceAvailable, false);
    await deliver(body.id).expect(404); await courierSend().expect(404); await as(owner, 'post').send({ ...body, id: randomUUID() }).expect(409);
    await service.post('/v1/field-data/app-user/xml-couriers').set('Authorization', `Bearer ${owner.token}`).send({ requestId: randomUUID(), courierId: other.id, minutes: 60, manifest: body.manifest }).expect(409);
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_xml_background_events WHERE "authorizationId"=${body.id} AND kind='delivery'`), 1);
  })));
  it('retains version-bound native edits and rejects a newer competing source', testService(async (service, c) => withSigning(async () => {
    const { owner, bytes, body, as, deliver } = await setup(service);
    await service.post('/v1/projects/1/submission').set('Authorization', `Bearer ${owner.token}`).set('X-OpenRosa-Version', '1.0').attach('xml_submission_file', bytes, { filename: 'original.xml' })
      .expect(201);
    const edited = Buffer.from(bytes.toString().replace('background-new', 'background-edited').replace('</meta>', '<deprecatedID>background-new</deprecatedID></meta>'));
    const parsed = await xml.parse(edited); const edit = { ...body, manifest: { ...parsed.manifest, deprecatedId: parsed.deprecatedId, baseSha256: xml.digest(bytes) } };
    await as(owner, 'post').send(edit).expect(200); const accepted = (await deliver(edit.id, edited).expect(200)).body; await deliver(edit.id, edited).expect(200);
    assert.equal(accepted.events[0].details.deprecatedId, 'background-new');
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM submission_defs sd JOIN submissions s ON s.id=sd."submissionId" WHERE s."instanceId"='background-new'`), 2);
    const follow = Buffer.from(edited.toString().replace('<instanceID>background-edited</instanceID>', '<instanceID>background-next</instanceID>').replace('<deprecatedID>background-new</deprecatedID>', '<deprecatedID>background-edited</deprecatedID>'));
    const p = await xml.parse(follow); const next = { ...body, id: randomUUID(), manifest: { ...p.manifest, deprecatedId: p.deprecatedId, baseSha256: xml.digest(edited) } };
    await as(owner, 'post').send(next).expect(200);
    const competing = Buffer.from(follow.toString().replace('background-next', 'background-competing'));
    await service.post('/v1/projects/1/submission').set('Authorization', `Bearer ${owner.token}`).set('X-OpenRosa-Version', '1.0').attach('xml_submission_file', competing, { filename: 'competing.xml' })
      .expect(201);
    await deliver(next.id, follow).expect(409);
  })));
  it('uses database expiry even when a retained capability has valid bytes, scope and signing', testService(async (service, c) => withSigning(async keys => {
    const { owner, body, as, deliver } = await setup(service); const issued = (await as(owner, 'post').send(body).expect(200)).body;
    const id = randomUUID(); const expiresAt = new Date(Date.now() - 60000).toISOString(); const details = { ...JSON.parse(Buffer.from(issued.authorization.attestation.payload, 'base64url')), id, issuedAt: new Date(Date.now() - 120000).toISOString(), expiresAt };
    const payload = Buffer.from(JSON.stringify(details)); const attestation = { ...issued.authorization.attestation, payload: payload.toString('base64url'), signature: sign('sha256', payload, { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url') };
    await c.db.query(sql`INSERT INTO field_data_xml_background(id,"targetId","ownerId","tokenHash","requestHash","expiresAt",attestation) VALUES(${id},${issued.target.id},${owner.id},${body.tokenHash},${'f'.repeat(64)},${expiresAt},${JSON.stringify(attestation)})`);
    await deliver(id).expect(404); assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM submissions WHERE "instanceId"='background-new'`), 0);
  })));
  it('serializes cancellation against delivery and retains nonempty append-only history on rollback', testServiceFullTrx(async (service, c) => withSigning(async () => {
    const { owner, body, as, deliver } = await setup(service); await as(owner, 'post').send(body).expect(200);
    const responses = await Promise.all([deliver(body.id), as(owner, 'post', `/${body.id}/revoke`).send({ requestId: randomUUID(), reason: 'Stop this exact-file background capability during delivery.' })]);
    assert.ok([200, 404].includes(responses[0].status)); assert.equal(responses[1].status, 200); await deliver(body.id).expect(404);
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM submissions WHERE "instanceId"='background-new'`), responses[0].status === 200 ? 1 : 0);
    const { knexConnect } = require('../../../lib/model/knex-migrator'); const migration = require('../../../lib/model/migrations/20261026-03-xml-background'); const db = knexConnect(require('config').get('test.database'));
    try { await db.transaction(async trx => { await migration.down(trx); await migration.up(trx); }); } finally { await db.destroy(); }
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_xml_background WHERE id=${body.id}`), 1);
    await assert.rejects(c.db.query(sql`DELETE FROM field_data_xml_background WHERE id=${body.id}`));
  })));
  it('acknowledges exact ordinary native receipt without changing its bytes or original receipt time', testService(async (service, c) => withSigning(async () => {
    const { owner, bytes, body, as, deliver } = await setup(service);
    await service.post('/v1/projects/1/submission').set('Authorization', `Bearer ${owner.token}`).set('X-OpenRosa-Version', '1.0').attach('xml_submission_file', bytes, { filename: 'submission.xml' })
      .expect(201);
    const before = await c.db.one(sql`SELECT sd.id,sd."createdAt",sd.xml FROM submission_defs sd JOIN submissions s ON s.id=sd."submissionId" WHERE s."instanceId"='background-new' AND sd.current`);
    await as(owner, 'post').send(body).expect(200); const accepted = (await deliver(body.id).expect(200)).body;
    assert.equal(accepted.events[0].details.alreadyReceived, true); assert.equal(accepted.events[0].details.submissionDefId, before.id); assert.equal(accepted.events[0].details.submissionReceivedAt, new Date(before.createdAt).toISOString()); assert.equal(xml.digest(before.xml), body.manifest.sha256);
  })));
  it('retains fresh encrypted-edit indices and allows its missing ciphertext through the existing media transport', testService(async (service, c) => withSigning(async () => {
    const { owner, body, as, deliver } = await setup(service);
    const original = Buffer.from('<data id="simple"><base64EncryptedKey>a2V5</base64EncryptedKey><encryptedXmlFile>submission.xml.enc</encryptedXmlFile><media><file>photo.jpg.enc</file></media><base64EncryptedElementSignature>c2ln</base64EncryptedElementSignature><meta><instanceID>background-sealed-before</instanceID></meta></data>');
    await service.post('/v1/projects/1/submission').set('Authorization', `Bearer ${owner.token}`).set('X-OpenRosa-Version', '1.0').attach('xml_submission_file', original, { filename: 'submission.xml' })
      .attach('submission.xml.enc', Buffer.from('old ciphertext'), { filename: 'submission.xml.enc' })
      .expect(201);
    const bytes = Buffer.from(original.toString().replace('a2V5', 'bmV3LWtleQ==').replace('<instanceID>background-sealed-before</instanceID>', '<instanceID>background-sealed-after</instanceID><deprecatedID>background-sealed-before</deprecatedID>'));
    const parsed = await xml.parse(bytes); const manifest = { ...parsed.manifest, deprecatedId: parsed.deprecatedId, baseSha256: xml.digest(original) };
    await as(owner, 'post').send({ ...body, manifest }).expect(200); const accepted = (await deliver(body.id, bytes).expect(200)).body;
    const files = await c.db.any(sql`SELECT name,index,"blobId" FROM submission_attachments WHERE "submissionDefId"=${accepted.events[0].details.submissionDefId} ORDER BY index`);
    assert.deepEqual(files, [{ name: 'photo.jpg.enc', index: 0, blobId: null }, { name: 'submission.xml.enc', index: 1, blobId: null }]);
    const mediaRoot = '/v1/field-data/app-user/media-uploads'; const data = Buffer.from([0, 255, 254, 128]); const transfer = { id: randomUUID(), xmlFormId: 'simple', instanceId: 'background-sealed-after', name: 'submission.xml.enc', size: data.length, sha256: xml.digest(data), contentType: 'application/octet-stream', priority: 2 };
    const request = (method, path = '') => service[method](mediaRoot + path).set('Authorization', `Bearer ${owner.token}`);
    await request('post').send(transfer).expect(200); await request('put', `/${transfer.id}/chunks/0`).set('Content-Type', 'application/octet-stream').set('X-Chunk-Sha256', transfer.sha256).send(data)
      .expect(200); await request('post', `/${transfer.id}/complete`).expect(200);
    const stored = await c.db.oneFirst(sql`SELECT b.content FROM submission_attachments sa JOIN blobs b ON b.id=sa."blobId" WHERE sa."submissionDefId"=${accepted.events[0].details.submissionDefId} AND sa.name='submission.xml.enc'`); assert.equal(xml.digest(stored), transfer.sha256);
  })));

});
