/* eslint-disable no-await-in-loop */
// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { sql } = require('slonik');
const { testService, testServiceFullTrx } = require('../setup');
const { cellOf } = require('../../../lib/util/imagery');
const base = '/v1/projects/1/forms/geo_review'; const root = `${base}/submissions/one`; const path = `${root}/geo-assessments`;
const form = `<?xml version="1.0"?><h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml"><h:head><h:title>Geo review</h:title><model>
 <instance><data id="geo_review"><meta><instanceID/></meta><location/><photo/><audit/></data></instance>
 <bind nodeset="/data/meta/instanceID" type="string" readonly="true()" calculate="concat('uuid:', uuid())"/>
 <bind nodeset="/data/location" type="geopoint"/><bind nodeset="/data/photo" type="binary"/><bind nodeset="/data/audit" type="binary"/>
 </model></h:head><h:body><input ref="/data/location"><label>Location</label></input><upload ref="/data/photo" mediatype="image/*"><label>Photo</label></upload><upload ref="/data/audit" mediatype="text/csv"><label>Audit</label></upload></h:body></h:html>`;
const instance = (id = 'one', location = '8.4801 -13.2344 10 5') => `<data id="geo_review"><meta><instanceID>${id}</instanceID></meta><location>${location}</location><photo>photo.jpg</photo><audit>audit.csv</audit></data>`;
const reference = () => ({ kind: 'reference', title: 'Public dated imagery reference', url: 'https://images.example.test/scene', date: '2026-09-18' });
const body = (context, patch = {}) => ({ requestId: randomUUID(), revision: context.revision, sourceFingerprint: context.source.fingerprint, outcome: 'supports',
  claim: 'The claimed structure is present at the reported location.', reason: 'The visible structure corresponds to the cited imagery.', limitations: 'Season and image resolution limit interpretation; receipt time is not visit time.',
  citation: reference(), reviewedImage: true, ...patch });
const setup = async (service, c, location) => {
  const alice = await service.login('alice'); await alice.post('/v1/projects/1/forms?publish=true').set('Content-Type', 'application/xml').send(form).expect(200);
  await alice.post(`${base}/submissions`).set('Content-Type', 'application/xml').send(instance('one', location)).expect(200);
  await c.db.query(sql`UPDATE submissions SET "createdAt" = '2026-09-20T10:30:00Z' WHERE "instanceId" = 'one'`); return alice;
};
const context = async alice => (await alice.get(path).expect(200)).body;
const seed = (c, rows = [{ id: 'scene-1', at: '2026-09-18T12:00:00.000Z', cloud: 41.7 }]) => c.db.query(sql`INSERT INTO field_data_imagery_lookups
  (catalogue,collection,"cellKey","visitDay","windowDays",scenes,matched) VALUES ('https://catalogue.example.test/v1','sentinel-2-l2a',${cellOf(8.4801, -13.2344).key},'2026-09-20',30,${JSON.stringify(rows)},${rows.length})
  ON CONFLICT (catalogue,collection,"cellKey","visitDay","windowDays") DO UPDATE SET scenes = excluded.scenes, matched = excluded.matched, "fetchedAt" = clock_timestamp()`);
describe('api: reviewed geospatial verification', () => {
  const saved = {}; const originalFetch = global.fetch;
  beforeEach(() => { for (const key of ['FIELD_DATA_IMAGERY_ENABLED', 'FIELD_DATA_STAC_URL']) saved[key] = process.env[key]; process.env.FIELD_DATA_IMAGERY_ENABLED = 'false'; process.env.FIELD_DATA_STAC_URL = 'https://catalogue.example.test/v1'; });
  afterEach(() => { global.fetch = originalFetch; for (const [key, value] of Object.entries(saved)) { if (value == null) delete process.env[key]; else process.env[key] = value; } });
  it('records cited human assessments, supersedes without rewriting, retries exactly and leaves answers/review state unchanged', testService(async (service, c) => {
    const alice = await setup(service, c); const initial = await context(alice); assert.equal(initial.source.visitBasis, 'receipt'); assert.equal(initial.source.location.accuracy, 5);
    assert.equal(initial.canAssess, true); assert.equal(initial.canCheck, false); assert.equal(initial.catalogue.status, 'not-checked');
    const first = body(initial); const response = await alice.post(path).send(first).expect(200); assert.equal(response.body.item.state, 'current');
    assert.equal(response.body.item.citation.date, '2026-09-18'); assert.equal(response.headers['cache-control'], 'private, no-store');
    await alice.post(path).send(body(initial)).expect(409);
    const next = body(await context(alice), { outcome: 'conflicts', reason: 'A second inspection finds a different structure at this reference.' });
    await alice.post(path).send(next).expect(200); const view = await context(alice); assert.equal(view.revision, 2);
    assert.equal(view.items[0].state, 'current'); assert.equal(view.items[1].state, 'superseded'); assert.equal(view.items[1].reason, first.reason);
    const replay = (await alice.post(path).send(Object.fromEntries(Object.entries(first).reverse())).expect(200)).body;
    assert.equal(replay.replayed, true); assert.equal(replay.revision, 2); assert.equal(replay.item.state, 'superseded');
    await alice.post(path).send({ ...first, reason: 'Changed retry content is a new decision.' }).expect(409);
    const record = await c.db.one(sql`SELECT s."reviewState",sd.xml FROM submissions s JOIN submission_defs sd ON sd."submissionId" = s.id AND sd.current WHERE s."instanceId" = 'one'`);
    assert.equal(record.reviewState, null); assert.equal(record.xml, instance());
    const audits = JSON.stringify(await c.db.any(sql`SELECT details FROM audits WHERE action = 'field_data.geo.assessed'`));
    for (const value of [first.claim, first.reason, first.citation.url, '8.4801']) assert.equal(audits.includes(value), false);
  }));
  it('pins catalogue scene metadata and marks changes outdated while identical refreshes remain current', testService(async (service, c) => {
    const alice = await setup(service, c); await seed(c); let view = await context(alice); const scene = view.catalogue.scenes[0];
    const data = body(view, { citation: { kind: 'catalogue', sceneId: scene.id, sceneFingerprint: scene.fingerprint, url: 'https://images.example.test/scene-1' } });
    const { item } = (await alice.post(path).send(data).expect(200)).body; assert.equal(item.citation.cloud, 41.7); assert.equal(item.citation.at, '2026-09-18T12:00:00.000Z');
    await seed(c); assert.equal((await context(alice)).items[0].state, 'current');
    await seed(c, [{ id: 'scene-1', at: '2026-09-18T12:00:00.000Z', cloud: 90 }]); view = await context(alice);
    assert.equal(view.items[0].state, 'outdated'); assert.equal(view.items[0].citationStatus, 'catalogue-changed'); assert.equal(view.items[0].citation.cloud, 41.7);
    await alice.post(path).send({ ...data, requestId: randomUUID(), revision: 1 }).expect(409);
    assert.equal((await alice.post(path).send(data).expect(200)).body.item.state, 'outdated');
    process.env.FIELD_DATA_STAC_URL = 'https://other-catalogue.example.test'; assert.equal((await context(alice)).items[0].citationStatus, 'catalogue-changed');
  }));
  it('distinguishes metadata-only unclear, unavailable and missing location without fabricating support', testService(async (service, c) => {
    const alice = await setup(service, c, ''); let view = await context(alice); assert.equal(view.catalogue.status, 'no-location');
    await alice.post(path).send(body(view)).expect(409);
    await alice.post(path).send(body(view, { outcome: 'unavailable', citation: null, reviewedImage: false })).expect(200);
    await alice.post(path).send(body(await context(alice), { outcome: 'unclear', citation: null, reviewedImage: false })).expect(200);
    await alice.post(`${base}/submissions`).set('Content-Type', 'application/xml').send(instance('located')).expect(200);
    const locationPath = path.replace('/one/', '/located/');
    await c.db.query(sql`UPDATE submissions SET "createdAt" = '2026-09-20T10:30:00Z' WHERE "instanceId" = 'located'`); await seed(c);
    view = (await alice.get(locationPath).expect(200)).body; const scene = view.catalogue.scenes[0];
    const { item } = (await alice.post(locationPath).send(body(view, { outcome: 'unclear', citation: { kind: 'catalogue', sceneId: scene.id, sceneFingerprint: scene.fingerprint, url: null }, reviewedImage: false })).expect(200)).body;
    assert.equal(item.reviewedImage, false); assert.equal(item.citation.url, null);
  }));
  it('makes XML, attachment and version changes stale without erasing earlier source snapshots', testService(async (service, c) => {
    const alice = await setup(service, c); const original = await context(alice); const data = body(original); await alice.post(path).send(data).expect(200);
    await alice.post(`${root}/attachments/photo.jpg`).set('Content-Type', 'image/jpeg').send(Buffer.from([255, 216, 255, 1])).expect(200);
    let view = await context(alice); assert.equal(view.items[0].state, 'outdated'); assert.equal(view.items[0].source.attachmentsHash, original.source.attachmentsHash);
    await alice.post(path).send(body(original)).expect(409); await alice.post(path).send(body(view)).expect(200);
    await c.db.query(sql`UPDATE submission_defs SET xml = replace(xml, '8.4801', '8.4901') WHERE id = ${view.source.submissionDefId}`);
    view = await context(alice); assert.equal(view.items[0].state, 'outdated'); assert.equal(view.source.location.latitude, 8.4901);
    await alice.post('/v1/projects/1/submission').set('X-OpenRosa-Version', '1.0').attach('xml_submission_file', Buffer.from(instance().replace('<instanceID>one', '<deprecatedID>one</deprecatedID><instanceID>two')), { filename: 'data.xml' }).expect(201);
    view = await context(alice); assert.equal(view.source.versionId, 'two'); assert.equal(view.items.every(i => i.state === 'outdated'), true);
  }));
  it('checks read/update rights, App Users, source scope, archival and deletion', testService(async (service, c) => {
    const alice = await setup(service, c); const data = body(await context(alice)); await alice.post(path).send(data).expect(200);
    const viewer = await service.login('chelsea'); const { id } = (await viewer.get('/v1/users/current').expect(200)).body;
    await viewer.get(path).expect(404); await alice.post(`/v1/projects/1/assignments/viewer/${id}`).expect(200);
    assert.equal((await viewer.get(path).expect(200)).body.canAssess, false); await viewer.post(path).send(data).expect(404);
    await viewer.post(`${path}/catalogue/check`).send({ sourceFingerprint: data.sourceFingerprint }).expect(404);
    const appUser = (await alice.post('/v1/projects/1/app-users').send({ displayName: 'Collector' }).expect(200)).body;
    await alice.post(`${base}/assignments/app-user/${appUser.id}`).expect(200); await service.post(path).set('Authorization', `Bearer ${appUser.token}`).send(data).expect(404);
    await service.get(path).expect(401); await alice.get(path.replace('/one/', '/missing/')).expect(404);
    await alice.delete(`/v1/projects/1/assignments/viewer/${id}`).expect(200); await viewer.get(path).expect(404);
    await c.db.query(sql`UPDATE projects SET archived = TRUE WHERE id = 1`); assert.equal((await context(alice)).canAssess, false);
    await alice.post(path).send(body(await context(alice))).expect(409); await alice.post(path).send(data).expect(200);
    await c.db.query(sql`UPDATE projects SET archived = FALSE WHERE id = 1`); await alice.delete(root).expect(200); await alice.get(path).expect(404);
  }));
  it('checks only the rounded cell/day and does not cache or substitute provider failures', testService(async (service, c) => {
    const alice = await setup(service, c); const { source } = await context(alice);
    await alice.post(`${path}/catalogue/check`).send({ sourceFingerprint: source.fingerprint }).expect(501); process.env.FIELD_DATA_IMAGERY_ENABLED = 'true';
    const calls = []; global.fetch = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true, json: async () => ({ features: [{ id: 'scene-1', properties: { datetime: '2026-09-18T12:00:00Z', 'eo:cloud_cover': 10 } }], numberMatched: 1 }) }; };
    await alice.post(`${path}/catalogue/check`).send({ sourceFingerprint: source.fingerprint, extra: true }).expect(400);
    await alice.post(`${path}/catalogue/check`).send({ sourceFingerprint: 'a'.repeat(64) }).expect(409);
    assert.equal((await alice.post(`${path}/catalogue/check`).send({ sourceFingerprint: source.fingerprint }).expect(200)).body.ok, true);
    assert.deepEqual(calls[0].body.intersects.coordinates, [-13.225, 8.475]); assert.equal(calls[0].body.datetime, '2026-08-21T00:00:00Z/2026-10-20T23:59:59Z');
    assert.equal(JSON.stringify(calls).includes('8.4801'), false); assert.equal(JSON.stringify(calls).includes('10:30'), false);
    global.fetch = async () => { throw new Error('Private provider error'); };
    assert.equal((await alice.post(`${path}/catalogue/check`).send({ sourceFingerprint: source.fingerprint }).expect(200)).body.ok, false);
    assert.equal((await context(alice)).catalogue.scenes.length, 1);
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_imagery_lookups`), 1);
  }));
  it('rechecks source and write permission after an external catalogue answer', testService(async (service, c) => {
    const alice = await setup(service, c); const manager = await service.login('chelsea'); const { id } = (await manager.get('/v1/users/current').expect(200)).body;
    await alice.post(`/v1/projects/1/assignments/manager/${id}`).expect(200); process.env.FIELD_DATA_IMAGERY_ENABLED = 'true';
    global.fetch = async () => { await alice.delete(`/v1/projects/1/assignments/manager/${id}`).expect(200); return { ok: true, json: async () => ({ features: [], numberMatched: 0 }) }; };
    const { source } = await context(alice);
    await manager.post(`${path}/catalogue/check`).send({ sourceFingerprint: source.fingerprint }).expect(404);
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_imagery_lookups`), 0);
    global.fetch = async () => { await alice.post(`${root}/attachments/photo.jpg`).set('Content-Type', 'image/jpeg').send(Buffer.from([255, 216, 255, 1])).expect(200); return { ok: true, json: async () => ({ features: [], numberMatched: 0 }) }; };
    await alice.post(`${path}/catalogue/check`).send({ sourceFingerprint: source.fingerprint }).expect(409);
  }));
  it('rejects unsafe citations, unsupported attestations and malformed assessment fields', testService(async (service, c) => {
    const alice = await setup(service, c); const view = await context(alice);
    for (const patch of [{ reviewedImage: false }, { citation: null }, { claim: 'short' }, { limitations: 'short' }, { extra: true }, { sourceFingerprint: 'bad' },
      { citation: { ...reference(), url: ['javascript', 'alert(1)'].join(':') } }, { citation: { ...reference(), url: 'https://secret@example.test/image' } },
      { citation: { ...reference(), date: '2026-02-30' } }, { citation: { ...reference(), date: '2999-01-01' } }, { outcome: 'unavailable' }]) await alice.post(path).send(body(view, patch)).expect(400);
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_geo_assessments`), 0);
  }));
  it('protects history against editing/deletion, retains it through rollback and permits source purge', testService(async (service, c) => {
    const alice = await setup(service, c); const { item } = (await alice.post(path).send(body(await context(alice))).expect(200)).body;
    for (const statement of [sql`UPDATE field_data_geo_assessments SET reason = 'Rewrite original assessment' WHERE id = ${item.id}`, sql`DELETE FROM field_data_geo_assessments WHERE id = ${item.id}`]) {
      await c.db.query(sql`SAVEPOINT immutable_check`); await assert.rejects(c.db.query(statement)); await c.db.query(sql`ROLLBACK TO SAVEPOINT immutable_check`); await c.db.query(sql`RELEASE SAVEPOINT immutable_check`);
    }
    const migration = require('../../../lib/model/migrations/20261016-03-geo-assessments'); const adapter = { raw: value => c.db.query(sql([value])) };
    await migration.down(adapter); await migration.up(adapter); assert.equal((await context(alice)).items.length, 1);
    await c.db.query(sql`DELETE FROM submission_defs WHERE id = ${item.source.submissionDefId}`); assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_geo_assessments`), 0);
  }));
  it('bounds history to fifty assessments and exposes candidate omissions and invalid caches', testService(async (service, c) => {
    const alice = await setup(service, c); const view = await context(alice); const first = (await alice.post(path).send(body(view)).expect(200)).body.item;
    await c.db.query(sql`INSERT INTO field_data_geo_assessments (id,"submissionDefId",sequence,"requestId","requestHash","actorId","actorName","sourceFingerprint",source,outcome,claim,reason,limitations,citation,"reviewedImage")
      SELECT gen_random_uuid(),"submissionDefId",n,gen_random_uuid(),"requestHash","actorId","actorName","sourceFingerprint",source,outcome,claim,reason,limitations,citation,"reviewedImage"
      FROM field_data_geo_assessments CROSS JOIN generate_series(2,50) n WHERE id = ${first.id}`);
    assert.equal((await context(alice)).canAssess, false); await alice.post(path).send(body(await context(alice))).expect(409);
    await seed(c, Array.from({ length: 55 }, (_, i) => ({ id: `scene-${i}`, at: '2026-09-18T12:00:00.000Z', cloud: null })));
    assert.equal((await context(alice)).catalogue.scenes.length, 50); assert.equal((await context(alice)).catalogue.omitted, 5);
    await c.db.query(sql`UPDATE field_data_imagery_lookups SET matched = 999`); assert.equal((await context(alice)).catalogue.status, 'incomplete');
    await seed(c, [{ id: 'bad-cloud', at: '2026-09-18T12:00:00.000Z', cloud: 101 }]); assert.equal((await context(alice)).catalogue.status, 'invalid-cache');
  }));
  it('pins the device-audit time basis and invalidates receipt-based history when parsed time arrives', testService(async (service, c) => {
    const alice = await setup(service, c); const initial = await context(alice); await alice.post(path).send(body(initial)).expect(200);
    await alice.post(`${root}/attachments/audit.csv`).set('Content-Type', 'text/csv').send('event,start,end\nquestion,2026-09-17T09:00:00Z,2026-09-17T09:01:00Z').expect(200);
    await c.db.query(sql`UPDATE submission_attachments SET "isClientAudit" = TRUE WHERE "submissionDefId" = ${initial.source.submissionDefId} AND name = 'audit.csv'`);
    await c.db.query(sql`INSERT INTO client_audits ("blobId",event,start,"end") SELECT "blobId",'question','2026-09-17T09:00:00Z','2026-09-17T09:01:00Z'
      FROM submission_attachments WHERE "submissionDefId" = ${initial.source.submissionDefId} AND name = 'audit.csv'`);
    const view = await context(alice); assert.equal(view.source.visitBasis, 'device-audit-log'); assert.equal(view.source.visitAt, '2026-09-17T09:00:00.000Z');
    assert.equal(view.items[0].state, 'outdated'); assert.equal(view.items[0].source.visitBasis, 'receipt');
  }));
  it('does not interpret encrypted submissions or offer assessment/check controls', testService(async (service, c) => {
    const alice = await setup(service, c); const xml = require('../../data/xml');
    await alice.post('/v1/projects/1/forms?publish=true').set('Content-Type', 'application/xml').send(xml.forms.encrypted).expect(200);
    await alice.post('/v1/projects/1/forms/encrypted/submissions').set('Content-Type', 'application/xml').send(xml.instances.encrypted.one).expect(200);
    const encryptedPath = '/v1/projects/1/forms/encrypted/submissions/uuid%3Adcf4a151-5088-453f-99e6-369d67828f7a/geo-assessments';
    const view = (await alice.get(encryptedPath).expect(200)).body;
    assert.equal(view.source.encrypted, true); assert.equal(view.source.location, null); assert.equal(view.canAssess, false); assert.equal(view.canCheck, false); assert.equal(view.catalogue.status, 'encrypted');
    await alice.post(encryptedPath).send(body(view, { outcome: 'unavailable', citation: null, reviewedImage: false })).expect(409);
  }));
  it('serializes competing revisions and makes concurrent identical retries one assessment', testServiceFullTrx(async (service, c) => {
    const alice = await setup(service, c); const view = await context(alice); const first = body(view);
    const results = await Promise.all([alice.post(path).send(first).expect(200), alice.post(path).send(first).expect(200)]); assert.equal(results[0].body.item.id, results[1].body.item.id);
    const next = await context(alice); const changed = await Promise.all([alice.post(path).send(body(next)), alice.post(path).send(body(next))]);
    assert.deepEqual(changed.map(r => r.status).sort(), [200, 409]); assert.equal((await context(alice)).revision, 2);
  }));
});
