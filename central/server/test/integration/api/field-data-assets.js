// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
require('should');
const assert = require('node:assert/strict');
const { sql } = require('slonik');
const { testServiceFullTrx } = require('../setup');
const testData = require('../../data/xml');
const { generateReverification } = require('../../../lib/worker/field-data-reverification');
const migration = require('../../../lib/model/migrations/20261009-04-add-asset-freshness');
const { knexConnect } = require('../../../lib/model/knex-migrator');
const config = require('config');
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
describe('api: asset passports and freshness', () => {
  it('preserves source-linked history, dated knowledge and idempotent expiry tasks with real transactions',
    testServiceFullTrx(async (service, container) => {
      const alice = await service.login('alice');
      const chelsea = await service.login('chelsea');
      const root = '/v1/field-data/projects/1/assets';
      await chelsea.get(root).expect(404);
      const registration = { requestId: uuid(101), name: 'Water point', assetType: 'water-point', externalId: 'WP-01', xmlFormId: 'simple' };
      const asset = await alice.post(root).send(registration).expect(201);
      const path = `${root}/${asset.body.id}`;
      assert.equal(asset.headers['cache-control'], 'private, no-store');
      assert.equal((await alice.post(root).send(registration).expect(201)).headers['idempotency-status'], 'replayed');
      await alice.post(root).send({ ...registration, name: 'Other' }).expect(400);
      await alice.post(root).send({ ...registration, requestId: uuid(102) }).expect(409);
      await alice.post('/v1/projects/1/forms/simple/submissions').send(testData.instances.simple.one)
        .set('Content-Type', 'application/xml').expect(200);
      const claim = (await alice.get('/v1/projects/1/forms/simple/submissions/one/claim').expect(200)).body;
      const observation = { requestId: uuid(103), claimVersionId: claim.currentVersionId,
        predicate: 'condition', state: 'known', value: 'operating', validFrom: '2026-01-01T00:00:00Z',
        validityDays: 10, graceDays: 2, note: 'Recorded from the inspected original.' };
      await alice.post(`${path}/observations`).send(observation).expect(428);
      await alice.post(`${path}/observations`).set('If-Match', asset.headers.etag)
        .send({ ...observation, validFrom: '2026-02-30T00:00:00Z' }).expect(400);
      await alice.post(`${path}/observations`).set('If-Match', asset.headers.etag)
        .send({ ...observation, state: 'unknown' }).expect(400);
      const first = await alice.post(`${path}/observations`).set('If-Match', asset.headers.etag).send(observation).expect(201);
      const replay = await alice.post(`${path}/observations`).set('If-Match', asset.headers.etag).send(observation).expect(201);
      assert.equal(replay.headers['idempotency-status'], 'replayed');
      const historical = (await alice.get(`${path}?at=2026-01-12T00:00:00Z`).expect(200)).body;
      assert.equal(historical.facts[0].freshness.status, 'review-due');
      assert.equal(historical.facts[0].claimVersionId, claim.currentVersionId);
      assert.equal(historical.facts[0].integrityStatus, 'verified');
      await alice.get(historical.facts[0].sourceUrl).expect(200);
      const absent = (await alice.get(`${path}?knownAt=2020-01-01T00:00:00Z`).expect(200)).body;
      assert.deepEqual(absent.facts, []);
      assert.deepEqual(absent.history, []);
      const generated = await Promise.all([generateReverification(container.db), generateReverification(container.db)]);
      assert.equal(generated.flat().length, 1);
      assert.equal((await alice.post(`${path}/refresh`).expect(200)).body.generated, 0);
      assert.equal((await alice.get(path).expect(200)).body.tasks.length, 1);
      const actorId = (await chelsea.get('/v1/users/current').expect(200)).body.id;
      await alice.post(`/v1/projects/1/assignments/viewer/${actorId}`).expect(200);
      const viewer = (await chelsea.get(path).expect(200)).body;
      assert.equal(viewer.allowed, false);
      await chelsea.post(`${path}/observations`).set('If-Match', first.headers.etag).send(observation).expect(404);
      await chelsea.post(`${path}/refresh`).expect(404);
      await alice.delete(`/v1/projects/1/assignments/viewer/${actorId}`).expect(200);
      await chelsea.get(path).expect(404);
      await alice.post(`${path}/observations`).set('If-Match', asset.headers.etag)
        .send({ ...observation, requestId: uuid(104) }).expect(412);
      const correction = { ...observation, value: 'damaged', validFrom: '2026-01-02T00:00:00Z', note: 'Corrected from source evidence.' };
      const competing = await Promise.all([105, 106].map(n => alice.post(`${path}/observations`)
        .set('If-Match', first.headers.etag).send({ ...correction, requestId: uuid(n) })));
      assert.deepEqual(competing.map(result => result.status).sort(), [201, 412]);
      await alice.post(`${path}/refresh`).expect(200);
      const latest = (await alice.get(path).expect(200)).body;
      assert.equal(latest.history.length, 2);
      assert.equal(latest.history[0].previousObservationId, first.body.id);
      await assert.rejects(container.db.query(sql`UPDATE field_data_asset_observations SET value = 'overwritten' WHERE id = ${first.body.id}`));
      assert.equal(latest.facts[0].value, 'damaged');
      assert.equal(latest.tasks.filter(task => task.status === 'superseded').length, 1);
      assert.equal(latest.tasks.filter(task => task.status === 'queued').length, 1);
      let currentEtag = `"asset-${latest.asset.revision}"`;
      const otherProject = (await alice.post('/v1/projects').send({ name: 'Other asset project' }).expect(200)).body;
      await alice.post(`/v1/projects/${otherProject.id}/forms?publish=true&ignoreWarnings=true`)
        .send(testData.forms.simple).set('Content-Type', 'application/xml').expect(200);
      await alice.post(`/v1/projects/${otherProject.id}/forms/simple/submissions`)
        .send(testData.instances.simple.one).set('Content-Type', 'application/xml').expect(200);
      const otherClaim = (await alice.get(`/v1/projects/${otherProject.id}/forms/simple/submissions/one/claim`).expect(200)).body;
      await alice.post(`${path}/observations`).set('If-Match', currentEtag)
        .send({ ...observation, requestId: uuid(108), claimVersionId: otherClaim.currentVersionId }).expect(404);
      await alice.get(`/v1/field-data/projects/${otherProject.id}/assets/${asset.body.id}`).expect(404);

      const audits = await container.db.one(sql`SELECT count(*)::integer AS count FROM audits WHERE action = 'field_data.asset.reverification'`);
      assert.equal(audits.count, 2);
      const future = await alice.post(`${path}/observations`).set('If-Match', currentEtag)
        .send({ ...observation, requestId: uuid(109), value: 'future observation', validFrom: '2030-01-01T00:00:00Z' }).expect(201);
      const late = await alice.post(`${path}/observations`).set('If-Match', future.headers.etag)
        .send({ ...observation, requestId: uuid(110), value: 'late older correction' }).expect(201);
      currentEtag = late.headers.etag;
      assert.equal((await alice.get(path).expect(200)).body.facts[0].value, 'damaged');
      assert.equal((await alice.get(`${path}?at=2030-01-02T00:00:00Z`).expect(200)).body.facts[0].value, 'future observation');
      assert.equal((await alice.post(`${path}/refresh`).expect(200)).body.generated, 0);
      assert.equal((await alice.get(path).expect(200)).body.tasks.filter(task => task.status === 'queued').length, 1);

      // Retained evidence survives actual Knex down/up, not just source inspection.
      const db = knexConnect(config.get('test.database'));
      try { await migration.down(db); await migration.up(db); } finally { await db.destroy(); }
      assert.equal((await alice.get(path).expect(200)).body.history.length, 4);
      await container.db.query(sql`UPDATE submission_defs SET xml = xml || ' '
        WHERE id = (SELECT "submissionDefId" FROM field_data_claim_versions WHERE id = ${claim.currentVersionId})`);
      const tampered = (await alice.get(path).expect(200)).body;
      assert.equal(tampered.facts[0].freshness.status, 'source-unverified');
      await alice.post(`${path}/observations`).set('If-Match', currentEtag)
        .send({ ...observation, requestId: uuid(107) }).expect(400);
      await container.db.query(sql`UPDATE submissions SET "deletedAt" = now() WHERE "instanceId" = 'one'`);
      await alice.get(path).expect(404);
      assert.equal((await generateReverification(container.db)).length, 0);
    }));
});
