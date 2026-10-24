// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
//
// Suggested duplicate assets (K5): docs/field-intelligence/K5-duplicate-assets.md

require('should');
const assert = require('node:assert/strict');
const { sql } = require('slonik');
const { testService } = require('../setup');
const testData = require('../../data/xml');

const root = '/v1/field-data/projects/1/assets';
const path = `${root}/duplicates`;

const setup = async (service) => {
  const alice = await service.login('alice');
  let n = 0;
  const uuid = () => { n += 1; return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`; };
  const register = async (name, externalId, assetType = 'water-point', xmlFormId = 'simple') =>
    (await alice.post(root).send({ requestId: uuid(), name, assetType, externalId, xmlFormId }).expect(201)).body.id;
  await alice.post('/v1/projects/1/forms/simple/submissions').send(testData.instances.simple.one).set('Content-Type', 'application/xml').expect(200);
  const claim = (await alice.get('/v1/projects/1/forms/simple/submissions/one/claim').expect(200)).body.currentVersionId;
  const observe = async (assetId, value, patch = {}) => {
    const { headers } = await alice.get(`${root}/${assetId}`).expect(200);
    await alice.post(`${root}/${assetId}/observations`).set('If-Match', headers.etag)
      .send({ requestId: uuid(), claimVersionId: claim, predicate: 'condition', state: 'known', value,
        validFrom: '2026-01-01T00:00:00Z', validityDays: 100, graceDays: 0, note: 'From the visit.', ...patch }).expect(201);
  };
  const pairs = async (agent = alice) => (await agent.get(path).expect(200)).body;
  const summary = (body) => body.pairs.map((p) => [p.a.name, p.b.name, p.reasons.join('+')]);
  return { alice, uuid, register, observe, pairs, summary };
};

describe('api: suggested duplicate assets (K5)', () => {
  it('suggests pairs with their reasons, and lets a manager dismiss and withdraw', testService(async (service) => {
    const { alice, register, observe, pairs, summary } = await setup(service);
    const a = await register('Kissy water point', 'WP-01');
    const b = await register('Kissy well', 'wp 01');
    await register('Lumley School', 'S-1', 'school');
    await register('lumley-school', 'S-2', 'school');
    await register('Water point 1', 'N-1');
    await register('Water point 2', 'N-2');
    const c = await register('Bo clinic', 'C-1', 'clinic');
    const d = await register('Kenema clinic', 'C-2', 'clinic');
    await observe(c, 'open');
    await observe(d, 'open');

    const first = await pairs();
    assert.deepEqual(summary(first), [
      ['Kissy water point', 'Kissy well', 'external-id'],
      ['Bo clinic', 'Kenema clinic', 'same-source'],
      ['Lumley School', 'lumley-school', 'same-name']
    ]);
    assert.equal(first.truncated, false);
    assert.deepEqual(first.dismissed, []);
    assert.deepEqual(Object.keys(first.pairs[0].a).sort(), ['assetType', 'externalId', 'id', 'name', 'xmlFormId']);

    // Not the same: dismissed with a reason, then withdrawn.
    await alice.post(`${path}/dismissals`).send({ assetIds: [b, a], reason: ' ' }).expect(400);
    await alice.post(`${path}/dismissals`).send({ assetIds: [a, a], reason: 'x' }).expect(400);
    const dismissed = await alice.post(`${path}/dismissals`).send({ assetIds: [b, a], reason: 'Two wells on one compound.' }).expect(201);
    await alice.post(`${path}/dismissals`).send({ assetIds: [a, b], reason: 'Again.' }).expect(409);
    const after = await pairs();
    assert.deepEqual(summary(after).map((p) => p[0]), ['Bo clinic', 'Lumley School']);
    assert.deepEqual(after.dismissed.map((x) => [x.a.name, x.b.name, x.reason, x.actorName]).map((x) => x.slice(2)),
      [['Two wells on one compound.', 'Alice']]);
    await alice.post(`${path}/dismissals/${dismissed.body.id}/withdraw`).expect(200);
    await alice.post(`${path}/dismissals/${dismissed.body.id}/withdraw`).expect(409);
    assert.equal(summary(await pairs()).length, 3);

    // A merged asset is no longer suggested.
    const { headers } = await alice.get(`${root}/${a}`).expect(200);
    await alice.post(`${root}/${a}/merge`).set('If-Match', headers.etag)
      .send({ requestId: '00000000-0000-4000-8000-000000000999', mergedAssetId: b, reason: 'Registered twice.' }).expect(201);
    assert.deepEqual(summary(await pairs()).map((p) => p[0]), ['Bo clinic', 'Lumley School']);
  }));

  it('keeps dismissals append-only, shows only readable assets, and is for managers to decide', testService(async (service, { run }) => {
    const { alice, uuid, register, pairs, summary } = await setup(service);
    const a = await register('Pump house', 'PH-1', 'pump');
    const b = await register('pump house', 'PH-2', 'pump');
    await register('Pump house', 'PH-3', 'pump', 'withrepeat');
    assert.equal(summary(await pairs()).length, 3);
    const dismissal = (await alice.post(`${path}/dismissals`).send({ assetIds: [a, b], reason: 'Two pumps.' }).expect(201)).body;

    const refused = async (statement) => {
      await run(sql`SAVEPOINT guard`);
      await assert.rejects(run(statement), /append-only/);
      await run(sql`ROLLBACK TO SAVEPOINT guard`);
    };
    await refused(sql`UPDATE field_data_asset_duplicate_dismissals SET reason = 'rewritten' WHERE id = ${dismissal.id}`);
    await refused(sql`DELETE FROM field_data_asset_duplicate_dismissals WHERE id = ${dismissal.id}`);
    await alice.post(`${path}/dismissals/${dismissal.id}/withdraw`).expect(200);
    await refused(sql`UPDATE field_data_asset_duplicate_dismissals SET "withdrawnAt" = NULL WHERE id = ${dismissal.id}`);

    // A viewer of one form sees pairs among that form's assets only, and cannot dismiss.
    const chelsea = await service.login('chelsea');
    const chelseaId = (await chelsea.get('/v1/users/current').expect(200)).body.id;
    await chelsea.get(path).expect(404);
    await alice.post(`/v1/projects/1/assignments/formfill/${chelseaId}`).expect(200);
    await alice.post(`/v1/projects/1/forms/simple/assignments/viewer/${chelseaId}`).expect(200);
    assert.deepEqual(summary(await pairs(chelsea)), [['pump house', 'Pump house', 'same-name']]);
    await chelsea.post(`${path}/dismissals`).send({ assetIds: [a, b], reason: 'x' }).expect(404);
    await alice.post(`${path}/dismissals`).send({ assetIds: [a, uuid()], reason: 'x' }).expect(404);
    // The passport route still treats other names as asset IDs.
    await alice.get(`${root}/not-an-asset`).expect(404);
  }));
  it('compares explicitly selected location facts with citations and withholds unknown and expired replacements', testService(async service => {
    const { alice, register, observe } = await setup(service);
    const a = await register('North pump', 'N'); const b = await register('South pump', 'S');
    const target = `${root}/${a}/location-comparison/${b}`; const at = new Date().toISOString();
    await observe(a, '8.4 -13.2 0 10', { predicate: 'location', validFrom: at });
    await observe(b, '8.4001 -13.2 0 20', { predicate: 'location', validFrom: at });
    const response = await alice.get(target).query({ predicate: 'location' }).expect(200);
    assert.equal(response.headers['cache-control'], 'private, no-store');
    const result = response.body; assert.equal(result.a.status, 'usable'); assert.equal(result.b.status, 'usable');
    assert.ok(result.distanceMetres > 11 && result.distanceMetres < 12); assert.equal(result.reportedAccuracyRangeMetres.minimum, 0);
    assert.match(result.a.citation.sourceUrl, /^\/v1\/field-data\/claim-versions\//);
    await observe(b, null, { predicate: 'location', state: 'unknown', validFrom: at });
    const unknown = (await alice.get(target).query({ predicate: 'location' }).expect(200)).body;
    assert.equal(unknown.b.status, 'unknown'); assert.equal(unknown.distanceMetres, null);
    const missing = (await alice.get(target).query({ predicate: 'not recorded' }).expect(200)).body;
    assert.equal(missing.a.status, 'missing'); assert.equal(missing.distanceMetres, null);
    await observe(a, '8.4 -13.2', { predicate: 'historic location', validFrom: '2020-01-01T00:00:00Z' });
    assert.equal((await alice.get(target).query({ predicate: 'historic location' }).expect(200)).body.a.status, 'expired');
    await alice.get(target).expect(400); await alice.get(target).query({ predicate: 'location', extra: 1 }).expect(400);
    await alice.get(`${root}/${a}/location-comparison/${a}`).query({ predicate: 'location' }).expect(400);
    await alice.get(`${root}/${a}/location-comparison/not-an-id`).query({ predicate: 'location' }).expect(404);
  }));
  it('requires access to both assets and every currently owned evidence source', testService(async service => {
    const { alice, register, observe } = await setup(service);
    const a = await register('First pump', 'A'); const b = await register('Second pump', 'B');
    await alice.post('/v1/projects/1/forms/withrepeat/submissions').send(testData.instances.withrepeat.one).set('Content-Type', 'application/xml').expect(200);
    const claim = (await alice.get('/v1/projects/1/forms/withrepeat/submissions/rone/claim').expect(200)).body.currentVersionId;
    const at = new Date().toISOString(); await observe(a, '8.4 -13.2', { predicate: 'location', validFrom: at });
    await observe(b, '8.41 -13.2', { predicate: 'location', validFrom: at, claimVersionId: claim });
    const user = await service.login('chelsea'); const { id } = (await user.get('/v1/users/current').expect(200)).body;
    await alice.post(`/v1/projects/1/assignments/formfill/${id}`).expect(200);
    await alice.post(`/v1/projects/1/forms/simple/assignments/viewer/${id}`).expect(200);
    const target = `${root}/${a}/location-comparison/${b}`;
    await user.get(target).query({ predicate: 'location' }).expect(404);
    await alice.post(`/v1/projects/1/forms/withrepeat/assignments/viewer/${id}`).expect(200);
    assert.equal((await user.get(target).query({ predicate: 'location' }).expect(200)).body.reportedAccuracyRangeMetres, null);
    await alice.delete(`/v1/projects/1/forms/withrepeat/assignments/viewer/${id}`).expect(200);
    await user.get(target).query({ predicate: 'location' }).expect(404);
    await service.get(target).query({ predicate: 'location' }).expect(401);
  }));

  it('compares cited photo bytes and reports replacement, missing and unusable references without modifying assets', testService(async service => {
    const { alice, register, observe } = await setup(service);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yX3cAAAAASUVORK5CYII=', 'base64');
    await alice.post('/v1/projects/1/forms?publish=true').set('Content-Type', 'application/xml').send(testData.forms.binaryType).expect(200);
    await alice.post('/v1/projects/1/forms/binaryType/submissions').set('Content-Type', 'application/xml').send(testData.instances.binaryType.both).expect(200);
    const source = '/v1/projects/1/forms/binaryType/submissions/both';
    const claimVersionId = (await alice.get(`${source}/claim`).expect(200)).body.currentVersionId;
    const put = (name, bytes, type = 'image/png') => alice.post(`${source}/attachments/${name}`).set('Content-Type', type).send(bytes);
    await put('here_is_file2.jpg', png).expect(200); await put('my_file1.mp4', png).expect(200);
    const a = await register('First pump', 'A'); const b = await register('Second pump', 'B');
    const patch = { predicate: 'photo', claimVersionId, validFrom: new Date().toISOString() };
    await observe(a, 'here_is_file2.jpg', patch); await observe(b, 'my_file1.mp4', patch);
    const target = `${root}/${a}/photo-comparison/${b}`; const get = () => alice.get(target).query({ predicate: 'photo' });
    const first = await get().expect(200); assert.equal(first.headers['cache-control'], 'private, no-store');
    assert.equal(first.body.identicalBytes, true); assert.equal(first.body.a.status, 'usable');
    assert.equal(Buffer.from(first.body.a.photo.base64, 'base64').equals(png), true);
    assert.equal(first.body.a.citation.claimVersionId, claimVersionId);
    await put('my_file1.mp4', Buffer.concat([png, Buffer.from('different retained bytes')])).expect(200);
    const changed = (await get().expect(200)).body; assert.equal(changed.identicalBytes, false); assert.notEqual(changed.b.photo.sha256, first.body.b.photo.sha256);
    await put('my_file1.mp4', 'not a supported photo', 'text/plain').expect(200);
    const unsupported = (await get().expect(200)).body; assert.equal(unsupported.b.status, 'unsupported-photo'); assert.equal(unsupported.identicalBytes, null);
    await observe(b, 'not-present.jpg', patch); assert.equal((await get().expect(200)).body.b.status, 'attachment-missing');
    await observe(b, null, { ...patch, state: 'unknown' }); assert.equal((await get().expect(200)).body.b.status, 'unknown');
    await alice.get(target).expect(400); await alice.get(target).query({ predicate: 'photo', extra: 1 }).expect(400);
    await alice.get(`${root}/${a}/photo-comparison/${a}`).query({ predicate: 'photo' }).expect(400);
    const user = await service.login('chelsea'); const { id } = (await user.get('/v1/users/current').expect(200)).body;
    await alice.post(`/v1/projects/1/assignments/formfill/${id}`).expect(200);
    await alice.post(`/v1/projects/1/forms/simple/assignments/viewer/${id}`).expect(200);
    await user.get(target).query({ predicate: 'photo' }).expect(404);
    await alice.post(`/v1/projects/1/forms/binaryType/assignments/viewer/${id}`).expect(200);
    await user.get(target).query({ predicate: 'photo' }).expect(200);
    await alice.delete(`/v1/projects/1/forms/binaryType/assignments/viewer/${id}`).expect(200);
    await user.get(target).query({ predicate: 'photo' }).expect(404);
    await service.get(target).query({ predicate: 'photo' }).expect(401);
  }));

});
