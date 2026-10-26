// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
/* eslint-disable no-await-in-loop */
const assert = require('node:assert/strict');
const { generateKeyPairSync, randomUUID } = require('node:crypto');
const { sql } = require('slonik');
const { testService, testServiceFullTrx } = require('../setup');
const testData = require('../../data/xml');
const xml = require('../../../lib/util/xml-couriers');
const root = '/v1/field-data/app-user/xml-couriers';
const withSigning = async action => {
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const saved = { key: process.env.FIELD_DATA_OFFLINE_SIGNING_KEY, origin: process.env.FIELD_DATA_OFFLINE_ORIGIN };
  process.env.FIELD_DATA_OFFLINE_SIGNING_KEY = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }); process.env.FIELD_DATA_OFFLINE_ORIGIN = 'https://xml-courier.example';
  try { await action(keys); } finally {
    for (const [name, value] of [['FIELD_DATA_OFFLINE_SIGNING_KEY', saved.key], ['FIELD_DATA_OFFLINE_ORIGIN', saved.origin]]) { if (value == null) delete process.env[name]; else process.env[name] = value; }
  }
};
const setup = async service => {
  const alice = await service.login('alice');
  const owner = (await alice.post('/v1/projects/1/app-users').send({ displayName: 'Original collector' }).expect(200)).body;
  const courier = (await alice.post('/v1/projects/1/app-users').send({ displayName: 'XML courier' }).expect(200)).body;
  await alice.post(`/v1/projects/1/forms/simple/assignments/app-user/${owner.id}`).expect(200);
  const data = Buffer.from(testData.instances.simple.one.replace('one</instanceID>', 'xml-courier-new</instanceID>'));
  const { manifest } = await xml.parse(data);
  const body = { requestId: randomUUID(), courierId: courier.id, minutes: 60, manifest };
  const as = (user, method, path = '') => service[method](`${root}${path}`).set('Authorization', `Bearer ${user.token}`);
  const deliver = (user, id, bytes = data) => as(user, 'put', `/${id}/deliver`).set('Content-Type', 'application/octet-stream').send(bytes);
  return { alice, owner, courier, data, manifest, body, as, deliver };
};
describe('api: XML courier delivery', () => {
  it('authorizes metadata only, preserves native collector attribution and records exact idempotent courier delivery', testService(async (service, c) => withSigning(async keys => {
    const { alice, owner, courier, data, body, as, deliver } = await setup(service);
    const issued = (await as(owner, 'post').send(body).expect(200)).body;
    assert.equal(JSON.stringify(issued).includes('<data'), false);
    const { id } = issued.grant;
    assert.equal((await as(owner, 'post').send(body).expect(200)).body.grant.id, id);
    await as(owner, 'post').send({ ...body, minutes: 5 }).expect(409);
    await as(courier, 'get', `/${id}`).expect(200);
    await deliver(owner, id).expect(404);
    const accepted = (await deliver(courier, id).expect(200)).body;
    assert.equal(accepted.events[0].details.receivedBy, courier.id); assert.equal(accepted.events[0].details.ownerId, owner.id);
    assert.equal(accepted.events[0].details.alreadyReceived, false);
    // eslint-disable-next-line import/extensions, import/no-relative-packages
    const { verifyXmlCourierProof } = await import('../../../../../cloudflare/verify-xml-courier.mjs');
    const pins = { issuer: 'https://xml-courier.example', projectId: 1, publicKeys: [keys.publicKey.export({ format: 'jwk' })] };
    assert.equal(verifyXmlCourierProof(accepted, pins).events[0].receivedBy, courier.id);
    assert.throws(() => verifyXmlCourierProof(accepted, { ...pins, projectId: 2 }));
    assert.throws(() => verifyXmlCourierProof({ ...accepted, target: { ...accepted.target, manifest: { ...accepted.target.manifest, size: 2 } } }, pins));
    const recovered = (await as(owner, 'get', `?xmlFormId=simple&instanceId=${encodeURIComponent(body.manifest.instanceId)}`).expect(200)).body; assert.equal(recovered.items[0].grant.id, id);
    await deliver(courier, id).expect(200);
    const native = (await alice.get('/v1/projects/1/forms/simple/submissions/xml-courier-new').expect(200)).body;
    assert.equal(native.submitterId, owner.id);
    const source = await c.db.one(sql`SELECT sd.xml,p."integrityHash",p."sourceRef" FROM submission_defs sd JOIN field_data_submission_provenance p ON p."submissionDefId"=sd.id WHERE sd.id=${accepted.events[0].details.submissionDefId}`);
    assert.equal(xml.digest(source.xml), xml.digest(data)); assert.equal(source.integrityHash, body.manifest.sha256); assert.equal(source.sourceRef, `xml-courier:${id}`);
    const audit = await c.db.one(sql`SELECT "actorId" FROM audits WHERE action='field_data.xml.courier.delivery' AND details->>'grantId'=${id}`); assert.equal(audit.actorId, courier.id);
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_xml_courier_events WHERE "targetId"=${issued.target.id} AND kind='delivery'`), 1);
    await assert.rejects(c.db.query(sql`UPDATE field_data_xml_courier_events SET details='{}'::jsonb WHERE "targetId"=${issued.target.id}`));
  })));
  it('refuses changed XML and conflicting native owners/bytes while acknowledging exact prior native receipt', testService(async service => withSigning(async () => {
    const { alice, owner, courier, data, body, as, deliver } = await setup(service);
    const issued = (await as(owner, 'post').send(body).expect(200)).body;
    await deliver(courier, issued.grant.id, Buffer.from(data.toString().replace('</data>', '<extra>changed</extra></data>'))).expect(409);
    await service.post('/v1/projects/1/submission').set('Authorization', `Bearer ${owner.token}`).set('X-OpenRosa-Version', '1.0').attach('xml_submission_file', data, { filename: 'submission.xml' })
      .expect(201);
    const accepted = (await deliver(courier, issued.grant.id).expect(200)).body; assert.equal(accepted.events[0].details.alreadyReceived, true);
    const secondData = Buffer.from(data.toString().replace('xml-courier-new', 'xml-courier-conflict'));
    const second = (await as(owner, 'post').send({ ...body, requestId: randomUUID(), manifest: (await xml.parse(secondData)).manifest }).expect(200)).body;
    // A different collector can use the ordinary native path, but its data is never overwritten.
    await alice.post(`/v1/projects/1/forms/simple/assignments/app-user/${courier.id}`).expect(200);
    await service.post('/v1/projects/1/submission').set('Authorization', `Bearer ${courier.token}`).set('X-OpenRosa-Version', '1.0').attach('xml_submission_file', secondData, { filename: 'submission.xml' })
      .expect(201);
    await deliver(courier, second.grant.id, secondData).expect(409);
  })));
  it('rechecks source grants and supports permanent unsigned revocation and a replacement recipient grant', testService(async service => withSigning(async () => {
    const { alice, owner, courier, body, as, deliver } = await setup(service);
    const issued = (await as(owner, 'post').send(body).expect(200)).body;
    await alice.delete(`/v1/projects/1/forms/simple/assignments/app-user/${owner.id}`).expect(200);
    await deliver(courier, issued.grant.id).expect(404); await as(courier, 'get', `/${issued.grant.id}`).expect(404);
    const signing = process.env.FIELD_DATA_OFFLINE_SIGNING_KEY; delete process.env.FIELD_DATA_OFFLINE_SIGNING_KEY;
    const revoke = { requestId: randomUUID(), reason: 'Withdraw this recipient permission before transport.' };
    const revoked = (await as(owner, 'post', `/${issued.grant.id}/revoke`).send(revoke).expect(200)).body;
    assert.equal(revoked.event.attestation, null); await as(owner, 'post', `/${issued.grant.id}/revoke`).send(revoke).expect(200);
    process.env.FIELD_DATA_OFFLINE_SIGNING_KEY = signing;
    await alice.post(`/v1/projects/1/forms/simple/assignments/app-user/${owner.id}`).expect(200);
    await deliver(courier, issued.grant.id).expect(404);
    const nextCourier = (await alice.post('/v1/projects/1/app-users').send({ displayName: 'Replacement courier' }).expect(200)).body;
    const replacement = (await as(owner, 'post').send({ ...body, requestId: randomUUID(), courierId: nextCourier.id }).expect(200)).body;
    assert.equal(replacement.target.id, issued.target.id); assert.notEqual(replacement.grant.id, issued.grant.id);
    await deliver(nextCourier, replacement.grant.id).expect(200);
    const visible = (await as(courier, 'get', `?xmlFormId=simple&instanceId=${encodeURIComponent(body.manifest.instanceId)}`).expect(200)).body.items; assert.equal(visible.length, 1); assert.equal(visible[0].grant.id, issued.grant.id);
  })));
  it('serializes concurrent grants/delivery, keeps replay tombstones after purge and retains nonempty history on rollback', testServiceFullTrx(async (service, c) => withSigning(async () => {
    const { owner, courier, body, as, deliver } = await setup(service);
    const grants = await Promise.all([as(owner, 'post').send(body), as(owner, 'post').send(body)]); assert.deepEqual(grants.map(r => r.status), [200, 200]);
    const issued = grants[0].body; assert.equal(issued.grant.id, grants[1].body.grant.id);
    const delivered = await Promise.all([deliver(courier, issued.grant.id), deliver(courier, issued.grant.id)]); assert.deepEqual(delivered.map(r => r.status), [200, 200]);
    await c.db.query(sql`DELETE FROM submissions WHERE "instanceId"='xml-courier-new'`);
    await deliver(courier, issued.grant.id).expect(404);
    await as(owner, 'post').send({ ...body, requestId: randomUUID() }).expect(409);
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_xml_courier_events WHERE kind='delivery'`), 1);
    const { knexConnect } = require('../../../lib/model/knex-migrator'); const config = require('config'); const db = knexConnect(config.get('test.database')); const migration = require('../../../lib/model/migrations/20261026-02-xml-couriers');
    try { await db.transaction(async trx => { await migration.down(trx); await migration.up(trx); }); } finally { await db.destroy(); }
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_xml_courier_targets`), 1);
  })));
});

describe('api: XML courier integration boundaries', () => {
  it('creates native missing-media placeholders attributed to the collector and permits subsequent scoped media courier recovery', testService(async service => withSigning(async () => {
    const { alice, owner, courier, body, as, deliver } = await setup(service);
    await alice.post('/v1/projects/1/forms?publish=true').set('Content-Type', 'application/xml').send(testData.forms.binaryType).expect(200);
    await alice.post(`/v1/projects/1/forms/binaryType/assignments/app-user/${owner.id}`).expect(200);
    const bytes = Buffer.from(testData.instances.binaryType.both); const { manifest } = await xml.parse(bytes);
    const issued = (await as(owner, 'post').send({ ...body, requestId: randomUUID(), manifest }).expect(200)).body;
    await deliver(courier, issued.grant.id, bytes).expect(200);
    const media = Buffer.from('media transported after courier XML'); const transfer = { id: randomUUID(), xmlFormId: 'binaryType', instanceId: 'both', name: 'my_file1.mp4', size: media.length, sha256: xml.digest(media), contentType: 'video/mp4', priority: 2 };
    const mediaRoot = '/v1/field-data/app-user/media-uploads';
    const request = (user, method, path = '') => service[method](mediaRoot + path).set('Authorization', `Bearer ${user.token}`);
    await request(owner, 'post').send(transfer).expect(200);
    await request(owner, 'post', `/${transfer.id}/courier`).send({ requestId: randomUUID(), courierId: courier.id, minutes: 60 }).expect(200);
    await request(courier, 'put', `/${transfer.id}/chunks/0`).set('Content-Type', 'application/octet-stream').set('X-Chunk-Sha256', transfer.sha256).send(media)
      .expect(200);
    await request(courier, 'post', `/${transfer.id}/complete`).expect(200);
    const received = await alice.get('/v1/projects/1/forms/binaryType/submissions/both/attachments/my_file1.mp4').expect(200); assert.equal(xml.digest(received.body), transfer.sha256);
  })));
  it('denies unrelated projects, malformed XML, signing outages and closed forms without widening collection rights', testService(async service => withSigning(async () => {
    const { alice, owner, courier, data, body, as, deliver } = await setup(service);
    await service.post(root).send(body).expect(401); await alice.post(root).send(body).expect(403);
    const project = (await alice.post('/v1/projects').send({ name: 'Other XML project' }).expect(200)).body;
    const stranger = (await alice.post(`/v1/projects/${project.id}/app-users`).send({ displayName: 'Other courier' }).expect(200)).body;
    await as(owner, 'post').send({ ...body, courierId: stranger.id }).expect(400);
    await as(owner, 'post').send({ ...body, manifest: { ...body.manifest, size: xml.LIMIT + 1 } }).expect(400);
    await as(owner, 'post').send({ ...body, manifest: { ...body.manifest, version: 'not-published' } }).expect(404);
    const issued = (await as(owner, 'post').send(body).expect(200)).body;
    await as(stranger, 'get', `/${issued.grant.id}`).expect(404);
    const signing = process.env.FIELD_DATA_OFFLINE_SIGNING_KEY; delete process.env.FIELD_DATA_OFFLINE_SIGNING_KEY;
    await deliver(courier, issued.grant.id).expect(400); process.env.FIELD_DATA_OFFLINE_SIGNING_KEY = signing;
    for (const bytes of [Buffer.from('<broken'), Buffer.from([0xff]), Buffer.from(`<!DOCTYPE data>${data.toString()}`), Buffer.from(data.toString().replace('</meta>', '<instanceID>two</instanceID></meta>'))]) await deliver(courier, issued.grant.id, bytes).expect(400);
    await as(courier, 'put', `/${issued.grant.id}/deliver`).set('Content-Type', 'text/xml').send(data).expect(400);
    await alice.patch('/v1/projects/1/forms/simple').send({ state: 'closed' }).expect(200);
    await deliver(courier, issued.grant.id).expect(404);
    await as(owner, 'post', `/${issued.grant.id}/revoke`).send({ requestId: randomUUID(), reason: 'Revoke permission after the form was closed.' }).expect(200);
  })));
  it('enforces database grant expiry independently of client clocks', testService(async (service, c) => withSigning(async () => {
    const { owner, courier, body, as, deliver } = await setup(service);
    const issued = (await as(owner, 'post').send(body).expect(200)).body;
    await as(owner, 'post', `/${issued.grant.id}/revoke`).send({ requestId: randomUUID(), reason: 'The earlier courier grant is no longer required.' }).expect(200);
    const id = randomUUID(); const expiresAt = new Date(Date.now() - 300000).toISOString();
    const details = { id, targetId: issued.target.id, projectId: 1, formId: issued.target.formId, formDefId: issued.target.formDefId, ownerId: owner.id, courierId: courier.id, manifest: body.manifest,
      issuedAt: new Date(Date.now() - 600000).toISOString(), expiresAt };
    // Retained historical grant fixture: application roles, source and bytes remain valid.
    await c.db.query(sql`INSERT INTO field_data_xml_couriers(id,"targetId","ownerId","courierId","requestId","requestHash","expiresAt",attestation)
      VALUES(${id},${issued.target.id},${owner.id},${courier.id},${randomUUID()},${'a'.repeat(64)},${expiresAt},${JSON.stringify(xml.attest(xml.config(), 'grant', details))})`);
    await deliver(courier, id).expect(404);
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM submissions WHERE "instanceId"='xml-courier-new'`), 0);
  })));
});

describe('api: XML courier competing delivery', () => {
  it('serializes permanent revocation against creation without partial native or custody records', testServiceFullTrx(async (service, c) => withSigning(async () => {
    const { owner, courier, body, as, deliver } = await setup(service); const issued = (await as(owner, 'post').send(body).expect(200)).body;
    const results = await Promise.all([deliver(courier, issued.grant.id), as(owner, 'post', `/${issued.grant.id}/revoke`).send({ requestId: randomUUID(), reason: 'Revoke the XML handoff during delivery.' })]);
    assert.equal(results[1].status, 200); assert([200, 404].includes(results[0].status));
    await deliver(courier, issued.grant.id).expect(404);
    const expected = results[0].status === 200 ? 1 : 0;
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM submissions WHERE "instanceId"='xml-courier-new'`), expected);
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_xml_courier_events WHERE kind='delivery'`), expected);
  })));
  it('preserves exact native XML when Collect and courier deliveries overlap', testServiceFullTrx(async (service, c) => withSigning(async () => {
    const { owner, courier, data, body, as, deliver } = await setup(service); const issued = (await as(owner, 'post').send(body).expect(200)).body;
    const results = await Promise.all([deliver(courier, issued.grant.id), service.post('/v1/projects/1/submission').set('Authorization', `Bearer ${owner.token}`).set('X-OpenRosa-Version', '1.0').attach('xml_submission_file', data, { filename: 'submission.xml' })]);
    assert([200, 409].includes(results[0].status)); assert([201, 409].includes(results[1].status)); assert(results.some(r => [200, 201].includes(r.status)));
    await deliver(courier, issued.grant.id).expect(200);
    const stored = await c.db.one(sql`SELECT sd.xml,sd."submitterId" FROM submission_defs sd JOIN submissions s ON s.id=sd."submissionId" WHERE s."instanceId"='xml-courier-new' AND sd.current`);
    assert.equal(stored.submitterId, owner.id); assert.equal(xml.digest(stored.xml), xml.digest(data));
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_xml_courier_events WHERE kind='delivery'`), 1);
  })));
});
