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

  it('delivers encrypted envelopes without decrypting and recovers their exact indexed ciphertext through a media courier', testService(async (service, c) => withSigning(async () => {
    const { alice, owner, courier, body, as, deliver } = await setup(service);
    const bytes = Buffer.from('<data id="simple"><base64EncryptedKey>a2V5</base64EncryptedKey><encryptedXmlFile>submission.xml.enc</encryptedXmlFile><media><file>photo.jpg.enc</file></media><base64EncryptedElementSignature>c2ln</base64EncryptedElementSignature><meta><instanceID>sealed-courier</instanceID></meta></data>');
    const { manifest } = await xml.parse(bytes);
    const issued = (await as(owner, 'post').send({ ...body, requestId: randomUUID(), manifest }).expect(200)).body;
    const accepted = (await deliver(courier, issued.grant.id, bytes).expect(200)).body;
    await deliver(courier, issued.grant.id, bytes).expect(200);
    const defId = accepted.events[0].details.submissionDefId;
    const source = await c.db.one(sql`SELECT xml,"localKey","encDataAttachmentName",signature,"submitterId" FROM submission_defs WHERE id=${defId}`);
    assert.equal(xml.digest(source.xml), manifest.sha256); assert.equal(source.localKey, 'a2V5'); assert.equal(source.encDataAttachmentName, 'submission.xml.enc'); assert.equal(source.signature, 'c2ln'); assert.equal(source.submitterId, owner.id);
    const attachments = await c.db.any(sql`SELECT name,index,"blobId" FROM submission_attachments WHERE "submissionDefId"=${defId} ORDER BY index`);
    assert.deepEqual(attachments, [{ name: 'photo.jpg.enc', index: 0, blobId: null }, { name: 'submission.xml.enc', index: 1, blobId: null }]);
    const mediaRoot = '/v1/field-data/app-user/media-uploads';
    const request = (user, method, path = '') => service[method](mediaRoot + path).set('Authorization', `Bearer ${user.token}`);
    for (const attachment of attachments) {
      const ciphertext = Buffer.from([0, 255, 128, 42, attachment.index]);
      const transfer = { id: randomUUID(), xmlFormId: 'simple', instanceId: 'sealed-courier', name: attachment.name, size: ciphertext.length, sha256: xml.digest(ciphertext), contentType: 'application/octet-stream', priority: 2 };
      await request(owner, 'post').send(transfer).expect(200);
      await request(owner, 'post', `/${transfer.id}/courier`).send({ requestId: randomUUID(), courierId: courier.id, minutes: 60 }).expect(200);
      await request(courier, 'put', `/${transfer.id}/chunks/0`).set('Content-Type', 'application/octet-stream').set('X-Chunk-Sha256', transfer.sha256).send(ciphertext)
        .expect(200);
      await request(courier, 'post', `/${transfer.id}/complete`).expect(200);
      const received = await alice.get(`/v1/projects/1/forms/simple/submissions/sealed-courier/attachments/${attachment.name}`).expect(200);
      assert.equal(xml.digest(received.body), transfer.sha256);
    }
    assert.equal((await as(courier, 'get', `/${issued.grant.id}`).expect(200)).body.sourceAvailable, true);
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


const editSetup = async service => {
  const f = await setup(service);
  await service.post('/v1/projects/1/submission').set('Authorization', `Bearer ${f.owner.token}`).set('X-OpenRosa-Version', '1.0').attach('xml_submission_file', f.data, { filename: 'submission.xml' })
    .expect(201);
  const editBytes = Buffer.from(f.data.toString().replace('xml-courier-new', 'xml-courier-edited').replace('</meta>', '<deprecatedID>xml-courier-new</deprecatedID></meta>'));
  const parsed = await xml.parse(editBytes);
  const editManifest = { ...parsed.manifest, deprecatedId: parsed.deprecatedId, baseSha256: xml.digest(f.data) };
  const editBody = { ...f.body, manifest: editManifest };
  return { ...f, editBytes, editManifest, editBody };
};
describe('api: version-bound XML edit couriers', () => {
  it('reviews owned prior metadata, binds its exact bytes and retains native edit lineage and signed v2 custody', testService(async (service, c) => withSigning(async keys => {
    const { owner, courier, editBytes, editManifest, editBody, as, deliver } = await editSetup(service);
    const query = '/edit-base?xmlFormId=simple&version=&deprecatedId=xml-courier-new&instanceId=xml-courier-edited';
    const reviewed = (await as(owner, 'get', query).expect(200)).body;
    assert.equal(reviewed.baseSha256, editManifest.baseSha256); assert.equal(reviewed.current, true); assert.equal(Object.hasOwn(reviewed, 'xml'), false);
    await as(courier, 'get', query).expect(404);
    await as(owner, 'post').send({ ...editBody, requestId: randomUUID(), manifest: { ...editManifest, baseSha256: '0'.repeat(64) } }).expect(409);
    const issued = (await as(owner, 'post').send(editBody).expect(200)).body;
    assert.equal((await as(owner, 'post').send(editBody).expect(200)).body.grant.id, issued.grant.id);
    const accepted = (await deliver(courier, issued.grant.id, editBytes).expect(200)).body;
    const receipt = accepted.events[0].details;
    assert.equal(receipt.baseSubmissionDefId, reviewed.baseSubmissionDefId); assert.equal(receipt.baseSha256, editManifest.baseSha256); assert.equal(accepted.sourceAvailable, true);
    await deliver(courier, issued.grant.id, editBytes).expect(200);
    const versions = await c.db.any(sql`SELECT sd.id,sd.current,sd.root,sd."submitterId",cv.ordinal,previous."submissionDefId" AS "baseId" FROM submission_defs sd JOIN field_data_claim_versions cv ON cv."submissionDefId"=sd.id LEFT JOIN field_data_claim_versions previous ON previous.id=cv."previousVersionId" WHERE sd.id IN (${reviewed.baseSubmissionDefId},${receipt.submissionDefId}) ORDER BY cv.ordinal`);
    assert.equal(versions.length, 2); assert.equal(versions[0].current, false); assert.equal(versions[1].current, true); assert.equal(versions[1].root, null); assert.equal(versions[1].submitterId, owner.id); assert.equal(versions[1].baseId, versions[0].id);
    const audit = await c.db.one(sql`SELECT "actorId" FROM audits WHERE action='submission.update.version' AND details->>'submissionDefId'=${String(receipt.submissionDefId)}`); assert.equal(audit.actorId, owner.id);
    // eslint-disable-next-line import/extensions, import/no-relative-packages
    const { verifyXmlCourierProof } = await import('../../../../../cloudflare/verify-xml-courier.mjs');
    const pins = { issuer: 'https://xml-courier.example', projectId: 1, publicKeys: [keys.publicKey.export({ format: 'jwk' })] };
    const checked = verifyXmlCourierProof(accepted, pins); assert.equal(checked.grant.purpose, 'field-data.xml-courier-grant@2');
    assert.equal(checked.events[0].baseSubmissionDefId, reviewed.baseSubmissionDefId);
    const forged = JSON.parse(JSON.stringify(accepted)); forged.target.manifest.baseSha256 = 'f'.repeat(64); assert.throws(() => verifyXmlCourierProof(forged, pins));
    const wrongLineage = JSON.parse(JSON.stringify(accepted)); wrongLineage.events[0].details.baseSubmissionDefId += 1; wrongLineage.events[0].attestation = xml.attest(xml.config(), 'delivery', wrongLineage.events[0].details, true); assert.throws(() => verifyXmlCourierProof(wrongLineage, pins));
    await as(owner, 'post', `/${issued.grant.id}/revoke`).send({ requestId: randomUUID(), reason: 'Close this edit courier permission after acknowledgement.' }).expect(200);
    const revoked = (await as(owner, 'get', `/${issued.grant.id}`).expect(200)).body; assert.equal(verifyXmlCourierProof(revoked, pins).revocation, 'recorded'); await deliver(courier, issued.grant.id, editBytes).expect(404);
  })));
  it('refuses a stale base after a competing native edit and cannot grant against another collector’s source', testService(async (service, c) => withSigning(async () => {
    const { alice, owner, courier, editBytes, editManifest, editBody, as, deliver } = await editSetup(service);
    await alice.post(`/v1/projects/1/forms/simple/assignments/app-user/${courier.id}`).expect(200);
    await as(courier, 'post').send({ ...editBody, courierId: owner.id }).expect(404);
    const issued = (await as(owner, 'post').send(editBody).expect(200)).body;
    const competing = Buffer.from(editBytes.toString().replace('xml-courier-edited', 'native-competing-edit'));
    await service.post('/v1/projects/1/submission').set('Authorization', `Bearer ${owner.token}`).set('X-OpenRosa-Version', '1.0').attach('xml_submission_file', competing, { filename: 'edit.xml' })
      .expect(201);
    await deliver(courier, issued.grant.id, editBytes).expect(409);
    await as(owner, 'post').send({ ...editBody, requestId: randomUUID(), manifest: { ...editManifest, instanceId: 'later-attempt' } }).expect(409);
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_xml_courier_events WHERE "grantId"=${issued.grant.id} AND kind='delivery'`), 0);
    const current = await c.db.one(sql`SELECT sd."instanceId" FROM submission_defs sd JOIN submissions s ON s.id=sd."submissionId" WHERE s."instanceId"='xml-courier-new' AND sd.current`); assert.equal(current.instanceId, 'native-competing-edit');
  })));
  it('serializes competing edit couriers and exact retries without creating two native versions', testServiceFullTrx(async (service, c) => withSigning(async () => {
    const { owner, courier, editBytes, editBody, as, deliver } = await editSetup(service);
    const issued = (await as(owner, 'post').send(editBody).expect(200)).body;
    const other = Buffer.from(editBytes.toString().replace('xml-courier-edited', 'another-courier-edit'));
    const otherManifest = { ...(await xml.parse(other)).manifest, deprecatedId: editBody.manifest.deprecatedId, baseSha256: editBody.manifest.baseSha256 };
    const otherGrant = (await as(owner, 'post').send({ ...editBody, requestId: randomUUID(), manifest: otherManifest }).expect(200)).body;
    const responses = await Promise.all([deliver(courier, issued.grant.id, editBytes), deliver(courier, otherGrant.grant.id, other)]);
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
    const winner = responses[0].status === 200 ? { id: issued.grant.id, bytes: editBytes } : { id: otherGrant.grant.id, bytes: other };
    const retries = await Promise.all([deliver(courier, winner.id, winner.bytes), deliver(courier, winner.id, winner.bytes)]); assert.deepEqual(retries.map(r => r.status), [200, 200]);
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM submission_defs sd JOIN submissions s ON s.id=sd."submissionId" WHERE s."instanceId"='xml-courier-new'`), 2);
  })));
  it('acknowledges an exact already-received native edit and preserves historical proofs after purge', testService(async (service, c) => withSigning(async () => {
    const { owner, courier, editBytes, editBody, as, deliver } = await editSetup(service);
    await service.post('/v1/projects/1/submission').set('Authorization', `Bearer ${owner.token}`).set('X-OpenRosa-Version', '1.0').attach('xml_submission_file', editBytes, { filename: 'edit.xml' })
      .expect(201);
    const issued = (await as(owner, 'post').send(editBody).expect(200)).body;
    const accepted = (await deliver(courier, issued.grant.id, editBytes).expect(200)).body; assert.equal(accepted.events[0].details.alreadyReceived, true);
    await c.db.query(sql`DELETE FROM submissions WHERE "instanceId"='xml-courier-new'`);
    const historical = (await as(owner, 'get', `/${issued.grant.id}`).expect(200)).body; assert.equal(historical.sourceAvailable, false);
    await deliver(courier, issued.grant.id, editBytes).expect(404);
    await as(owner, 'post').send({ ...editBody, requestId: randomUUID() }).expect(409);
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_xml_courier_events WHERE "grantId"=${issued.grant.id} AND kind='delivery'`), 1);
  })));
  it('retains unchanged ordinary media and creates recoverable placeholders for a courier edit’s new files', testService(async (service, c) => withSigning(async () => {
    const { alice, owner, courier, body, as, deliver } = await setup(service);
    await alice.post('/v1/projects/1/forms?publish=true').set('Content-Type', 'application/xml').send(testData.forms.binaryType).expect(200);
    await alice.post(`/v1/projects/1/forms/binaryType/assignments/app-user/${owner.id}`).expect(200);
    const before = Buffer.from(testData.instances.binaryType.both); const retained = Buffer.from('retain this original media');
    await service.post('/v1/projects/1/submission').set('Authorization', `Bearer ${owner.token}`).set('X-OpenRosa-Version', '1.0').attach('xml_submission_file', before, { filename: 'submission.xml' })
      .attach('my_file1.mp4', retained, { filename: 'my_file1.mp4' })
      .expect(201);
    const bytes = Buffer.from(before.toString().replace('<instanceID>both</instanceID>', '<instanceID>binary-edited</instanceID><deprecatedID>both</deprecatedID>').replace('here_is_file2.jpg', 'new_file.mp4'));
    const parsed = await xml.parse(bytes); const manifest = { ...parsed.manifest, deprecatedId: parsed.deprecatedId, baseSha256: xml.digest(before) };
    const issued = (await as(owner, 'post').send({ ...body, requestId: randomUUID(), manifest }).expect(200)).body;
    const accepted = (await deliver(courier, issued.grant.id, bytes).expect(200)).body; const defId = accepted.events[0].details.submissionDefId;
    const files = await c.db.any(sql`SELECT sa.name,sa."blobId",b.content FROM submission_attachments sa LEFT JOIN blobs b ON b.id=sa."blobId" WHERE sa."submissionDefId"=${defId} ORDER BY sa.name`);
    assert.equal(xml.digest(files[0].content), xml.digest(retained)); assert.equal(files[1].name, 'new_file.mp4'); assert.equal(files[1].blobId, null);
    const mediaRoot = '/v1/field-data/app-user/media-uploads'; const request = (user, method, path = '') => service[method](mediaRoot + path).set('Authorization', `Bearer ${user.token}`);
    const media = Buffer.from('new media after version-bound edit'); const transfer = { id: randomUUID(), xmlFormId: 'binaryType', instanceId: 'binary-edited', name: 'new_file.mp4', size: media.length, sha256: xml.digest(media), contentType: 'video/mp4', priority: 2 };
    await request(owner, 'post').send(transfer).expect(200); await request(owner, 'post', `/${transfer.id}/courier`).send({ requestId: randomUUID(), courierId: courier.id, minutes: 60 }).expect(200);
    await request(courier, 'put', `/${transfer.id}/chunks/0`).set('Content-Type', 'application/octet-stream').set('X-Chunk-Sha256', transfer.sha256).send(media)
      .expect(200);
    await request(courier, 'post', `/${transfer.id}/complete`).expect(200);
    const stored = await c.db.oneFirst(sql`SELECT b.content FROM submission_attachments sa JOIN blobs b ON b.id=sa."blobId" WHERE sa."submissionDefId"=${defId} AND sa.name='new_file.mp4'`); assert.equal(xml.digest(stored), transfer.sha256);
  })));
  it('does not inherit old ciphertext across an encrypted edit and allows its independently authorized fresh files', testService(async (service, c) => withSigning(async () => {
    const { owner, courier, body, as, deliver } = await setup(service);
    const before = Buffer.from('<data id="simple"><base64EncryptedKey>a2V5</base64EncryptedKey><encryptedXmlFile>submission.xml.enc</encryptedXmlFile><media><file>photo.jpg.enc</file></media><base64EncryptedElementSignature>c2ln</base64EncryptedElementSignature><meta><instanceID>sealed-before</instanceID></meta></data>');
    const oldCiphertext = Buffer.from([0, 10, 255]);
    await service.post('/v1/projects/1/submission').set('Authorization', `Bearer ${owner.token}`).set('X-OpenRosa-Version', '1.0').attach('xml_submission_file', before, { filename: 'submission.xml' })
      .attach('submission.xml.enc', oldCiphertext, { filename: 'submission.xml.enc' })
      .attach('photo.jpg.enc', oldCiphertext, { filename: 'photo.jpg.enc' })
      .expect(201);
    const bytes = Buffer.from(before.toString().replace('a2V5', 'bmV3LWtleQ==').replace('<instanceID>sealed-before</instanceID>', '<instanceID>sealed-after</instanceID><deprecatedID>sealed-before</deprecatedID>'));
    const parsed = await xml.parse(bytes); const manifest = { ...parsed.manifest, deprecatedId: parsed.deprecatedId, baseSha256: xml.digest(before) };
    const issued = (await as(owner, 'post').send({ ...body, requestId: randomUUID(), manifest }).expect(200)).body;
    const accepted = (await deliver(courier, issued.grant.id, bytes).expect(200)).body; const defId = accepted.events[0].details.submissionDefId;
    const files = await c.db.any(sql`SELECT name,index,"blobId" FROM submission_attachments WHERE "submissionDefId"=${defId} ORDER BY index`);
    assert.deepEqual(files, [{ name: 'photo.jpg.enc', index: 0, blobId: null }, { name: 'submission.xml.enc', index: 1, blobId: null }]);
    const mediaRoot = '/v1/field-data/app-user/media-uploads'; const request = (user, method, path = '') => service[method](mediaRoot + path).set('Authorization', `Bearer ${user.token}`);
    for (const file of files) {
      const ciphertext = Buffer.from([128, 0, 254, file.index]); const transfer = { id: randomUUID(), xmlFormId: 'simple', instanceId: 'sealed-after', name: file.name, size: ciphertext.length, sha256: xml.digest(ciphertext), contentType: 'application/octet-stream', priority: 2 };
      await request(owner, 'post').send(transfer).expect(200); await request(owner, 'post', `/${transfer.id}/courier`).send({ requestId: randomUUID(), courierId: courier.id, minutes: 60 }).expect(200);
      await request(courier, 'put', `/${transfer.id}/chunks/0`).set('Content-Type', 'application/octet-stream').set('X-Chunk-Sha256', transfer.sha256).send(ciphertext)
        .expect(200);
      await request(courier, 'post', `/${transfer.id}/complete`).expect(200);
      const stored = await c.db.oneFirst(sql`SELECT b.content FROM submission_attachments sa JOIN blobs b ON b.id=sa."blobId" WHERE sa."submissionDefId"=${defId} AND sa.name=${file.name}`); assert.equal(xml.digest(stored), transfer.sha256);
    }
    const prior = await c.db.oneFirst(sql`SELECT b.content FROM submission_attachments sa JOIN blobs b ON b.id=sa."blobId" WHERE sa."submissionDefId"=${accepted.events[0].details.baseSubmissionDefId} AND sa.name='submission.xml.enc'`); assert.equal(xml.digest(prior), xml.digest(oldCiphertext));
  })));

  it('preserves one native version when Collect and an edit courier submit the exact replacement concurrently', testServiceFullTrx(async (service, c) => withSigning(async () => {
    const { owner, courier, editBytes, editBody, as, deliver } = await editSetup(service);
    const issued = (await as(owner, 'post').send(editBody).expect(200)).body;
    const responses = await Promise.all([
      service.post('/v1/projects/1/submission').set('Authorization', `Bearer ${owner.token}`).set('X-OpenRosa-Version', '1.0').attach('xml_submission_file', editBytes, { filename: 'edit.xml' }),
      deliver(courier, issued.grant.id, editBytes)
    ]);
    assert.ok([201, 409].includes(responses[0].status)); assert.equal(responses[1].status, 200);
    await deliver(courier, issued.grant.id, editBytes).expect(200);
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM submission_defs sd JOIN submissions s ON s.id=sd."submissionId" WHERE s."instanceId"='xml-courier-new'`), 2);
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_xml_courier_events WHERE "grantId"=${issued.grant.id} AND kind='delivery'`), 1);
  })));

});
