require('should');
const assert = require('node:assert/strict');
const { sql } = require('slonik');
const { testService } = require('../setup');
const { storage } = require('../../../lib/external/field-data-storage');
const testData = require('../../data/xml');
const layer = { title: 'Reference', data: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [-13, 8] }, properties: { category: '<script>alert(1)</script>' } }] } };
describe('api: feature capabilities', () => {
  it('persists layer files, guards readers and detects stale updates', testService(async (service, container) => {
    const alice = await service.login('alice'); const chelsea = await service.login('chelsea');
    const { body } = await alice.post('/v1/projects/1/map-layers').send(layer).expect(200);
    const rows = await container.db.any(sql`select "storageKey" from field_data_map_layers where id=${body.id}`);
    try {
      const { body: saved } = await alice.get('/v1/projects/1/map-layers').expect(200); saved.length.should.equal(1); saved[0].data.should.eql(layer.data);
      await chelsea.get('/v1/projects/1/map-layers').expect(403);
      await alice.put(`/v1/projects/1/map-layers/${body.id}`).set('If-Match', '"layer-0"').send({ visible: false }).expect(400);
      await alice.put(`/v1/projects/1/map-layers/${body.id}`).set('If-Match', '"layer-1"').send({ visible: false }).expect(200);
      const { body: other } = await alice.post('/v1/projects/1/map-layers').send({ ...layer, title: 'Other reference' }).expect(200);
      await alice.put(`/v1/projects/1/map-layers/${other.id}`).set('If-Match', '"layer-1"').send({ position: 0 }).expect(200);
      const ordered = (await alice.get('/v1/projects/1/map-layers').expect(200)).body;
      ordered.map(l => l.title).should.eql(['Other reference', 'Reference']); ordered.map(l => l.position).should.eql([0, 1]);
      await alice.delete(`/v1/projects/1/map-layers/${body.id}`).set('If-Match', '"layer-3"').expect(200);
      await alice.delete(`/v1/projects/1/map-layers/${other.id}`).set('If-Match', '"layer-2"').expect(200);
      (await alice.get('/v1/projects/1/map-layers').expect(200)).body.should.eql([]);
      (await container.db.any(sql`select key from field_data_storage_cleanup`)).length.should.equal(4);
    } finally {
      const keys = await container.db.any(sql`select key from field_data_storage_cleanup`);
      await Promise.all([...rows.map(r => r.storageKey), ...keys.map(r => r.key)].map(k => storage.delete(k)));
    }
  }));
  it('public discovery starts empty and rejects free-text publication', testService(async service => {
    (await service.get('/v1/field-data/catalog').expect(200)).body.should.eql([]);
    const alice = await service.login('alice');
    await alice.post('/v1/projects/1/catalog/preview').send({ source: { kind: 'form', id: 1 }, column: '/name', title: 'Test', label: 'Region', attribution: 'Synthetic', license: 'CC0-1.0', categories: ['A', 'B'] }).expect(400);
  }));
  it('preview matches anonymous release; revocation closes direct URLs', testService(async (service, c) => {
    const alice = await service.login('alice');
    for (let i = 0; i < 10; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await alice.post('/v1/projects/1/forms/simple/submissions').set('Content-Type', 'text/xml').send(`<data id="simple"><meta><instanceID>uuid:catalog-${i}</instanceID></meta><name>${i < 5 ? 'A' : 'B'}</name><age>30</age></data>`).expect(200);
    }
    const xml = testData.forms.simple.replace('<input ref="/data/name">', '<select1 ref="/data/name">').replace('</input>', '</select1>');
    await c.db.query(sql`update form_defs set xml=${xml} where id=(select "currentDefId" from forms where id=1)`);
    const config = { source: { kind: 'form', id: 1 }, column: '/name', title: 'Synthetic distribution', label: 'Region', attribution: 'Fixture', license: 'CC0-1.0', categories: ['A', 'B'] };
    const { body: preview } = await alice.post('/v1/projects/1/catalog/preview').send(config).expect(200);
    preview.release.values.length.should.equal(2);
    const { body: published } = await alice.post('/v1/projects/1/catalog/publish').send({ ...config, previewHash: preview.hash, confirmPublication: true }).expect(200);
    const { body: anonymous, headers } = await service.get(`/v1/field-data/catalog/${published.id}`).expect(200);
    assert.deepEqual(anonymous.release, preview.release); headers['cache-control'].should.equal('no-store');
    assert.ok(!JSON.stringify(anonymous).includes('instanceId'));
    (await service.get('/v1/field-data/catalog?q=Synthetic').expect(200)).body.length.should.equal(1);
    await alice.delete(`/v1/projects/1/catalog/${published.id}`).expect(200);
    await service.get(`/v1/field-data/catalog/${published.id}`).expect(404);
    (await service.get('/v1/field-data/catalog').expect(200)).body.should.eql([]);
  }));
  it('operations policy is privileged and bounded', testService(async service => {
    const alice = await service.login('alice'); const chelsea = await service.login('chelsea');
    await chelsea.get('/v1/field-data/operations').expect(403);
    const { body } = await alice.get('/v1/field-data/operations').expect(200); body.policy.scheduledBackups.should.equal(false);
    await alice.put('/v1/field-data/operations/policy').send({ ...body.policy, backupHour: 24 }).expect(400);
    await alice.put('/v1/field-data/operations/policy').send({ ...body.policy, failAfter: 2 }).expect(200);
  }));
});
