// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
//
// Reversible asset merges and splits (K4): docs/field-intelligence/K4-asset-merge-split.md

require('should');
const assert = require('node:assert/strict');
const { sql } = require('slonik');
const { testService } = require('../setup');
const testData = require('../../data/xml');

const root = '/v1/field-data/projects/1/assets';

const setup = async (service) => {
  const alice = await service.login('alice');
  let n = 0;
  const uuid = () => { n += 1; return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`; };
  await alice.post('/v1/projects/1/forms/simple/submissions').send(testData.instances.simple.one)
    .set('Content-Type', 'application/xml').expect(200);
  const claim = (await alice.get('/v1/projects/1/forms/simple/submissions/one/claim').expect(200)).body.currentVersionId;
  const register = async (name, externalId) =>
    (await alice.post(root).send({ requestId: uuid(), name, assetType: 'water-point', externalId, xmlFormId: 'simple' }).expect(201)).body.id;
  const passport = async (id) => alice.get(`${root}/${id}`).expect(200);
  const observe = async (assetId, predicate, value, validFrom, validityDays = 3650) => {
    const { headers } = await passport(assetId);
    return (await alice.post(`${root}/${assetId}/observations`).set('If-Match', headers.etag)
      .send({ requestId: uuid(), claimVersionId: claim, predicate, state: 'known', value, validFrom, validityDays, graceDays: 5,
        note: 'Recorded from the source submission.' }).expect(201)).body.id;
  };
  const facts = async (id) => Object.fromEntries((await passport(id)).body.facts.map((f) => [f.predicate, f.value]));
  const merge = async (keptId, mergedAssetId, status) => {
    const { headers } = await passport(keptId);
    return alice.post(`${root}/${keptId}/merge`).set('If-Match', headers.etag)
      .send({ requestId: uuid(), mergedAssetId, reason: 'Registered twice.' }).expect(status);
  };
  const undo = (operationId, reason = 'Merged in error.') => alice.post(`${root}/operations/${operationId}/undo`).send({ reason });
  return { alice, uuid, register, passport, observe, facts, merge, undo };
};

describe('api: reversible asset merges and splits (K4)', () => {
  it('merges a duplicate, moving its facts and re-verification, and undoes it exactly', testService(async (service, { all }) => {
    const { alice, uuid, register, passport, observe, facts, merge, undo } = await setup(service);
    const kept = await register('Kissy water point', 'WP-1');
    const duplicate = await register('Kissy well', 'WP-1-DUP');
    await observe(kept, 'condition', 'operating', '2026-01-01T00:00:00Z', 30);
    await observe(duplicate, 'condition', 'broken', '2026-03-01T00:00:00Z');
    await observe(duplicate, 'depth', '12', '2026-02-01T00:00:00Z', 30);
    await observe(kept, 'depth', '14', '2026-03-01T00:00:00Z');
    await alice.post(`${root}/${kept}/refresh`).expect(200);
    await alice.post(`${root}/${duplicate}/refresh`).expect(200);
    assert.deepEqual((await passport(duplicate)).body.tasks.map((t) => t.status), ['queued']);
    const taskBefore = (await passport(kept)).body.tasks;
    assert.deepEqual(taskBefore.map((t) => t.status), ['queued']);

    // Revision and input checks.
    const { headers } = await passport(kept);
    await alice.post(`${root}/${kept}/merge`).send({ requestId: uuid(), mergedAssetId: duplicate, reason: 'x' }).expect(428);
    await alice.post(`${root}/${kept}/merge`).set('If-Match', '"asset-99"').send({ requestId: uuid(), mergedAssetId: duplicate, reason: 'x' }).expect(412);
    await alice.post(`${root}/${kept}/merge`).set('If-Match', headers.etag).send({ requestId: uuid(), mergedAssetId: duplicate, reason: ' ' }).expect(400);
    await alice.post(`${root}/${kept}/merge`).set('If-Match', headers.etag).send({ requestId: uuid(), mergedAssetId: kept, reason: 'x' }).expect(409);

    const body = { requestId: uuid(), mergedAssetId: duplicate, reason: 'Registered twice.' };
    const merged = await alice.post(`${root}/${kept}/merge`).set('If-Match', headers.etag).send(body).expect(201);
    assert.equal(merged.body.kind, 'merge');
    assert.notEqual(merged.headers.etag, headers.etag);
    const replay = await alice.post(`${root}/${kept}/merge`).set('If-Match', headers.etag).send(body).expect(201);
    assert.equal(replay.headers['idempotency-status'], 'replayed');
    assert.equal(replay.body.id, merged.body.id);

    // The kept asset's facts now include the duplicate's; the later condition wins.
    assert.deepEqual(await facts(kept), { condition: 'broken', depth: '14' });
    const after = (await passport(kept)).body;
    assert.equal(after.history.length, 4);
    // Both expired facts, the kept asset's and the duplicate's, are no longer current.
    assert.deepEqual(after.tasks.map((t) => t.status), ['superseded', 'superseded']);
    // The duplicate is merged: its passport says where it went, and it takes nothing new.
    const gone = (await passport(duplicate)).body;
    assert.equal(gone.asset.status, 'merged');
    assert.deepEqual(gone.asset.mergedIntoAsset, { id: kept, name: 'Kissy water point', externalId: 'WP-1', status: 'active' });
    assert.deepEqual(gone.facts, []);
    const refused = await alice.post(`${root}/${duplicate}/observations`).set('If-Match', `"asset-${gone.asset.revision}"`)
      .send({ requestId: uuid(), claimVersionId: after.history[0].claimVersionId, predicate: 'condition', state: 'known', value: 'x',
        validFrom: '2026-04-01T00:00:00Z', validityDays: 10, graceDays: 0, note: 'Late.' }).expect(409);
    assert.equal(refused.body.code, 409.41);
    assert.deepEqual((await alice.get(root).expect(200)).body.items.map((a) => a.id), [kept]);
    const projection = (await alice.get(`${root}/projection`).query({ predicate: 'condition' }).expect(200)).body;
    assert.deepEqual(projection.assets.map((a) => [a.id, a.fact.value]), [[kept, 'broken']]);
    const found = (await alice.get('/v1/projects/1/search').query({ q: 'broken' }).expect(200)).body.results.facts;
    assert.deepEqual(found.map((f) => f.assetId), [kept]);
    await merge(kept, duplicate, 409);

    // History of operations; undo restores the previous facts and re-verification exactly.
    const ops = (await alice.get(`${root}/${kept}/operations`).expect(200)).body;
    assert.deepEqual(ops.map((o) => [o.kind, o.observations, o.undoable, o.actorName]), [['merge', 2, true, 'Alice']]);
    await undo(merged.body.id, '').expect(400);
    const undone = await undo(merged.body.id).expect(200);
    assert.ok(undone.body.undoneAt != null);
    assert.equal(undone.body.undoReason, 'Merged in error.');
    assert.deepEqual(await facts(kept), { condition: 'operating', depth: '14' });
    assert.deepEqual(await facts(duplicate), { condition: 'broken', depth: '12' });
    assert.deepEqual((await passport(kept)).body.tasks.map((t) => t.status), ['queued'], 'the task comes back');
    assert.deepEqual((await passport(duplicate)).body.tasks.map((t) => t.status), ['queued'], 'and so does the duplicate\'s');
    assert.equal((await passport(duplicate)).body.asset.status, 'active');
    await undo(merged.body.id).expect(409);
    assert.deepEqual((await alice.get(`${root}/${kept}/operations`).expect(200)).body.map((o) => o.undoable), [false]);
    const audits = await all(sql`SELECT action FROM audits WHERE action LIKE 'field_data.asset.%' AND action IN
      ('field_data.asset.merge', 'field_data.asset.undo', 'field_data.asset.task.superseded', 'field_data.asset.task.restored') ORDER BY id`);
    assert.deepEqual(audits.map((a) => a.action), ['field_data.asset.merge', 'field_data.asset.task.superseded', 'field_data.asset.task.superseded',
      'field_data.asset.undo', 'field_data.asset.task.restored', 'field_data.asset.task.restored']);
  }));

  it('splits observations into a new asset and folds it back on undo', testService(async (service) => {
    const { alice, uuid, register, passport, observe, facts, undo } = await setup(service);
    const pumpHouse = await register('Pump house', 'PH-1');
    const first = await observe(pumpHouse, 'condition', 'operating', '2026-01-01T00:00:00Z');
    const second = await observe(pumpHouse, 'depth', '30', '2026-02-01T00:00:00Z');
    await register('Taken', 'PH-TAKEN');
    const split = async (extra, status) => {
      const { headers } = await passport(pumpHouse);
      return alice.post(`${root}/${pumpHouse}/split`).set('If-Match', headers.etag)
        .send({ requestId: uuid(), observationIds: [second], name: 'Second pump', assetType: 'pump', externalId: 'PH-2',
          reason: 'Two pumps in one record.', ...extra }).expect(status);
    };
    await split({ observationIds: [first, second] }, 409);
    await split({ observationIds: ['00000000-0000-4000-8000-000000000999'] }, 400);
    await split({ observationIds: [] }, 400);
    await split({ externalId: 'PH-TAKEN' }, 409);
    const done = await split({}, 201);
    assert.equal(done.body.kind, 'split');
    const created = done.body.otherAssetId;
    assert.deepEqual(await facts(pumpHouse), { condition: 'operating' });
    assert.deepEqual(await facts(created), { depth: '30' });
    assert.equal((await passport(created)).body.asset.externalId, 'PH-2');

    // Undo folds the new asset back into the one it came from.
    await undo(done.body.id, 'Wrong split.').expect(200);
    assert.deepEqual(await facts(pumpHouse), { condition: 'operating', depth: '30' });
    const folded = (await passport(created)).body.asset;
    assert.equal(folded.status, 'merged');
    assert.equal(folded.mergedIntoAsset.id, pumpHouse);
    // Not once something has been recorded against the new asset itself.
    const again = await split({ externalId: 'PH-3' }, 201);
    await observe(again.body.otherAssetId, 'condition', 'leaking', '2026-03-01T00:00:00Z');
    await undo(again.body.id, 'Wrong split.').expect(409);
  }));

  it('undoes only the latest change involving an asset', testService(async (service) => {
    const { register, observe, facts, merge, undo } = await setup(service);
    const a = await register('A', 'A-1');
    const b = await register('B', 'B-1');
    const c = await register('C', 'C-1');
    await observe(a, 'condition', 'operating', '2026-01-01T00:00:00Z');
    await observe(b, 'condition', 'broken', '2026-02-01T00:00:00Z');
    await observe(c, 'condition', 'repaired', '2026-03-01T00:00:00Z');
    const first = (await merge(a, b, 201)).body;
    const second = (await merge(a, c, 201)).body;
    assert.deepEqual(await facts(a), { condition: 'repaired' });
    const blocked = await undo(first.id).expect(409);
    assert.equal(blocked.body.code, 409.41);
    await undo(second.id).expect(200);
    assert.deepEqual(await facts(a), { condition: 'broken' });
    await undo(first.id).expect(200);
    assert.deepEqual(await facts(a), { condition: 'operating' });
  }));

  it('keeps operations append-only and is for project managers only', testService(async (service, { run, oneFirst }) => {
    const { alice, register, observe, merge, undo } = await setup(service);
    const a = await register('A', 'A-1');
    const b = await register('B', 'B-1');
    await observe(b, 'condition', 'broken', '2026-02-01T00:00:00Z');
    const op = (await merge(a, b, 201)).body;
    await undo(op.id).expect(200);
    const refused = async (statement) => {
      await run(sql`SAVEPOINT guard`);
      await assert.rejects(run(statement), /append-only/);
      await run(sql`ROLLBACK TO SAVEPOINT guard`);
    };
    await refused(sql`UPDATE field_data_asset_operations SET reason = 'rewritten' WHERE id = ${op.id}`);
    await refused(sql`UPDATE field_data_asset_operations SET "undoReason" = 'rewritten' WHERE id = ${op.id}`);
    await refused(sql`UPDATE field_data_asset_operations SET "undoneAt" = NULL, "undoReason" = NULL WHERE id = ${op.id}`);
    await refused(sql`DELETE FROM field_data_asset_operations WHERE id = ${op.id}`);
    await refused(sql`DELETE FROM field_data_asset_reassignments WHERE "operationId" = ${op.id}`);
    await refused(sql`UPDATE field_data_asset_reassignments SET "assetId" = ${b} WHERE "operationId" = ${op.id}`);
    assert.equal(await oneFirst(sql`SELECT count(*)::integer FROM field_data_asset_reassignments WHERE "operationId" = ${op.id}`), 1);

    const chelsea = await service.login('chelsea');
    const chelseaId = (await chelsea.get('/v1/users/current').expect(200)).body.id;
    await chelsea.get(`${root}/${a}/operations`).expect(404);
    await alice.post(`/v1/projects/1/assignments/viewer/${chelseaId}`).expect(200);
    assert.equal((await chelsea.get(`${root}/${a}/operations`).expect(200)).body.length, 1);
    const { headers } = await chelsea.get(`${root}/${a}`).expect(200);
    await chelsea.post(`${root}/${a}/merge`).set('If-Match', headers.etag)
      .send({ requestId: '00000000-0000-4000-8000-000000000777', mergedAssetId: b, reason: 'x' }).expect(404);
    await chelsea.post(`${root}/operations/${op.id}/undo`).send({ reason: 'x' }).expect(404);
    await alice.post(`${root}/operations/00000000-0000-4000-8000-000000000999/undo`).send({ reason: 'x' }).expect(404);
  }));
});
