require('should');
const { sql } = require('slonik');
const { Blob } = require('../../../lib/model/frames');
const { verifyEvidenceBatch } = require('../../../lib/worker/field-data-evidence-verifications');
const { deriveImageMetadataBatch } = require('../../../lib/worker/field-data-image-metadata');
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

  it('records missing attachments, then verifies a received original without erasing history',
    testService(async (service, { run }) => {
      const alice = await service.login('alice');
      const chelsea = await service.login('chelsea');
      await alice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml').send(testData.forms.binaryType).expect(200);
      await alice.post('/v1/projects/1/forms/binaryType/submissions')
        .set('Content-Type', 'application/xml').send(testData.instances.binaryType.both).expect(200);
      const claim = await alice.get('/v1/projects/1/forms/binaryType/submissions/both/claim')
        .expect(200);
      const path = `/v1/field-data/claim-versions/${claim.body.currentVersionId}/evidence`;
      const { items: original } = (await alice.get(path).expect(200)).body;
      original.filter((item) => item.integrityStatus === 'missing').should.have.length(2);

      await alice.post('/v1/projects/1/forms/binaryType/submissions/both/attachments/my_file1.mp4')
        .set('Content-Type', 'image/jpeg').send('original-photo').expect(200);
      const { items } = (await alice.get(path).expect(200)).body;
      const received = items.find((item) => item.name === 'my_file1.mp4'
        && item.integrityStatus === 'verified');
      received.should.not.be.undefined();
      items.filter((item) => item.integrityStatus === 'missing').should.have.length(2);
      (await alice.get(received.downloadUrl).expect(200)).body.toString().should.equal('original-photo');
      await chelsea.get(received.downloadUrl).expect(404);

      await run(sql`UPDATE blobs SET content = decode('74616d7065726564', 'hex')
        WHERE id = (SELECT "blobId" FROM field_data_evidence_records
          WHERE id = ${received.id})`);
      (await alice.get(path).expect(200)).body.items.find((item) => item.id === received.id)
        .integrityStatus.should.equal('mismatch');
      await alice.get(received.downloadUrl).expect(409);
    }));

  it('anchors historical object-store bytes to their upload hash and allows verified reads',
    testService(async (service, container) => {
      const { Blobs, run, s3 } = container;
      const alice = await service.login('alice');
      s3.enableMock();
      await alice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml').send(testData.forms.binaryType).expect(200);
      await alice.post('/v1/projects/1/forms/binaryType/submissions')
        .set('Content-Type', 'application/xml').send(testData.instances.binaryType.both).expect(200);
      const payload = Buffer.from('historical-object');
      const blob = Blob.fromBuffer(payload, 'image/jpeg');
      const blobId = await Blobs.ensure(blob);
      s3.mockExistingBlobs([{ id: blobId, sha: blob.sha, content: payload }]);
      await run(sql`UPDATE blobs SET content = NULL, s3_status = 'uploaded' WHERE id = ${blobId}`);
      await run(sql`UPDATE submission_attachments SET "blobId" = ${blobId}
        WHERE name = 'my_file1.mp4'`);
      const claim = await alice.get('/v1/projects/1/forms/binaryType/submissions/both/claim')
        .expect(200);
      const path = `/v1/field-data/claim-versions/${claim.body.currentVersionId}/evidence`;
      const getRecord = async () => (await alice.get(path).expect(200)).body.items
        .find((item) => item.name === 'my_file1.mp4' && item.integrityStatus !== 'missing');
      (await getRecord()).integrityStatus.should.equal('unverified');
      const result = await verifyEvidenceBatch(container);
      result.should.containEql({ processed: 1, matched: 1, mismatched: 0 });
      (await verifyEvidenceBatch(container)).processed.should.equal(0);
      const verified = await getRecord();
      verified.integrityStatus.should.equal('verified');
      verified.verificationBasis.should.equal('object-store-vs-upload-sha1');
      (await alice.get(verified.downloadUrl).expect(200)).body.toString()
        .should.equal('historical-object');
      s3.mockExistingBlobs([{ id: blobId, sha: blob.sha, content: Buffer.from('modified-object') }]);
      await alice.get(verified.downloadUrl).expect(409);
    }));

  it('keeps image metadata as a separate, authorized, immutable derivation',
    testService(async (service, container) => {
      const { Blobs, run, one } = container;
      const alice = await service.login('alice');
      const chelsea = await service.login('chelsea');
      await alice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml').send(testData.forms.binaryType).expect(200);
      await alice.post('/v1/projects/1/forms/binaryType/submissions')
        .set('Content-Type', 'application/xml').send(testData.instances.binaryType.both).expect(200);
      const png = Buffer.from('89504e470d0a1a0a0000000d494844520000000300000002', 'hex');
      const id = await Blobs.ensure(Blob.fromBuffer(png, 'image/png'));
      await run(sql`UPDATE submission_attachments SET "blobId" = ${id}
        WHERE name = 'here_is_file2.jpg'`);
      const claim = await alice.get('/v1/projects/1/forms/binaryType/submissions/both/claim')
        .expect(200);
      const path = `/v1/field-data/claim-versions/${claim.body.currentVersionId}/evidence`;
      const before = (await alice.get(path).expect(200)).body;
      before.summary.should.containEql({ verified: 2, missing: 2 });
      const result = await deriveImageMetadataBatch(container);
      result.should.containEql({ examined: 1, produced: 1 });
      (await deriveImageMetadataBatch(container)).produced.should.equal(0);
      const evidence = (await alice.get(path).expect(200)).body.items
        .find((item) => item.name === 'here_is_file2.jpg' && item.integrityStatus === 'verified');
      evidence.derivations.should.have.length(1);
      const stored = await one(sql`SELECT "contentHash",
        'sha256:' || encode(sha256(convert_to("outputJson"::text, 'UTF8')), 'hex') AS recomputed,
        "outputJson"::text AS rendered
        FROM field_data_evidence_derivations WHERE id = ${evidence.derivations[0].id}`);
      stored.contentHash.should.equal(stored.recomputed);
      const derivativeRow = await container.FieldDataEvidence.getDerivation(
        evidence.id, evidence.derivations[0].id
      );
      derivativeRow.hashMatches.should.equal(true);
      const derivativePath = `/v1/field-data/evidence/${evidence.id}/derivations/${evidence.derivations[0].id}/content`;
      (await alice.get(derivativePath).expect(200)).body.output
        .should.containEql({ format: 'png', parseStatus: 'parsed', width: 3, height: 2 });
      await chelsea.get(derivativePath).expect(404);
      await run(sql`UPDATE blobs SET content = decode('74616d7065726564', 'hex') WHERE id = ${id}`);
      (await alice.get(path).expect(200)).body.items.find((item) => item.id === evidence.id)
        .integrityStatus.should.equal('mismatch');
    }));
});
