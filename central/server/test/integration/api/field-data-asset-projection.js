// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
//
// Asset status across a project (K3): docs/field-intelligence/K3-asset-status-projection.md

require('should');
const assert = require('node:assert/strict');
const { sql } = require('slonik');
const { testService } = require('../setup');
const testData = require('../../data/xml');

const root = '/v1/field-data/projects/1/assets';
const projection = `${root}/projection`;
const AT = '2026-03-01T00:00:00Z';

const setup = async (service) => {
  const alice = await service.login('alice');
  let n = 0;
  const uuid = () => { n += 1; return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`; };
  const submit = (xmlFormId, xml) => alice.post(`/v1/projects/1/forms/${xmlFormId}/submissions`).send(xml).set('Content-Type', 'application/xml').expect(200);
  const claimOf = async (xmlFormId, instanceId) =>
    (await alice.get(`/v1/projects/1/forms/${xmlFormId}/submissions/${instanceId}/claim`).expect(200)).body.currentVersionId;
  const register = async (name, assetType = 'water-point', xmlFormId = 'simple') =>
    (await alice.post(root).send({ requestId: uuid(), name, assetType, externalId: name.toUpperCase().replace(/\s/g, '-'), xmlFormId }).expect(201)).body.id;
  const observe = async (assetId, claimVersionId, predicate, value, validFrom, validityDays = 90, graceDays = 10) => {
    const { headers } = await alice.get(`${root}/${assetId}`).expect(200);
    await alice.post(`${root}/${assetId}/observations`).set('If-Match', headers.etag)
      .send({ requestId: uuid(), claimVersionId, predicate, state: value == null ? 'unknown' : 'known', value,
        validFrom, validityDays, graceDays, note: 'Recorded from the source submission.' })
      .expect(201);
  };
  return { alice, submit, claimOf, register, observe };
};
const byName = (body) => Object.fromEntries(body.assets.map((a) => [a.name, a]));

describe('api: asset status across a project (K3)', () => {
  it('shows each asset\'s current fact as the passport chooses it, counting only current values', testService(async (service) => {
    const { alice, submit, claimOf, register, observe } = await setup(service);
    await submit('simple', testData.instances.simple.one);
    const claim = await claimOf('simple', 'one');
    const w1 = await register('Water point 1');
    const w2 = await register('Water point 2');
    const w3 = await register('Water point 3');
    const w4 = await register('Water point 4');
    const school = await register('School', 'school');
    await observe(w1, claim, 'condition', 'operating', '2026-01-01T00:00:00Z');
    await new Promise((resolve) => { setTimeout(resolve, 20); });
    const between = new Date().toISOString();
    await new Promise((resolve) => { setTimeout(resolve, 20); });
    await observe(w1, claim, 'condition', 'broken', '2026-02-01T00:00:00Z');
    await observe(w2, claim, 'condition', 'operating', '2025-10-01T00:00:00Z', 30, 10);
    await observe(w3, claim, 'depth', '12', '2026-01-01T00:00:00Z');
    await observe(w4, claim, 'condition', null, '2026-01-01T00:00:00Z');
    await observe(school, claim, 'condition', 'operating', '2026-02-15T00:00:00Z');

    const none = (await alice.get(projection).expect(200));
    assert.equal(none.headers['cache-control'], 'private, no-store');
    assert.deepEqual(none.body.predicates, ['condition', 'depth']);
    assert.equal(none.body.predicate, null);
    assert.deepEqual(none.body.assets, []);

    const water = (await alice.get(projection).query({ predicate: 'condition', assetType: 'water-point', at: AT }).expect(200)).body;
    assert.equal(water.at, '2026-03-01T00:00:00.000Z');
    assert.deepEqual(water.assets.map((a) => a.name), ['Water point 1', 'Water point 2', 'Water point 3', 'Water point 4']);
    const w = byName(water);
    assert.equal(w['Water point 1'].fact.value, 'broken');
    assert.equal(w['Water point 1'].fact.freshness.status, 'fresh');
    assert.equal(w['Water point 1'].fact.claimVersionId, claim);
    assert.equal(w['Water point 1'].fact.integrityStatus, 'verified');
    assert.equal(w['Water point 1'].xmlFormId, 'simple');
    assert.equal(w['Water point 2'].fact.freshness.status, 'expired');
    assert.equal(w['Water point 3'].fact, null);
    assert.equal(w['Water point 4'].fact.freshness.status, 'unknown');
    assert.deepEqual(water.summary, { byValue: [{ value: 'broken', count: 1 }],
      byStatus: { fresh: 1, 'review-due': 0, expired: 1, unknown: 1, 'source-unverified': 0, 'not-yet-valid': 0, none: 1 } });
    assert.deepEqual(water.excluded, { notReadable: 0, sourceDeleted: 0 });
    assert.equal(water.truncated, false);

    // All types; earlier "as of" and "known at" times.
    const all = (await alice.get(projection).query({ predicate: 'condition', at: AT }).expect(200)).body;
    assert.deepEqual(all.summary.byValue, [{ value: 'broken', count: 1 }, { value: 'operating', count: 1 }]);
    assert.equal(byName((await alice.get(projection).query({ predicate: 'condition', at: '2026-01-15T00:00:00Z' }).expect(200)).body)['Water point 1'].fact.value, 'operating');
    assert.equal(byName((await alice.get(projection).query({ predicate: 'condition', at: AT, knownAt: between }).expect(200)).body)['Water point 1'].fact.value, 'operating');
    // Review due: past 90 days but within the 10 days of grace.
    assert.equal(byName((await alice.get(projection).query({ predicate: 'condition', at: '2026-05-05T00:00:00Z' }).expect(200)).body)['Water point 1'].fact.freshness.status, 'review-due');

  }));

  it('leaves out assets resting on deleted or unreadable sources, and flags altered ones', testService(async (service, { run }) => {
    const { alice, submit, claimOf, register, observe } = await setup(service);
    await alice.post('/v1/projects/1/forms?publish=true').send(testData.forms.simple2).set('Content-Type', 'application/xml').expect(200);
    await submit('simple', testData.instances.simple.one);
    await submit('simple', testData.instances.simple.two);
    await submit('simple', testData.instances.simple.three);
    await submit('simple2', testData.instances.simple2.one);
    const kept = await register('Kept');
    const deleted = await register('Deleted source');
    const other = await register('From another form');
    const altered = await register('Altered source');
    await observe(kept, await claimOf('simple', 'one'), 'condition', 'operating', '2026-02-01T00:00:00Z');
    await observe(deleted, await claimOf('simple', 'two'), 'condition', 'operating', '2026-02-01T00:00:00Z');
    await observe(other, await claimOf('simple2', 's2one'), 'condition', 'broken', '2026-02-01T00:00:00Z');
    await observe(altered, await claimOf('simple', 'three'), 'condition', 'broken', '2026-02-01T00:00:00Z');
    await run(sql`UPDATE submission_defs SET xml = replace(xml, '<age>', '<age>1') WHERE "instanceId" = 'three'`);
    await alice.delete('/v1/projects/1/forms/simple/submissions/two').expect(200);

    const { body } = await alice.get(projection).query({ predicate: 'condition', at: AT }).expect(200);
    assert.deepEqual(body.assets.map((a) => a.name), ['Altered source', 'From another form', 'Kept']);
    assert.equal(byName(body)['Altered source'].fact.freshness.status, 'source-unverified');
    assert.equal(byName(body)['Altered source'].fact.integrityStatus, 'unverified');
    assert.deepEqual(body.summary.byValue, [{ value: 'broken', count: 1 }, { value: 'operating', count: 1 }]);
    assert.deepEqual(body.excluded, { notReadable: 0, sourceDeleted: 1 });

    // A data collector who may read only this form's submissions.
    const chelsea = await service.login('chelsea');
    await chelsea.get(projection).expect(404);
    const chelseaId = (await chelsea.get('/v1/users/current').expect(200)).body.id;
    await alice.post(`/v1/projects/1/assignments/formfill/${chelseaId}`).expect(200);
    assert.deepEqual((await chelsea.get(projection).query({ predicate: 'condition' }).expect(200)).body.assets, []);
    await alice.post(`/v1/projects/1/forms/simple/assignments/viewer/${chelseaId}`).expect(200);
    const limited = (await chelsea.get(projection).query({ predicate: 'condition', at: AT }).expect(200)).body;
    assert.deepEqual(limited.assets.map((a) => a.name), ['Altered source', 'Kept']);
    assert.deepEqual(limited.excluded, { notReadable: 1, sourceDeleted: 1 });

    await Promise.all([{ at: '2026-02-30T00:00:00Z' }, { knownAt: 'yesterday' }, { predicate: 'x'.repeat(101) }, { predicate: ' ' }, { assetType: '' }]
      .map((q) => alice.get(projection).query(q).expect(400)));
    await alice.get('/v1/field-data/projects/999/assets/projection').expect(404);
    // The passport route still treats other names as asset IDs.
    await alice.get(`${root}/not-an-asset`).expect(404);
  }));
  it('summarises the status by area, an area being another predicate (K6)', testService(async (service) => {
    const { alice, submit, claimOf, register, observe } = await setup(service);
    await submit('simple', testData.instances.simple.one);
    const claim = await claimOf('simple', 'one');
    const [a, b, c, d, e] = [await register('A'), await register('B'), await register('C'), await register('D'), await register('E')];
    await observe(a, claim, 'condition', 'operating', '2026-02-01T00:00:00Z');
    await observe(a, claim, 'district', 'Kenema', '2026-02-01T00:00:00Z');
    await observe(b, claim, 'condition', 'broken', '2026-02-01T00:00:00Z');
    await observe(b, claim, 'district', 'Bo', '2026-02-01T00:00:00Z');
    await observe(c, claim, 'condition', 'broken', '2025-06-01T00:00:00Z', 30, 10);
    // An old district fact still places the asset, and is counted as not current.
    await observe(c, claim, 'district', 'Bo', '2025-06-01T00:00:00Z', 30, 10);
    await observe(d, claim, 'condition', 'operating', '2026-02-01T00:00:00Z');
    await observe(e, claim, 'district', 'Kenema', '2026-02-01T00:00:00Z');
    // A later district fact moves A, as the passport would choose it.
    await observe(a, claim, 'district', 'Bo', '2026-02-20T00:00:00Z');

    const { body } = await alice.get(projection).query({ predicate: 'condition', areaPredicate: 'district', at: AT }).expect(200);
    assert.equal(body.areaPredicate, 'district');
    assert.equal(byName(body).A.area.value, 'Bo');
    assert.equal(byName(body).D.area, null);
    assert.deepEqual(body.byArea.map((g) => [g.area, g.assets, g.areaNotCurrent, g.byValue]), [
      ['Bo', 3, 1, [{ value: 'broken', count: 1 }, { value: 'operating', count: 1 }]],
      ['Kenema', 1, 0, []],
      [null, 1, 0, [{ value: 'operating', count: 1 }]]
    ]);
    assert.equal(body.byArea[0].byStatus.expired, 1);
    assert.equal(body.byArea[1].byStatus.none, 1);
    assert.deepEqual(body.summary.byValue, [{ value: 'operating', count: 2 }, { value: 'broken', count: 1 }]);
    // Earlier, A was in Kenema.
    const before = (await alice.get(projection).query({ predicate: 'condition', areaPredicate: 'district', at: '2026-02-10T00:00:00Z' }).expect(200)).body;
    assert.deepEqual(before.byArea.map((g) => [g.area, g.assets]), [['Bo', 2], ['Kenema', 2], [null, 1]]);
    // Without an area predicate the response has no areas.
    const plain = (await alice.get(projection).query({ predicate: 'condition', at: AT }).expect(200)).body;
    assert.equal(plain.byArea, undefined);
    assert.equal(plain.areaPredicate, null);
    assert.equal(byName(plain).A.area, undefined);
    // An area predicate needs a predicate, and a different one.
    await alice.get(projection).query({ areaPredicate: 'district' }).expect(400);
    await alice.get(projection).query({ predicate: 'district', areaPredicate: 'district' }).expect(400);
    await alice.get(projection).query({ predicate: 'condition', areaPredicate: ' ' }).expect(400);
    await alice.get(projection).query({ predicate: 'condition', areaPredicate: 'x'.repeat(101) }).expect(400);
  }));
});
