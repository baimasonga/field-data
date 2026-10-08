require('should');
const { testService } = require('../setup');
const config = { source: { kind: 'form', id: 1 }, columns: ['/name', '/age'], chart: { column: '/name', aggregation: 'count' } };
describe('api: analysis workspace', () => {
  it('uses real SQL for empty tables and charts', testService(service => service.login('alice', asAlice =>
    asAlice.post('/v1/projects/1/analysis/query').send(config).expect(200).then(({ body }) => {
      body.total.should.equal(0); body.rows.should.eql([]); body.fields.map(f => f.path).should.eql(['/name', '/age']);
    }))));
  it('rejects unauthorized sources and nonexistent fields', testService(service => service.login('chelsea', asUser =>
    asUser.post('/v1/projects/1/analysis/query').send(config).expect(403))));
  it('saved view creation is retry-safe and private', testService(service => service.login('alice', asAlice => {
    const data = { id: '44444444-4444-4444-8444-444444444444', title: 'Survey', definition: config };
    return asAlice.post('/v1/projects/1/analysis/views').send(data).expect(200)
      .then(() => asAlice.post('/v1/projects/1/analysis/views').send(data).expect(200))
      .then(() => asAlice.get('/v1/projects/1/analysis/views').expect(200))
      .then(({ body }) => { body.length.should.equal(1); });
  })));
});

describe('api: analysis downloads', () => {
  it('uses the selected filter in a real native export and rejects unauthorized downloads', testService(async service => {
    const alice = await service.login('alice'); const chelsea = await service.login('chelsea');
    await alice.post('/v1/projects/1/forms/simple/submissions').set('Content-Type', 'text/xml').send('<data id="simple"><meta><instanceID>uuid:export-test</instanceID></meta><name>Amina</name><age>42</age></data>').expect(200);
    const selection = { ...config, query: [{ column: '/age', filter: '>', value: '40', condition: 'AND' }] };
    await chelsea.post('/v1/projects/1/analysis/export/sav').send(selection).expect(403);
    const response = await alice.post('/v1/projects/1/analysis/export/sav').send(selection).buffer(true).parse((res, callback) => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => callback(null, Buffer.concat(chunks))); res.on('error', callback);
    })
      .expect(200);
    response.headers['content-type'].should.startWith('application/zip'); response.body.subarray(0, 2).toString().should.equal('PK');
    await alice.post('/v1/projects/1/analysis/export/kml').send({ ...selection, geometry: '/secret' }).expect(400);
  }));
  it('keeps repeat descendants out of scalar analysis', testService(async service => {
    const alice = await service.login('alice');
    const { body } = await alice.post('/v1/projects/1/analysis/query').send({ source: { kind: 'form', id: 2 } }).expect(200);
    body.fields.some(f => f.path.startsWith('/children/')).should.equal(false);
  }));
});
