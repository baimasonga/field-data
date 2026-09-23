require('should');
const { sql } = require('slonik');
const { testService } = require('../setup');
const testData = require('../../data/xml');

describe('api: P0.3 XML evidence', () => {
  it('registers exact stored XML and serves it only to project readers', testService(async (service) => {
    const alice = await service.login('alice');
    const chelsea = await service.login('chelsea');
    await alice.post('/v1/projects/1/forms/simple/submissions')
      .send(testData.instances.simple.one).set('Content-Type', 'application/xml').expect(200);
    const claim = await alice.get('/v1/projects/1/forms/simple/submissions/one/claim').expect(200);
    const path = `/v1/field-data/claim-versions/${claim.body.currentVersionId}/evidence`;
    const { body } = await alice.get(path).expect(200);
    body.items.should.have.length(1);
    const [record] = body.items;
    record.should.containEql({ sourceKind: 'submission-xml', relation: 'context',
      integrityStatus: 'verified', mimeType: 'application/xml' });
    record.contentHash.should.match(/^sha256:[0-9a-f]{64}$/);
    (await alice.get(`/v1/field-data/evidence/${record.id}`).expect(200)).body
      .contentHash.should.equal(record.contentHash);
    (await alice.get(record.downloadUrl).expect(200)).text
      .should.equal(testData.instances.simple.one);
    await chelsea.get(path).expect(404);
    await chelsea.get(`/v1/field-data/evidence/${record.id}`).expect(404);
    await chelsea.get(record.downloadUrl).expect(404);
  }));

  it('reports a changed stored digest and refuses to serve it as verified',
    testService(async (service, { run }) => {
      const alice = await service.login('alice');
      await alice.post('/v1/projects/1/forms/simple/submissions')
        .send(testData.instances.simple.one).set('Content-Type', 'application/xml').expect(200);
      const claim = await alice.get('/v1/projects/1/forms/simple/submissions/one/claim').expect(200);
      const path = `/v1/field-data/claim-versions/${claim.body.currentVersionId}/evidence`;
      const record = (await alice.get(path).expect(200)).body.items[0];
      await run(sql`UPDATE submission_defs SET xml = xml || ' '
        WHERE id = (SELECT "submissionDefId" FROM field_data_evidence_records
          WHERE id = ${record.id})`);
      (await alice.get(path).expect(200)).body.items[0]
        .integrityStatus.should.equal('mismatch');
      (await alice.get(record.downloadUrl).expect(409)).body.code.should.equal(409.26);
    }));
});
