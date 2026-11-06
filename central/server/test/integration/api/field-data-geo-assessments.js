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

describe('api: exact imagery footprints and reviewed change candidates', () => {
  const geometry = { type: 'Polygon', coordinates: [[[-13.24, 8.47], [-13.22, 8.47], [-13.22, 8.49], [-13.24, 8.49], [-13.24, 8.47]]] };
  const dated = date => ({ title: 'Dated footprint reference', url: `https://images.example.test/${date}`, date, geometry });
  const candidate = () => ({ kind: 'change', before: dated('2026-09-10'), after: dated('2026-09-25') });
  it('checks supplied polygons against the actual reported point without making provider requests', testService(async (service, c) => {
    const alice = await setup(service, c); const current = await context(alice);
    const result = await alice.post(`${path}/footprint/check`).send({ sourceFingerprint: current.source.fingerprint, geometry }).expect(200);
    assert.equal(result.headers['cache-control'], 'private, no-store'); assert.equal(result.body.relation, 'inside'); assert.equal(result.body.accuracyRelation, 'contained');
    assert.equal(result.body.sourceFingerprint, current.source.fingerprint); assert.match(result.body.geometryFingerprint, /^[a-f0-9]{64}$/);
    const outside = { type: 'Polygon', coordinates: [[[0, 1], [1, 1], [1, 2], [0, 2], [0, 1]]] };
    assert.equal((await alice.post(`${path}/footprint/check`).send({ sourceFingerprint: current.source.fingerprint, geometry: outside }).expect(200)).body.relation, 'outside');
    await alice.post(`${path}/footprint/check`).send({ sourceFingerprint: 'a'.repeat(64), geometry }).expect(409);
    await alice.post(`${path}/footprint/check`).send({ sourceFingerprint: current.source.fingerprint, geometry: { type: 'Point', coordinates: [0, 1] } }).expect(400);
  }));
  it('records reviewed before/after candidates, exact retries and immutable original source/geometry in exports', testService(async (service, c) => {
    const alice = await setup(service, c); const original = await context(alice);
    const data = body(original, { citation: candidate(), claim: 'A structure appears between the two dated image references.' });
    const created = (await alice.post(path).send(data).expect(200)).body;
    assert.equal(created.item.citation.kind, 'change'); assert.equal(created.item.citation.checks.before.relation, 'inside'); assert.equal(created.item.citation.checks.after.accuracyRelation, 'contained');
    assert.deepEqual(created.item.citation.before.geometry, geometry);
    assert.equal((await alice.post(path).send(data).expect(200)).body.replayed, true);
    await alice.post(path).send({ ...data, citation: { ...candidate(), before: { ...dated('2026-09-10'), title: 'Changed historical reference' } } }).expect(409);
    await c.db.query(sql`UPDATE submission_defs SET xml=replace(xml,'8.4801','8.4501') WHERE id=${original.source.submissionDefId}`);
    const view = await context(alice); assert.equal(view.items[0].state, 'outdated'); assert.deepEqual(view.items[0].citation.after.geometry, geometry);
    assert.equal((await alice.post(path).send(data).expect(200)).body.item.state, 'outdated');
    await alice.post(path).send(body(view, { citation: candidate() })).expect(409);
    await alice.post(path).send(body(view, { citation: candidate(), outcome: 'unclear' })).expect(200);
  }));
  it('records standalone footprints and refuses malformed dates, unsafe URLs, unreviewed images and reversed comparisons', testService(async (service, c) => {
    const alice = await setup(service, c); const current = await context(alice);
    for (const citation of [
      { ...candidate(), before: dated('2026-09-25') },
      { ...candidate(), before: { ...dated('2026-09-10'), url: 'http://unsafe.test/image' } },
      { ...candidate(), after: dated('2099-01-01') },
      { ...candidate(), after: { ...dated('2026-09-25'), geometry: { type: 'Polygon', coordinates: [] } } }
    ]) await alice.post(path).send(body(current, { citation })).expect(400);
    await alice.post(path).send(body(current, { citation: candidate(), reviewedImage: false })).expect(400);
    const saved = (await alice.post(path).send(body(current, { citation: { kind: 'footprint', ...dated('2026-09-10') } })).expect(200)).body;
    assert.equal(saved.item.citation.checks.image.relation, 'inside');
  }));
  it('withholds boundary comparisons and enforces live read scope on preview requests', testService(async (service, c) => {
    const alice = await setup(service, c); const current = await context(alice);
    const boundary = { type: 'Polygon', coordinates: [[[-13.2344, 8.47], [-13.22, 8.47], [-13.22, 8.49], [-13.2344, 8.49], [-13.2344, 8.47]]] };
    const data = body(current, { citation: { ...candidate(), before: { ...dated('2026-09-10'), geometry: boundary } } });
    await alice.post(path).send(data).expect(409);
    const saved = (await alice.post(path).send({ ...data, outcome: 'unclear' }).expect(200)).body;
    assert.equal(saved.item.citation.checks.before.relation, 'boundary');
    const viewer = await service.login('chelsea'); const userId = (await viewer.get('/v1/users/current').expect(200)).body.id;
    const request = { sourceFingerprint: current.source.fingerprint, geometry };
    await viewer.post(`${path}/footprint/check`).send(request).expect(404);
    await alice.post(`/v1/projects/1/assignments/viewer/${userId}`).expect(200);
    await viewer.post(`${path}/footprint/check`).send(request).expect(200);
    await viewer.post(path).send(body(await context(alice), { citation: candidate() })).expect(404);
    await alice.delete(`${base}/submissions/one`).expect(200);
    await viewer.post(`${path}/footprint/check`).send(request).expect(404);
  }));
  it('withholds positive reviews for unknown accuracy and permits unclear reviews without location', testService(async (service, c) => {
    const alice = await setup(service, c, '8.4801 -13.2344'); let current = await context(alice);
    await alice.post(path).send(body(current, { citation: candidate() })).expect(409);
    await alice.post(path).send(body(current, { citation: candidate(), outcome: 'unclear' })).expect(200);
    await c.db.query(sql`UPDATE submission_defs SET xml=replace(xml,'8.4801 -13.2344','') WHERE id=${current.source.submissionDefId}`);
    current = await context(alice);
    const result = (await alice.post(`${path}/footprint/check`).send({ sourceFingerprint: current.source.fingerprint, geometry }).expect(200)).body;
    assert.equal(result.relation, 'unavailable');
    const saved = (await alice.post(path).send(body(current, { citation: candidate(), outcome: 'unclear' })).expect(200)).body;
    assert.equal(saved.item.citation.checks.before.relation, 'unavailable');
  }));
});

describe('api: provider footprints, pixel analysis and candidate review completion', () => {
  const analysisPath = `${path}/analyses`; const saved = {}; let originalFetch; let calls;
  const geometry = { type: 'Polygon', coordinates: [[[-13.24, 8.47], [-13.22, 8.47], [-13.22, 8.49], [-13.24, 8.49], [-13.24, 8.47]]] };
  const rasterResult = require('../../../../../cloudflare/form-compiler/test-fixtures/raster-result.json');
  const rawScene = (id, date) => ({ type: 'Feature', id, collection: 'sentinel-2-l2a', geometry,
    properties: { datetime: `${date}T12:00:00.000Z`, 'eo:cloud_cover': 10, 'view:sun_elevation': 45 },
    assets: Object.fromEntries(['red', 'nir', 'scl'].map(name => [name, { href: `https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/fixture/${id}/${name}.tif`,
      'raster:bands': [{ scale: 0.0001, offset: 0 }] }])) });
  const response = data => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
  beforeEach(() => {
    originalFetch = global.fetch; calls = [];
    for (const key of ['FIELD_DATA_STAC_URL', 'FIELD_DATA_GEOSPATIAL_ENABLED']) saved[key] = process.env[key];
    process.env.FIELD_DATA_STAC_URL = 'https://catalogue.example.test/v1'; process.env.FIELD_DATA_GEOSPATIAL_ENABLED = 'true';
    global.fetch = async (url, options) => {
      calls.push({ url, body: options?.body });
      if (url === 'http://127.0.0.1:5001/api/v1/geo/analyse') return response(rasterResult);
      if (url.endsWith('/items/before')) return response(rawScene('before', '2026-09-10'));
      if (url.endsWith('/items/after')) return response(rawScene('after', '2026-09-25'));
      throw new Error('Unexpected network destination');
    };
  });
  afterEach(() => { global.fetch = originalFetch; for (const [key, value] of Object.entries(saved)) { if (value == null) delete process.env[key]; else process.env[key] = value; } });
  const prepare = async (service, c) => {
    const alice = await setup(service, c);
    await seed(c, [{ id: 'before', at: '2026-09-10T12:00:00.000Z', cloud: 10 }, { id: 'after', at: '2026-09-25T12:00:00.000Z', cloud: 10 }]);
    const initial = (await alice.get(analysisPath).expect(200)).body;
    const before = initial.scenes.find(scene => scene.id === 'before'); const after = initial.scenes.find(scene => scene.id === 'after');
    const request = { requestId: randomUUID(), sourceFingerprint: initial.source.fingerprint, mode: 'change', beforeId: before.id, beforeFingerprint: before.fingerprint,
      afterId: after.id, afterFingerprint: after.fingerprint, allowExternalProcessing: true };
    return { alice, initial, request };
  };
  it('retrieves provider footprints and analyses real engine output with persistent, exactly-once request recovery', testService(async (service, c) => {
    const { alice, request } = await prepare(service, c);
    const created = (await alice.post(analysisPath).send(request).expect(200)).body;
    assert.equal(created.item.status, 'complete'); assert.equal(created.item.result.status, 'analysed'); assert.equal(created.item.result.candidates[0].areaM2, 1600);
    assert.equal(created.item.result.provider.before.coverage.relation, 'inside'); assert.deepEqual(created.item.result.provider.after.geometry, geometry);
    assert.equal(calls.length, 3); assert.equal(calls[0].url.includes(request.sourceFingerprint), false);
    const replay = (await alice.post(analysisPath).send(request).expect(200)).body; assert.equal(replay.replayed, true); assert.equal(calls.length, 3);
    await alice.post(analysisPath).send({ ...request, mode: 'footprint', afterId: null, afterFingerprint: null }).expect(409);
    const stored = (await alice.get(analysisPath).expect(200)).body; assert.equal(stored.items[0].sourceCurrent, true); assert.equal(stored.items[0].result.before.pixels.red.length, 1024);
    const audits = JSON.stringify(await c.db.any(sql`SELECT details FROM audits WHERE action LIKE 'field_data.geo.analysis.%'`));
    assert.equal(audits.includes('8.4801'), false); assert.equal(audits.includes('previewPng'), false);
  }));
  it('verifies single-scene metadata without raster access and withholds unavailable raster instead of inventing no change', testService(async (service, c) => {
    const { alice, request } = await prepare(service, c);
    const footprint = (await alice.post(analysisPath).send({ ...request, mode: 'footprint', afterId: null, afterFingerprint: null }).expect(200)).body.item;
    assert.equal(footprint.result.status, 'footprint-checked'); assert.equal(calls.length, 1);
    const stub = global.fetch; global.fetch = (url, options) => (url.includes('127.0.0.1') ? Promise.reject(new Error('Unavailable raster')) : stub(url, options));
    const withheld = (await alice.post(analysisPath).send({ ...request, requestId: randomUUID() }).expect(200)).body.item;
    assert.equal(withheld.result.status, 'withheld'); assert.match(withheld.result.reason, /unavailable/); assert.deepEqual(withheld.result.candidates, []);
  }));
  it('appends candidate decisions with revisions, safe retries and immutable source-bound history', testService(async (service, c) => {
    const { alice, request } = await prepare(service, c); const { item } = (await alice.post(analysisPath).send(request).expect(200)).body;
    const reviewPath = `${analysisPath}/${item.id}/reviews`;
    const first = { requestId: randomUUID(), revision: 0, candidateId: 1, action: 'approve', reason: 'Both previews show the same coherent spectral change area.', reviewedImages: true };
    await alice.post(reviewPath).send(first).expect(200); await alice.post(reviewPath).send(first).expect(200);
    await alice.post(reviewPath).send({ ...first, reason: 'A changed retry must not alter the earlier review.' }).expect(409);
    await alice.post(reviewPath).send({ ...first, requestId: randomUUID(), action: 'reject' }).expect(409);
    await alice.post(reviewPath).send({ ...first, requestId: randomUUID(), revision: 1, action: 'reject', reason: 'A later inspection identifies seasonal effects in these pixels.' }).expect(200);
    const history = (await alice.get(analysisPath).expect(200)).body.items[0]; assert.equal(history.reviews.length, 2); assert.equal(history.reviews[0].action, 'reject'); assert.equal(history.reviews[1].action, 'approve');
    for (const statement of [sql`UPDATE field_data_geo_candidate_reviews SET action='approve' WHERE "analysisId"=${item.id}`, sql`UPDATE field_data_geo_analyses SET result='{}'::jsonb WHERE id=${item.id}`]) {
      await c.db.query(sql`SAVEPOINT g4_guard`); await assert.rejects(c.db.query(statement)); await c.db.query(sql`ROLLBACK TO SAVEPOINT g4_guard`); await c.db.query(sql`RELEASE SAVEPOINT g4_guard`);
    }
    const migration = require('../../../lib/model/migrations/20261106-01-geospatial-pixel-analysis'); const adapter = { raw: value => c.db.query(sql([value])) };
    await migration.down(adapter); await migration.up(adapter); assert.equal((await alice.get(analysisPath).expect(200)).body.items[0].reviews.length, 2);
    await c.db.query(sql`UPDATE submission_defs SET xml=replace(xml,'8.4801','8.4901') WHERE id=${item.source.submissionDefId}`);
    assert.equal((await alice.get(analysisPath).expect(200)).body.items[0].sourceCurrent, false);
    await alice.post(reviewPath).send({ ...first, requestId: randomUUID(), revision: 2 }).expect(409);
  }));
  it('rechecks source and permission after provider processing, and rejects consent, scene and actor scope errors', testService(async (service, c) => {
    const { alice, request } = await prepare(service, c);
    await alice.post(analysisPath).send({ ...request, allowExternalProcessing: false }).expect(400);
    await alice.post(analysisPath).send({ ...request, beforeId: 'not-cached' }).expect(409);
    const viewer = await service.login('chelsea'); const { id } = (await viewer.get('/v1/users/current').expect(200)).body;
    await viewer.get(analysisPath).expect(404); await alice.post(`/v1/projects/1/assignments/viewer/${id}`).expect(200);
    await viewer.get(analysisPath).expect(200); await viewer.post(analysisPath).send(request).expect(404);
    const stub = global.fetch; let changed = false;
    global.fetch = async (url, options) => { const output = await stub(url, options); if (!changed) { changed = true; await c.db.query(sql`UPDATE submission_defs SET xml=replace(xml,'8.4801','8.4901') WHERE current AND "instanceId"='one'`); } return output; };
    const result = (await alice.post(analysisPath).send(request).expect(200)).body.item;
    assert.equal(result.status, 'failed'); assert.equal(result.result, null); assert.equal(result.sourceCurrent, false);
  }));
  it('fails closed on provider changes and leaves completed evidence intact through source purge', testService(async (service, c) => {
    const { alice, request } = await prepare(service, c);
    global.fetch = async () => response({ ...rawScene('before', '2026-09-10'), geometry: { type: 'Point', coordinates: [0, 0] } });
    const result = (await alice.post(analysisPath).send(request).expect(200)).body.item; assert.equal(result.status, 'failed');
    await c.db.query(sql`DELETE FROM submissions WHERE "instanceId"='one'`);
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_geo_analyses`), 0);
  }));
});
