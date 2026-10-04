/* eslint-disable no-template-curly-in-string */
require('should');
const assert = require('node:assert/strict');
const { sql } = require('slonik');
const { testService } = require('../setup');
const { Form } = require('../../../lib/model/frames');
const testData = require('../../data/xml');
const { normalizeAdvanced, buildAdvanced } = require('../../../lib/util/advanced-form-builder');
const ExcelJS = require('exceljs');
describe('api: remaining feature extensions', () => {
  it('analyzes every repeat occurrence with filters, aggregates and stable pagination', testService(async service => {
    const alice = await service.login('alice');
    await alice.post('/v1/projects/1/forms/withrepeat/submissions').set('Content-Type', 'text/xml').send('<data id="withrepeat" xmlns:orx="http://openrosa.org/xforms" orx:version="1.0"><meta><instanceID>uuid:repeat-analysis</instanceID></meta><name>Parent</name><age>40</age><children><child><name>A</name><age>12</age></child><child><name>B</name><age>18</age></child><child><name>B</name><age>22</age></child></children></data>').expect(200);
    const selection = { source: { kind: 'form', id: 2 }, repeatPath: '/children/child', columns: ['/children/child/name', '/children/child/age'], chart: { column: '/children/child/age', groupBy: '/children/child/name', aggregation: 'mean' } };
    const result = (await alice.post('/v1/projects/1/analysis/query').send({ ...selection, limit: 1 }).expect(200)).body;
    assert.equal(result.total, 3); assert.equal(result.rows[0].repeatIndex, 1); assert.equal(result.rows[0].data['/children/child/age'], '12'); assert.equal(result.chart.rows.find(r => r.key === 'B').value, 20);
    const next = (await alice.post('/v1/projects/1/analysis/query').send({ ...selection, limit: 1, offset: 1 }).expect(200)).body; assert.equal(next.rows[0].repeatIndex, 2);
    const filtered = (await alice.post('/v1/projects/1/analysis/query').send({ ...selection, query: [{ column: '/children/child/age', filter: '>=', value: '18' }] }).expect(200)).body; assert.equal(filtered.total, 2);
    const exportResponse = await alice.post('/v1/projects/1/analysis/export/xlsx').send({ ...selection, query: [{ column: '/children/child/age', filter: '>=', value: '18' }] }).buffer(true).parse((response, callback) => { const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => callback(null, Buffer.concat(chunks))); })
      .expect(200);
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(exportResponse.body); const table = workbook.worksheets.find(w => w.name.startsWith('repeat')); assert.equal(table.rowCount, 3); assert.ok(table.getRow(2).values.includes('18')); assert.ok(table.getRow(3).values.includes('22'));
    await alice.post('/v1/projects/1/analysis/query').send({ ...selection, columns: ['/name'] }).expect(400);
  }));
  it('maps the full filtered selection beyond the table page', testService(async (service, c) => {
    const project = (await c.Projects.getById(1)).get();
    const form = await c.Forms.createNew(await Form.fromXml(testData.forms.simple.replace('id="simple"', 'id="locations"').replace('nodeset="/data/age" type="int"', 'nodeset="/data/age" type="geopoint"')), project); await c.Forms.publish(form, true);
    const alice = await service.login('alice');
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await alice.post('/v1/projects/1/forms/locations/submissions').set('Content-Type', 'text/xml').send(`<data id="locations"><meta><instanceID>uuid:map-${i}</instanceID></meta><name>${i === 2 ? 'Exclude' : 'Include'}</name><age>8.${i + 1} -13.${i + 1} 0 4</age></data>`).expect(200);
    }
    const selection = { source: { kind: 'form', id: form.id }, columns: ['/name', '/age'], geometry: '/age', query: [{ column: '/name', filter: '=', value: 'Include' }], limit: 1 };
    const result = (await alice.post('/v1/projects/1/analysis/query').send(selection).expect(200)).body;
    assert.equal(result.rows.length, 1); assert.equal(result.total, 2); assert.equal(result.map.features.length, 2); assert.equal(result.mapScope, 'full-selection'); assert.ok(result.map.features.every(f => !Object.hasOwn(f.properties, 'name')));
  }));
  it('imports an XLSForm through the authorized API and validates the resulting entity form with the real compiler', testService(async service => {
    const alice = await service.login('alice'); const chelsea = await service.login('chelsea');
    const definition = normalizeAdvanced({ schemaVersion: 2, title: 'Import API', formId: 'import_api', questions: [{ type: 'text', name: 'person', label: 'Person', xlsExtra: { save_to: 'person' } }], extraSheets: [{ name: 'entities', rows: [['dataset', 'label', 'create_if'], ['people', '${person}', 'true()']] }] });
    const file = await buildAdvanced(definition);
    await chelsea.post('/v1/projects/1/form-builder/import').attach('file', file, 'form.xlsx').expect(403);
    const imported = (await alice.post('/v1/projects/1/form-builder/import').attach('file', file, 'form.xlsx').expect(200)).body;
    const validation = (await alice.post('/v1/projects/1/form-builder/validate').send(imported.definition).expect(200)).body;
    assert.equal(validation.valid, true); assert.equal(imported.definition.questions[0].xlsExtra.save_to, 'person');
  }));
  it('shares project views without exposing personal views or granting source access', testService(async service => {
    const alice = await service.login('alice'); const bob = await service.login('bob'); const chelsea = await service.login('chelsea');
    const definition = { source: { kind: 'form', id: 1 }, columns: ['/name'] };
    await alice.post('/v1/projects/1/analysis/views').send({ title: 'Private', definition }).expect(200);
    const shared = (await alice.post('/v1/projects/1/analysis/views').send({ title: 'Team', definition, visibility: 'project' }).expect(200)).body;
    const visible = (await bob.get('/v1/projects/1/analysis/views').expect(200)).body; assert.equal(visible.length, 1); assert.equal(visible[0].title, 'Team'); assert.equal(visible[0].canDelete, true);
    await chelsea.get('/v1/projects/1/analysis/views').expect(403);
    await bob.put(`/v1/projects/1/analysis/views/${shared.id}`).set('If-Match', '"view-0"').send({ title: 'Updated team', definition }).expect(400);
    await bob.put(`/v1/projects/1/analysis/views/${shared.id}`).set('If-Match', '"view-1"').send({ title: 'Updated team', definition }).expect(200);
    await bob.delete(`/v1/projects/1/analysis/views/${shared.id}`).set('If-Match', '"view-2"').expect(200);
  }));
  it('requires explicit field policies and publishes exactly the reviewed allowlist, with revocation', testService(async service => {
    const alice = await service.login('alice'); const chelsea = await service.login('chelsea');
    await alice.post('/v1/projects/1/forms/simple/submissions').set('Content-Type', 'text/xml').send('<data id="simple"><meta><instanceID>uuid:private-id</instanceID></meta><name>Synthetic public answer</name><age>42</age></data>').expect(200);
    const payload = { kind: 'dataset', source: { kind: 'form', id: 1 }, fields: [{ path: '/name', label: 'Approved answer' }], title: 'Synthetic release', attribution: 'Test', license: 'CC0-1.0', releasePolicy: { version: 1, purpose: 'Synthetic acceptance fixture', approvedForPublicRelease: true, allowText: true } };
    await chelsea.post('/v1/projects/1/catalog/preview').send(payload).expect(403);
    await alice.post('/v1/projects/1/catalog/preview').send({ ...payload, releasePolicy: { ...payload.releasePolicy, allowText: false } }).expect(400);
    await alice.post('/v1/projects/1/catalog/preview').send({ ...payload, fields: [{ path: '/meta/instanceID', label: 'Identifier' }] }).expect(400);
    const preview = (await alice.post('/v1/projects/1/catalog/preview').send(payload).expect(200)).body;
    assert.deepEqual(preview.release.records, [{ 'Approved answer': 'Synthetic public answer' }]); assert.ok(!JSON.stringify(preview).includes('private-id')); assert.ok(!Object.keys(preview.release.records[0]).includes('age'));
    await alice.post('/v1/projects/1/catalog/publish').send({ ...payload, previewHash: preview.hash, confirmPublication: false }).expect(400);
    const published = (await alice.post('/v1/projects/1/catalog/publish').send({ ...payload, previewHash: preview.hash, confirmPublication: true }).expect(200)).body;
    assert.deepEqual((await service.get(`/v1/field-data/catalog/${published.id}`).expect(200)).body.release, preview.release);
    await alice.delete(`/v1/projects/1/catalog/${published.id}`).expect(200); await service.get(`/v1/field-data/catalog/${published.id}`).expect(404);
  }));
  it('releases only explicitly approved media bytes and preserves the frozen snapshot', testService(async (service, c) => {
    const project = (await c.Projects.getById(1)).get(); const form = await c.Forms.createNew(await Form.fromXml(testData.forms.binaryType), project); await c.Forms.publish(form, true);
    const alice = await service.login('alice'); const bytes = Buffer.from('synthetic image fixture');
    await alice.post('/v1/projects/1/submission').set('X-OpenRosa-Version', '1.0').attach('xml_submission_file', Buffer.from(testData.instances.binaryType.withFile('private-name.png')), { filename: 'data.xml' }).attach('private-name.png', bytes, { filename: 'private-name.png', contentType: 'image/png' })
      .expect(201);
    const fields = (await alice.post('/v1/projects/1/catalog/fields').send({ source: { kind: 'form', id: form.id } }).expect(200)).body; assert.ok(fields.some(f => f.path === '/file1' && f.binary));
    const payload = { kind: 'dataset', source: { kind: 'form', id: form.id }, fields: [{ path: '/file1', label: 'Approved image' }], title: 'Synthetic media release', attribution: 'Test', license: 'CC0-1.0', releasePolicy: { version: 1, purpose: 'Synthetic media test', approvedForPublicRelease: true, allowMedia: true } };
    await alice.post('/v1/projects/1/catalog/preview').send({ ...payload, releasePolicy: { ...payload.releasePolicy, allowMedia: false } }).expect(400);
    const preview = (await alice.post('/v1/projects/1/catalog/preview').send(payload).expect(200)).body;
    assert.equal(preview.release.records[0]['Approved image'].data, bytes.toString('base64')); assert.ok(!JSON.stringify(preview.release).includes('private-name.png')); assert.ok(!JSON.stringify(preview.release).includes('file2'));
    c.s3.enableMock(); const blobs = await c.db.any(sql`select * from blobs where content=${sql.binary(bytes)}`); c.s3.mockExistingBlobs(blobs);
    await c.db.query(sql`update blobs set s3_status='uploaded', content=null where id=${blobs[0].id}`);
    const externalPreview = (await alice.post('/v1/projects/1/catalog/preview').send(payload).expect(200)).body; assert.deepEqual(externalPreview.release, preview.release);
    const published = (await alice.post('/v1/projects/1/catalog/publish').send({ ...payload, confirmPublication: true, previewHash: preview.hash }).expect(200)).body;
    const anonymous = (await service.get(`/v1/field-data/catalog/${published.id}`).expect(200)).body; assert.deepEqual(anonymous.release, preview.release);
  }));
  it('stores remote credentials encrypted, omits connection details, checks tile access and revokes layers', testService(async (service, c) => {
    const previous = process.env.FIELD_DATA_WEBHOOK_ENCRYPTION_KEY; process.env.FIELD_DATA_WEBHOOK_ENCRYPTION_KEY = '11'.repeat(32);
    try {
      const alice = await service.login('alice'); const chelsea = await service.login('chelsea');
      const config = { title: 'Remote', sourceType: 'wms', url: 'https://8.8.8.8/wms', layers: 'reference', attribution: 'Synthetic provider', authorization: 'Bearer synthetic-secret' };
      await alice.post('/v1/projects/1/map-layers/remote').send({ ...config, url: 'https://127.0.0.1/wms' }).expect(400);
      const saved = (await alice.post('/v1/projects/1/map-layers/remote').send(config).expect(200)).body;
      const row = await c.db.one(sql`select * from field_data_map_layers where id=${saved.id}`); assert.ok(row.remoteConfig.startsWith('v1:')); assert.ok(!row.remoteConfig.includes('synthetic-secret'));
      const layers = (await alice.get('/v1/projects/1/map-layers').expect(200)).body; assert.ok(!JSON.stringify(layers).includes('8.8.8.8')); assert.ok(!JSON.stringify(layers).includes('synthetic-secret'));
      await chelsea.get(`/v1/projects/1/map-layers/${saved.id}/tile?z=1&x=0&y=0`).expect(403);
      await alice.get(`/v1/projects/1/map-layers/${saved.id}/tile?z=1&x=200&y=0`).expect(400);
      await alice.delete(`/v1/projects/1/map-layers/${saved.id}`).set('If-Match', '"layer-1"').expect(200); await alice.get(`/v1/projects/1/map-layers/${saved.id}/tile?z=1&x=0&y=0`).expect(404);
    } finally { if (previous == null) delete process.env.FIELD_DATA_WEBHOOK_ENCRYPTION_KEY; else process.env.FIELD_DATA_WEBHOOK_ENCRYPTION_KEY = previous; }
  }));
});
