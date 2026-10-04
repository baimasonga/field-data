/* eslint-disable no-template-curly-in-string */
require('should');
const assert = require('node:assert/strict');
const { sql } = require('slonik');
const { testService } = require('../setup');
const { runExports } = require('../../../lib/worker/field-data-exports');
const { storage } = require('../../../lib/external/field-data-storage');
const { runAlerts } = require('../../../lib/worker/field-data-alerts');
const selection = { source: { kind: 'form', id: 1 }, columns: ['/name', '/age'] };
const submit = (user, id, age) => user.post('/v1/projects/1/forms/simple/submissions').set('Content-Type', 'text/xml').send(`<data id="simple"><meta><instanceID>uuid:${id}</instanceID></meta><name>North</name><age>${age}</age></data>`).expect(200);
describe('api: feature completion', () => {
  it('serves the deployed cross-project API walk for an authorized user', testService(async service => {
    const alice = await service.login('alice');
    await submit(alice, 'cross-project-acceptance', 25);
    await alice.get('/v1/users/current').expect(200);
    await alice.get('/v1/projects').expect(200);
    await alice.get('/v1/field-data/forms?limit=1').expect(200);
    await alice.get('/v1/field-data/submissions?limit=1').expect(200);
    await alice.get('/v1/field-data/map?limit=1').expect(200);
  }));
  it('delivers alert transitions once and retries failures without external recipients', testService(async (_, c) => {
    await c.db.query(sql`insert into field_data_operations_events (name,kind,detail) values ('compiler','alert','Synthetic outage')`);
    const db = { connect: work => work(c.db) }; let calls = 0;
    const dependencies = { env: { FIELD_DATA_ALERT_DELIVERY_ENABLED: 'true', FIELD_DATA_ALERT_WEBHOOK_URL: 'https://example.org/fixture' }, deliver: async () => { calls += 1; return { success: calls > 1 }; } };
    await runAlerts(db, dependencies); assert.equal(calls, 1);
    await runAlerts(db, dependencies); assert.equal(calls, 1);
    await c.db.query(sql`update field_data_operations_events set "lastAttemptAt"=clock_timestamp()-interval '6 minutes'`);
    await runAlerts(db, dependencies); await runAlerts(db, dependencies); assert.equal(calls, 2);
    const event = await c.db.one(sql`select * from field_data_operations_events where name='compiler'`); assert.ok(event.deliveredAt); assert.equal(event.attempts, 2);
  }));
  it('links real compiler errors and rejects unauthorized validation', testService(async service => {
    const alice = await service.login('alice'); const chelsea = await service.login('chelsea');
    const body = { schemaVersion: 2, title: 'Logic', formId: 'logic', questions: [{ id: 'question-age', type: 'integer', name: 'age', label: 'Age', constraint: '${AGE} > 0' }] };
    await chelsea.post('/v1/projects/1/form-builder/validate').send(body).expect(403);
    const failed = (await alice.post('/v1/projects/1/form-builder/validate').send(body).expect(200)).body;
    failed.valid.should.equal(false); assert.ok(failed.diagnostics.length);
    body.questions[0].constraint = '. >= 0';
    (await alice.post('/v1/projects/1/form-builder/validate').send(body).expect(200)).body.valid.should.equal(true);
  }));
  it('keeps table, aggregate and filtered/merged sources consistent on populated SQL', testService(async (service, c) => {
    const alice = await service.login('alice'); await submit(alice, 'a', 20); await submit(alice, 'b', 40);
    const filtered = await c.db.one(sql`insert into field_data_filtered_datasets (name, "projectId", "formId", columns, query) values ('Delegated ages', 1, 1, '["/name"]', '[{"column":"/age","filter":">","value":"30","condition":"AND"}]') returning id`);
    const merged = await c.db.one(sql`insert into field_data_merged_datasets (name, "projectId") values ('Merged ages',1) returning id`);
    await c.db.query(sql`insert into field_data_merged_dataset_forms ("mergedDatasetId", "formId") values (${merged.id},1)`);
    const body = { ...selection, query: [{ column: '/age', filter: '>', value: '30', condition: 'AND' }], chart: { column: '/age', groupBy: '/name', aggregation: 'mean' } };
    const form = (await alice.post('/v1/projects/1/analysis/query').send(body).expect(200)).body;
    const merge = (await alice.post('/v1/projects/1/analysis/query').send({ ...body, source: { kind: 'merged', id: merged.id } }).expect(200)).body;
    assert.equal(form.total, 1); assert.equal(merge.total, 1); assert.deepEqual(form.rows, merge.rows); assert.deepEqual(form.chart, merge.chart);
    const delegation = (await alice.post('/v1/projects/1/analysis/query').send({ source: { kind: 'filtered', id: filtered.id }, columns: ['/name'], chart: { column: '/name', aggregation: 'count' } }).expect(200)).body;
    assert.equal(delegation.total, 1); assert.deepEqual(Object.keys(delegation.rows[0].data), ['/name']);
    await alice.post('/v1/projects/1/analysis/query').send({ source: { kind: 'filtered', id: filtered.id }, columns: ['/age'] }).expect(400);
  }));
  it('freezes queued rows, enforces ownership, builds multipart downloads and removes objects', testService(async (service, c) => {
    const alice = await service.login('alice'); const chelsea = await service.login('chelsea'); await submit(alice, 'frozen', 42);
    const request = { ...selection, format: 'csv', id: '77777777-7777-4777-8777-777777777777' };
    const { body: job } = await alice.post('/v1/projects/1/analysis/jobs').send(request).expect(200);
    assert.equal(job.total, 1); await alice.post('/v1/projects/1/analysis/jobs').send(request).expect(200);
    await chelsea.get(`/v1/projects/1/analysis/jobs/${job.id}/download`).expect(404);
    await c.db.query(sql`update submission_defs set xml=replace(xml,'42','99') where "submissionId"=(select id from submissions where "instanceId"='uuid:frozen')`);
    const frozen = await c.db.oneFirst(sql`select row->>'xml' from field_data_export_rows where "jobId"=${job.id}`); assert.match(frozen, /42/);
    await c.db.query(sql`insert into field_data_export_rows ("jobId", row) select ${job.id}::uuid, jsonb_build_object('sourceForm','simple','instanceId','uuid:large-' || n,'submittedAt','2026-10-04T00:00:00Z','xml','<data><name>North</name><age>42</age></data>') from generate_series(1,5100) n`);
    await c.db.query(sql`update field_data_export_jobs set total=5101 where id=${job.id}`);
    await runExports({ connect: work => work(c.db) });
    const result = await c.db.one(sql`select * from field_data_export_jobs where id=${job.id}`);
    try {
      assert.equal(result.status, 'Success'); assert.equal(result.completed, 5101);
      await alice.get(`/v1/projects/1/analysis/jobs/${job.id}/download`).expect(200).expect('Content-Type', /zip/);
      await alice.delete(`/v1/projects/1/analysis/jobs/${job.id}`).expect(200);
      await alice.get(`/v1/projects/1/analysis/jobs/${job.id}/download`).expect(404);
      assert.ok(await c.db.maybeOne(sql`select key from field_data_storage_cleanup where key=${result.storageKey}`));
    } finally { if (result.storageKey) await storage.delete(result.storageKey); }
  }));
  it('closes a retained filtered export when the delegation boundary changes', testService(async (service, c) => {
    const alice = await service.login('alice');
    const dataset = await c.db.one(sql`insert into field_data_filtered_datasets (name, "projectId", "formId", columns, query) values ('Boundary',1,1,'["/name"]','[]') returning id`);
    const { body: job } = await alice.post('/v1/projects/1/analysis/jobs').send({ source: { kind: 'filtered', id: dataset.id }, columns: ['/name'], format: 'csv' }).expect(200);
    await c.db.query(sql`update field_data_filtered_datasets set query='[{"column":"/age","filter":">","value":"30","condition":"AND"}]' where id=${dataset.id}`);
    await alice.get(`/v1/projects/1/analysis/jobs/${job.id}/download`).expect(400);
  }));
});
