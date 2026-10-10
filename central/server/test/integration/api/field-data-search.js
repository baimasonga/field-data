// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
//
// Cited search (K2): docs/field-intelligence/K2-cited-search.md

require('should');
const assert = require('node:assert/strict');
const { sql } = require('slonik');
const { testService } = require('../setup');
const testData = require('../../data/xml');

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const search = (agent, q, projectId = 1) => agent.get(`/v1/projects/${projectId}/search`).query(q == null ? {} : { q });

// Two submissions, an asset with a fact from the first, findings on both and
// a decision on the first one's review case.
const seed = async (service, { one }) => {
  const alice = await service.login('alice');
  await alice.post('/v1/projects/1/forms/simple/submissions').send(testData.instances.simple.one)
    .set('Content-Type', 'application/xml').expect(200);
  await alice.post('/v1/projects/1/forms/simple/submissions').send(testData.instances.simple.two)
    .set('Content-Type', 'application/xml').expect(200);
  const root = '/v1/field-data/projects/1/assets';
  const asset = await alice.post(root).send({ requestId: uuid(1), name: 'Kissy water point', assetType: 'water-point',
    externalId: 'WP-01', xmlFormId: 'simple' }).expect(201);
  const claim = (await alice.get('/v1/projects/1/forms/simple/submissions/one/claim').expect(200)).body;
  await alice.post(`${root}/${asset.body.id}/observations`).set('If-Match', asset.headers.etag)
    .send({ requestId: uuid(2), claimVersionId: claim.currentVersionId, predicate: 'condition', state: 'known',
      value: 'pump broken at kissy', validFrom: '2026-08-01T00:00:00Z', validityDays: 90, graceDays: 10,
      note: 'Recorded from the inspected original.' }).expect(201);
  const flag = (instanceId, title, extra = {}) => one(sql`INSERT INTO field_data_integrity_flags
    ("formId", rule, "ruleVersion", "instanceId", "relatedInstanceId", outcome, evidence, note)
    SELECT id, ${`manual-${title}`}, 1, ${instanceId}, ${extra.related ?? null}, ${extra.outcome ?? 'inconclusive'},
      ${JSON.stringify({ title, explanation: extra.explanation ?? null, others: extra.others ?? [] })}::jsonb, ${extra.note ?? null}
    FROM forms WHERE "projectId" = 1 AND "xmlFormId" = 'simple' RETURNING id`);
  const findings = {
    short: await flag('one', 'Interview too short', { explanation: `${'Long context. '.repeat(20)}Recorded at Kissy junction. ${'More context. '.repeat(20)}` }),
    withdrawn: await flag('one', 'Kissy, no longer observed', { outcome: 'withdrawn' }),
    otherForm: await flag('two', 'Same household at Kissy', { related: 'one', others: [{ instanceId: 'one', xmlFormId: 'withrepeat' }] }),
    sameForm: await flag('two', 'Duplicate of one', { related: 'one', note: 'Checked at Kissy', others: [{ instanceId: 'one', xmlFormId: 'simple' }] })
  };
  const actorId = (await alice.get('/v1/users/current').expect(200)).body.id;
  const { items } = (await alice.get('/v1/field-data/review-queue?projectId=1&xmlFormId=simple').expect(200)).body;
  const item = items.find((i) => i.claimVersionId === claim.currentVersionId);
  const assigned = await alice.patch(`/v1/field-data/review-queue/${item.id}/assignment`).set('If-Match', item.etag)
    .set('Idempotency-Key', 'search-assign').send({ assignedTo: actorId, status: 'in-review' })
    .expect(200);
  await alice.post(`/v1/field-data/review-queue/${item.id}/decisions`).set('If-Match', assigned.headers.etag)
    .set('Idempotency-Key', 'search-decision')
    .send({ outcome: 'needs-evidence', override: false, reasonCode: item.reasonCodes[0],
      note: 'Shared phone used at Kissy market.', evidenceIds: [], integrityFindingIds: [] })
    .expect(201);
  return { alice, asset: asset.body, claim, findings };
};

describe('api: cited search (K2)', () => {
  it('finds each kind of record with its citation and an excerpt', testService(async (service, container) => {
    const { alice, asset, claim, findings } = await seed(service, container);
    const { body, headers } = await search(alice, 'KISSY').expect(200);
    assert.equal(headers['cache-control'], 'private, no-store');
    assert.equal(body.q, 'KISSY');

    assert.deepEqual(body.results.assets.map((a) => [a.id, a.name, a.match.field, a.source.xmlFormId]),
      [[asset.id, 'Kissy water point', 'name', 'simple']]);

    assert.equal(body.results.facts.length, 1);
    const [fact] = body.results.facts;
    assert.equal(fact.assetId, asset.id);
    assert.equal(fact.assetName, 'Kissy water point');
    assert.equal(fact.assetXmlFormId, 'simple');
    assert.deepEqual(fact.match, { field: 'value', excerpt: 'pump broken at kissy' });
    assert.deepEqual(fact.source, { xmlFormId: 'simple', instanceId: 'one', claimVersionId: claim.currentVersionId });

    // Withdrawn findings are left out; a related submission in another form is not cited.
    const byId = Object.fromEntries(body.results.findings.map((f) => [f.id, f]));
    assert.deepEqual(Object.keys(byId).map(Number).sort(), [findings.short.id, findings.otherForm.id, findings.sameForm.id].sort());
    assert.deepEqual(byId[findings.otherForm.id].source, { xmlFormId: 'simple', instanceId: 'two', relatedInstanceId: null });
    assert.deepEqual(byId[findings.sameForm.id].source, { xmlFormId: 'simple', instanceId: 'two', relatedInstanceId: 'one' });
    assert.deepEqual(byId[findings.sameForm.id].match, { field: 'note', excerpt: 'Checked at Kissy' });
    assert.deepEqual(byId[findings.otherForm.id].match, { field: 'title', excerpt: 'Same household at Kissy' });
    const { excerpt } = byId[findings.short.id].match;
    assert.equal(byId[findings.short.id].match.field, 'explanation');
    assert.ok(excerpt.startsWith('…') && excerpt.endsWith('…'), excerpt);
    assert.ok(excerpt.length <= 162, excerpt);
    assert.ok(excerpt.includes('Recorded at Kissy junction.'), excerpt);

    assert.equal(body.results.decisions.length, 1);
    const [decision] = body.results.decisions;
    assert.equal(decision.outcome, 'needs-evidence');
    assert.deepEqual(decision.match, { field: 'note', excerpt: 'Shared phone used at Kissy market.' });
    assert.equal(decision.source.xmlFormId, 'simple');
    assert.deepEqual(decision.source, { xmlFormId: 'simple', instanceId: 'one', claimVersionId: claim.currentVersionId });
    assert.deepEqual(body.more, { assets: 0, facts: 0, findings: 0, decisions: 0 });

    // Each field is searched: external ID, type, predicate, reason code.
    assert.equal((await search(alice, 'wp-01').expect(200)).body.results.assets[0].match.field, 'externalId');
    assert.equal((await search(alice, 'water-po').expect(200)).body.results.assets[0].match.field, 'assetType');
    assert.equal((await search(alice, 'conditio').expect(200)).body.results.facts[0].match.field, 'predicate');
    assert.equal((await search(alice, decision.reasonCode).expect(200)).body.results.decisions[0].match.field, 'reasonCode');
    assert.equal((await search(alice, 'Recorded at').expect(200)).body.results.facts.length, 0, 'the fact note is not searched');
  }));

  it('leaves out records citing a deleted submission', testService(async (service, container) => {
    const { alice, asset, findings } = await seed(service, container);
    await alice.delete('/v1/projects/1/forms/simple/submissions/one').expect(200);
    const after = (await search(alice, 'kissy').expect(200)).body.results;
    assert.deepEqual(after.assets.map((a) => a.id), [asset.id], 'an asset rests on its form, not a submission');
    assert.deepEqual(after.facts, []);
    assert.deepEqual(after.decisions, []);
    assert.deepEqual(after.findings.map((f) => f.id).sort(), [findings.otherForm.id, findings.sameForm.id].sort());
    await alice.delete('/v1/projects/1/forms/simple/submissions/two').expect(200);
    assert.deepEqual((await search(alice, 'kissy').expect(200)).body.results.findings, []);
  }));

  it('returns at most 20 per kind with how many more, newest first, and matches LIKE characters literally', testService(async (service, { run }) => {
    const alice = await service.login('alice');
    await run(sql`INSERT INTO field_data_assets ("projectId", "formId", name, "assetType", "externalId", "requestId", "requestHash", "actorId", "createdAt")
      SELECT 1, f.id, 'Bulk asset ' || n, 'school', 'B-' || n, gen_random_uuid(), repeat('0', 64), a.id, now() + n * interval '1 second'
      FROM forms f, actors a, generate_series(1, 24) n
      WHERE f."projectId" = 1 AND f."xmlFormId" = 'simple' AND a."displayName" = 'Alice'`);
    await run(sql`INSERT INTO field_data_assets ("projectId", "formId", name, "assetType", "externalId", "requestId", "requestHash", "actorId")
      SELECT 1, f.id, 'Coverage 50% done', 'school', 'C_1', gen_random_uuid(), repeat('0', 64), a.id
      FROM forms f, actors a WHERE f."projectId" = 1 AND f."xmlFormId" = 'simple' AND a."displayName" = 'Alice'`);
    const bulk = (await search(alice, 'bulk asset').expect(200)).body;
    assert.equal(bulk.results.assets.length, 20);
    assert.equal(bulk.more.assets, 4);
    assert.equal(bulk.results.assets[0].name, 'Bulk asset 24');
    assert.deepEqual((await search(alice, '0%').expect(200)).body.results.assets.map((a) => a.name), ['Coverage 50% done']);
    assert.deepEqual((await search(alice, 'C_').expect(200)).body.results.assets.map((a) => a.externalId), ['C_1']);
    assert.deepEqual((await search(alice, '\\%').expect(200)).body.results.assets, []);
  }));

  it('lets viewers search, gives data collectors nothing, refuses App Users and checks the query', testService(async (service, container) => {
    const { alice } = await seed(service, container);
    const chelsea = await service.login('chelsea');
    await search(chelsea, 'kissy').expect(403);
    const actorId = (await chelsea.get('/v1/users/current').expect(200)).body.id;
    await alice.post(`/v1/projects/1/assignments/viewer/${actorId}`).expect(200);
    const viewed = (await search(chelsea, 'kissy').expect(200)).body.results;
    assert.equal(viewed.assets.length, 1);
    assert.equal(viewed.facts.length, 1);
    await alice.delete(`/v1/projects/1/assignments/viewer/${actorId}`).expect(200);
    await alice.post(`/v1/projects/1/assignments/formfill/${actorId}`).expect(200);
    const collector = (await search(chelsea, 'kissy').expect(200)).body;
    assert.deepEqual(collector.results, { assets: [], facts: [], findings: [], decisions: [] });
    assert.deepEqual(collector.more, { assets: 0, facts: 0, findings: 0, decisions: 0 });

    const appUser = (await alice.post('/v1/projects/1/app-users').send({ displayName: 'Collector' }).expect(200)).body;
    await alice.post(`/v1/projects/1/forms/simple/assignments/app-user/${appUser.id}`).expect(200);
    await service.get(`/v1/key/${appUser.token}/projects/1/search?q=kissy`).expect(403);

    const refused = await Promise.all([null, 'k', ' k ', 'x'.repeat(101)].map((q) => search(alice, q).expect(400)));
    assert.deepEqual(refused.map(({ body }) => body.code), [400.8, 400.8, 400.8, 400.8]);
    assert.equal((await search(alice, `  kissy  `).expect(200)).body.q, 'kissy');
    await search(alice, 'kissy', 999).expect(404);
    await search(alice, 'kissy', 'x').expect(404);
    await search(alice, 'kissy', '9007199254740993').expect(404);
  }));
});
