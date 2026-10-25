/* eslint-disable no-await-in-loop */
// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { sql } = require('slonik');
const { testService, testServiceFullTrx } = require('../setup');
const xml = require('../../data/xml');
const root = '/v1/projects/1/knowledge';
const assetsRoot = '/v1/field-data/projects/1/assets';
const setup = async service => {
  const alice = await service.login('alice');
  await alice.post('/v1/projects/1/forms/simple/submissions').set('Content-Type', 'application/xml').send(xml.instances.simple.one).expect(200);
  const claim = (await alice.get('/v1/projects/1/forms/simple/submissions/one/claim').expect(200)).body.currentVersionId;
  const register = async (name, externalId = randomUUID()) => (await alice.post(assetsRoot).send({ requestId: randomUUID(), name, externalId, assetType: 'pump', xmlFormId: 'simple' }).expect(201)).body.id;
  const observe = async (id, predicate, value, patch = {}) => {
    const response = await alice.get(`${assetsRoot}/${id}`).expect(200);
    return (await alice.post(`${assetsRoot}/${id}/observations`).set('If-Match', response.headers.etag).send({ requestId: randomUUID(), claimVersionId: claim, predicate, value, state: 'known', validFrom: new Date(Date.now() - 1000).toISOString(), validityDays: 30, graceDays: 1, note: 'Explicit Knowledge fixture observation.', ...patch }).expect(201)).body;
  };
  return { alice, claim, register, observe };
};
describe('api: complete Knowledge workflows', () => {
  it('builds cited snapshots, maps areas and evaluates decisions without asset writes', testService(async service => {
    const { alice, register, observe } = await setup(service); const id = await register('Cited pump');
    await observe(id, 'location', '8.4 -13.2 0 10'); await observe(id, 'condition', 'broken');
    const catalogue = (await alice.get(root).expect(200)).body; assert.equal(catalogue.canManage, true); assert.ok(catalogue.availablePredicates.includes('condition'));
    const snapshot = (await alice.post(`${root}/snapshot`).send({ predicates: ['condition'] }).expect(200)).body;
    assert.equal(snapshot.assets[0].facts.condition.value, 'broken'); assert.equal(snapshot.assets[0].facts.condition.integrityStatus, 'verified');
    const definition = { kind: 'decision', rules: [{ predicate: 'condition', operator: 'eq', value: 'broken', priority: 1, action: 'Inspect the pump before scheduling repair.' }] };
    const result = (await alice.post(`${root}/evaluate`).send({ definition }).expect(200)).body;
    assert.equal(result.evaluation.rows[0].priority, 1); assert.equal(result.evaluation.rows[0].matched[0].source.claimVersionId, snapshot.assets[0].facts.condition.source.claimVersionId);
    const map = (await alice.post(`${root}/evaluate`).send({ definition: { kind: 'geography', locationPredicate: 'location', areas: [{ value: 'District', geometry: { type: 'Polygon', coordinates: [[[-14, 8], [-13, 8], [-13, 9], [-14, 9], [-14, 8]]] } }] } }).expect(200)).body;
    assert.equal(map.evaluation.features[0].properties.area, 'District'); assert.deepEqual(map.evaluation.features[0].geometry.coordinates, [-13.2, 8.4]);
    await observe(id, 'condition', null, { state: 'unknown' });
    assert.equal((await alice.post(`${root}/evaluate`).send({ definition }).expect(200)).body.evaluation.rows[0].status, 'insufficient-evidence');
    await alice.post(`${root}/snapshot`).send({ predicates: ['condition', 'condition'] }).expect(400);
    await alice.post(`${root}/snapshot`).send({ knownAt: '2099-01-01T00:00:00Z' }).expect(400);
  }));
  it('versions shared definitions with optimistic updates, exact retries, history and immutable events', testService(async (service, c) => {
    const { alice } = await setup(service); const id = randomUUID();
    const body = { requestId: randomUUID(), expectedRevision: 0, title: 'Repair review', definition: { kind: 'decision', rules: [{ predicate: 'condition', operator: 'eq', value: 'broken', priority: 1, action: 'Review repair evidence.' }] }, reason: 'Declare the review policy.', archived: false, shared: true };
    const target = `${root}/definitions/${id}`; const first = await alice.post(target).send(body).expect(200);
    assert.equal(first.body.revision, 1); assert.equal((await alice.post(target).send(body).expect(200)).body.replayed, true);
    await alice.post(target).send({ ...body, reason: 'Conflicting retry.' }).expect(409);
    await alice.post(target).send({ ...body, requestId: randomUUID() }).expect(412);
    await alice.post(target).send({ ...body, requestId: randomUUID(), expectedRevision: 1, archived: true }).expect(200);
    const history = (await alice.get(`${target}/history`).expect(200)).body; assert.deepEqual(history.items.map(row => row.revision), [2, 1]);
    assert.equal((await alice.post(`${root}/evaluate`).send({ definitionId: id, definitionRevision: 1 }).expect(200)).body.definitionSource.archived, false);
    await c.db.query(sql`SAVEPOINT event_guard`);
    await assert.rejects(c.db.query(sql`UPDATE field_data_knowledge_definition_events SET reason='changed' WHERE "definitionId"=${id}`), /append-only/);
    await c.db.query(sql`ROLLBACK TO SAVEPOINT event_guard`);
  }));
  it('retrieves pinned answers and facts without disclosing unreadable source forms', testService(async service => {
    const { alice, register, observe } = await setup(service); const id = await register('Community water pump'); await observe(id, 'service', 'clean water supply');
    const facts = (await alice.post(`${root}/retrieval`).send({ q: 'clean water', mode: 'literal' }).expect(200)).body;
    assert.ok(facts.results.some(row => row.kind === 'fact')); assert.ok(facts.results.find(row => row.kind === 'fact').source.claimVersionId);
    const answers = (await alice.post(`${root}/retrieval`).send({ q: 'simple', mode: 'literal' }).expect(200)).body;
    assert.ok(answers.results.some(row => row.kind === 'answer')); assert.ok(answers.results.find(row => row.kind === 'answer').source.path);
    const semantic = (await alice.post(`${root}/retrieval`).send({ q: 'water', mode: 'semantic' }).expect(200)).body;
    assert.ok(['request-local-latent-semantic@1', 'literal-corpus@1'].includes(semantic.method));
    const user = await service.login('chelsea'); const { id: userId } = (await user.get('/v1/users/current').expect(200)).body;
    await alice.post(`/v1/projects/1/assignments/formfill/${userId}`).expect(200);
    const hidden = (await user.post(`${root}/retrieval`).send({ q: 'water', mode: 'semantic' }).expect(200)).body; assert.equal(hidden.corpusDocuments, 0);
    await alice.post(`/v1/projects/1/forms/simple/assignments/viewer/${userId}`).expect(200);
    assert.ok((await user.post(`${root}/retrieval`).send({ q: 'water', mode: 'semantic' }).expect(200)).body.corpusDocuments > 0);
    await alice.delete(`/v1/projects/1/forms/simple/assignments/viewer/${userId}`).expect(200);
    assert.equal((await user.post(`${root}/snapshot`).send({ predicates: ['service'] }).expect(200)).body.assets.length, 0);
    await user.post(`${root}/definitions/${randomUUID()}`).send({}).expect(400);
    await service.get(root).expect(401);
  }));
  it('rebuilds historical ownership through merge and later undo, with late evidence excluded by known-at', testService(async (service, c) => {
    const { alice, register, observe } = await setup(service); const a = await register('First identity'); const b = await register('Second identity');
    await observe(a, 'condition', 'working');
    const before = new Date(await c.db.oneFirst(sql`SELECT clock_timestamp()`)).toISOString();
    const passport = await alice.get(`${assetsRoot}/${b}`).expect(200);
    const merge = await alice.post(`${assetsRoot}/${b}/merge`).set('If-Match', passport.headers.etag).send({ requestId: randomUUID(), mergedAssetId: a, reason: 'Review duplicate identities together.' }).expect(201);
    const during = new Date(await c.db.oneFirst(sql`SELECT clock_timestamp()`)).toISOString();
    const merged = (await alice.post(`${root}/snapshot`).send({ predicates: ['condition'], knownAt: during }).expect(200)).body;
    assert.equal(merged.assets.length, 1); assert.equal(merged.assets[0].id, b); assert.equal(merged.assets[0].facts.condition.value, 'working');
    await alice.post(`${assetsRoot}/operations/${merge.body.id}/undo`).send({ reason: 'Independent identities confirmed.' }).expect(200);
    const old = (await alice.post(`${root}/snapshot`).send({ predicates: ['condition'], knownAt: before }).expect(200)).body;
    assert.equal(old.assets.length, 2); assert.equal(old.assets.find(asset => asset.id === a).facts.condition.value, 'working');
    const then = (await alice.post(`${root}/snapshot`).send({ predicates: ['condition'], knownAt: during }).expect(200)).body;
    assert.equal(then.assets.length, 1); assert.equal(then.assets[0].id, b);
    await observe(a, 'condition', 'broken');
    const rebuilt = (await alice.post(`${root}/snapshot`).send({ predicates: ['condition'] }).expect(200)).body;
    assert.equal(rebuilt.assets.find(asset => asset.id === a).facts.condition.value, 'broken');
    assert.equal((await alice.post(`${root}/snapshot`).send({ predicates: ['condition'], knownAt: before }).expect(200)).body.assets.find(asset => asset.id === a).facts.condition.value, 'working');
  }));
  it('runs a declared conditional causal contract and withholds after assumptions or source integrity fail', testService(async (service, c) => {
    const { alice, register, observe } = await setup(service);
    const treatmentAt = new Date(Date.now() - 2 * 86400000).toISOString(); const outcomeAt = new Date(Date.now() - 86400000).toISOString(); const baselineAt = new Date(Date.now() - 3 * 86400000).toISOString();
    for (let i = 0; i < 8; i += 1) {
      const id = await register(`Unit ${i}`); await observe(id, 'T', i % 2 ? '1' : '0', { validFrom: treatmentAt });
      await observe(id, 'Y', String(10 + (i % 2 ? 4 : 0)), { validFrom: outcomeAt }); await observe(id, 'C', i < 4 ? 'north' : 'south', { validFrom: baselineAt });
    }
    const { ASSUMPTIONS } = require('../../../lib/util/knowledge-models');
    const definition = { kind: 'causal', nodes: ['T', 'Y', 'C'], edges: [['C', 'T'], ['C', 'Y'], ['T', 'Y']], treatment: 'T', outcome: 'Y', adjustments: ['C'], assumptions: Object.fromEntries(ASSUMPTIONS.map(key => [key, true])), rationale: 'Baseline strata are declared sufficient for this synthetic acceptance fixture; timing and sampling assumptions are explicit.' };
    const result = (await alice.post(`${root}/evaluate`).send({ definition }).expect(200)).body;
    assert.equal(result.evaluation.estimate.effect, 4); assert.equal(result.evaluation.eligible, 8); assert.equal(result.evaluation.sharedOutcomeSourceGroups, 1);
    const withheld = (await alice.post(`${root}/evaluate`).send({ definition: { ...definition, adjustments: [] } }).expect(200)).body;
    assert.equal(withheld.evaluation.estimate, null); assert.ok(withheld.evaluation.graph.openBackdoorPaths.length);
    await alice.post(`${root}/evaluate`).send({ definition: { ...definition, edges: [['T', 'Y'], ['Y', 'T']] } }).expect(400);
    await c.db.query(sql`UPDATE submission_defs SET xml=xml || ' ' WHERE id=(SELECT "submissionDefId" FROM field_data_claim_versions LIMIT 1)`);
    const unverified = (await alice.post(`${root}/evaluate`).send({ definition }).expect(200)).body;
    assert.equal(unverified.evaluation.estimate, null); assert.equal(unverified.evaluation.excluded.unavailable, 8);
    const retrieval = (await alice.post(`${root}/retrieval`).send({ q: 'simple', mode: 'semantic' }).expect(200)).body;
    assert.equal(retrieval.results.some(row => row.kind === 'answer'), false);
  }));

  it('withholds an asset with unreadable cross-form evidence and follows current source deletion', testService(async service => {
    const { alice, register, observe } = await setup(service); const asset = await register('Cross-source asset');
    await alice.post('/v1/projects/1/forms/withrepeat/submissions').set('Content-Type', 'application/xml').send(xml.instances.withrepeat.one).expect(200);
    const claim = (await alice.get('/v1/projects/1/forms/withrepeat/submissions/rone/claim').expect(200)).body.currentVersionId;
    await observe(asset, 'condition', 'private-source-value', { claimVersionId: claim });
    const user = await service.login('chelsea'); const { id } = (await user.get('/v1/users/current').expect(200)).body;
    await alice.post(`/v1/projects/1/assignments/formfill/${id}`).expect(200); await alice.post(`/v1/projects/1/forms/simple/assignments/viewer/${id}`).expect(200);
    const hidden = (await user.post(`${root}/snapshot`).send({ predicates: ['condition'] }).expect(200)).body;
    assert.equal(hidden.assets.length, 0); assert.equal(hidden.withheldAssets, 1); assert.equal(JSON.stringify(hidden).includes('private-source-value'), false);
    const definition = { kind: 'decision', rules: [{ predicate: 'condition', operator: 'eq', value: 'private-source-value', priority: 1, action: 'Review the source.' }] };
    assert.equal((await user.post(`${root}/evaluate`).send({ definition }).expect(200)).body.evaluation.rows.length, 0);
    await alice.post(`/v1/projects/1/forms/withrepeat/assignments/viewer/${id}`).expect(200);
    assert.equal((await user.post(`${root}/snapshot`).send({ predicates: ['condition'] }).expect(200)).body.assets.length, 1);
    await alice.delete('/v1/projects/1/forms/withrepeat/submissions/rone').expect(200);
    const deleted = (await alice.post(`${root}/snapshot`).send({ predicates: ['condition'] }).expect(200)).body; assert.equal(deleted.assets.length, 0); assert.equal(deleted.withheldAssets, 1);
  }));
  it('preserves namespaced and repeated answer citations without flattening records or special fact keys', testService(async service => {
    const { alice, register, observe } = await setup(service);
    await alice.post('/v1/projects/1/forms/simple/submissions').set('Content-Type', 'application/xml').send(xml.instances.simple.two.replace('<data ', '<data xmlns="urn:knowledge:answers" ')).expect(200);
    const namespace = (await alice.post(`${root}/retrieval`).send({ q: 'Bob', mode: 'literal', xmlFormId: 'simple', paths: ['/name'] }).expect(200)).body;
    assert.ok(namespace.results.some(row => row.kind === 'answer' && row.excerpt.includes('Bob')));
    await alice.post('/v1/projects/1/forms/withrepeat/submissions').set('Content-Type', 'application/xml').send(xml.instances.withrepeat.two).expect(200);
    const repeat = (await alice.post(`${root}/retrieval`).send({ q: 'children', mode: 'literal', xmlFormId: 'withrepeat', paths: ['/children/child/name'] }).expect(200)).body;
    const answers = repeat.results.filter(row => row.kind === 'answer'); assert.equal(answers.length, 2); assert.deepEqual(answers.map(row => row.source.repeatIndex).sort(), [1, 2]); assert.notEqual(answers[0].id, answers[1].id);
    const id = await register('Special fact key'); await observe(id, '__proto__', 'cited-value');
    const snapshot = (await alice.post(`${root}/snapshot`).send({ predicates: ['__proto__'] }).expect(200)).body;
    assert.equal(Object.hasOwn(snapshot.assets[0].facts, '__proto__'), true); assert.equal(Object.getOwnPropertyDescriptor(snapshot.assets[0].facts, '__proto__').value.value, 'cited-value');
    assert.equal(namespace.corpusFingerprint.length, 64); assert.equal(namespace.request.knownAt, namespace.knownAt);
  }));
  it('refuses viewer writes, cross-project definition IDs, malformed inputs and archived-project writes', testService(async service => {
    const { alice } = await setup(service); const id = randomUUID(); const body = { requestId: randomUUID(), expectedRevision: 0, title: 'Shared source policy', definition: { kind: 'decision', rules: [{ predicate: 'condition', operator: 'eq', value: 'broken', priority: 1, action: 'Review.' }] }, reason: 'Declare a shared review specification.', archived: false, shared: true };
    await alice.post(`${root}/definitions/${id}`).send(body).expect(200);
    const user = await service.login('chelsea'); const { id: userId } = (await user.get('/v1/users/current').expect(200)).body;
    await alice.post(`/v1/projects/1/assignments/viewer/${userId}`).expect(200);
    assert.equal((await user.get(root).expect(200)).body.canManage, false);
    await user.post(`${root}/definitions/${randomUUID()}`).send({ ...body, requestId: randomUUID() }).expect(403);
    const other = (await alice.post('/v1/projects').send({ name: 'Other Knowledge scope' }).expect(200)).body;
    await alice.post(`/v1/projects/${other.id}/knowledge/definitions/${id}`).send({ ...body, requestId: randomUUID() }).expect(404);
    await alice.patch('/v1/projects/1').send({ archived: true }).expect(200);
    await alice.post(`${root}/definitions/${randomUUID()}`).send({ ...body, requestId: randomUUID() }).expect(400);
    await alice.post(`${root}/retrieval`).send({ q: 'good', mode: 'semantic', paths: ['//*[1]'] }).expect(400);
    await alice.post(`${root}/retrieval`).send({ q: 'good', mode: 'semantic', offset: -1 }).expect(400);
    await alice.get(`${root}/definitions/${id}/history?extra=1`).expect(400);
  }));
  it('serializes concurrent saves and retains append-only definitions through migration rollback', testServiceFullTrx(async (service, c) => {
    const { alice } = await setup(service); const id = randomUUID(); const body = { requestId: randomUUID(), expectedRevision: 0, title: 'Concurrent policy', definition: { kind: 'geography', locationPredicate: 'location', areas: [] }, reason: 'Record a shared map specification.', archived: false, shared: true };
    const responses = await Promise.all([alice.post(`${root}/definitions/${id}`).send(body), alice.post(`${root}/definitions/${id}`).send(body)]);
    assert.deepEqual(responses.map(result => result.status), [200, 200]); assert.equal(responses.filter(result => result.body.replayed).length, 1);
    const update = { ...body, expectedRevision: 1, reason: 'Update under the current revision.' };
    const competing = await Promise.all([alice.post(`${root}/definitions/${id}`).send({ ...update, requestId: randomUUID(), title: 'First competing map' }), alice.post(`${root}/definitions/${id}`).send({ ...update, requestId: randomUUID(), title: 'Second competing map' })]);
    assert.deepEqual(competing.map(result => result.status).sort(), [200, 412]);
    assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_knowledge_definition_events WHERE "definitionId"=${id}`), 2);
    const { knexConnect } = require('../../../lib/model/knex-migrator'); const config = require('config'); const migration = require('../../../lib/model/migrations/20261025-01-knowledge-definitions'); const db = knexConnect(config.get('test.database'));
    try { await db.transaction(async trx => { await migration.down(trx); await migration.up(trx); assert.equal((await trx.raw('SELECT count(*)::integer AS count FROM field_data_knowledge_definition_events')).rows[0].count, 2); }); } finally { await db.destroy(); }
  }));

});
