require('should');
const { sql } = require('slonik');
const { testService, testServiceFullTrx } = require('../setup');
const testData = require('../../data/xml');

const claimPath = '/v1/projects/1/forms/simple/submissions/one/claim';
const withSimpleIds = (deprecatedId, instanceId) => testData.instances.simple.one
  .replace('one</instance', `${instanceId}</instanceID><deprecatedID>${deprecatedId}</deprecated`);
const createSubmission = (client) => client.post('/v1/projects/1/forms/simple/submissions')
  .send(testData.instances.simple.one).set('Content-Type', 'application/xml').expect(200);

describe('api: P0.2 claim versioning', () => {
  it('maps each new ODK Submission to claim, version, and provenance', testService(async (service) => {
    const asAlice = await service.login('alice');
    await createSubmission(asAlice);
    const { body } = await asAlice.get(claimPath).expect(200);
    body.id.should.match(/^[0-9a-f-]{36}$/);
    body.rootInstanceId.should.equal('one');
    body.currentVersionId.should.equal(body.versions[0].id);
    body.versions.should.have.length(1);
    body.versions[0].should.containEql({ ordinal: 1, previousVersionId: null,
      current: true, root: true, lineageBasis: 'created' });
    body.versions[0].should.not.have.property('submissionDefId');
    body.versions[0].provenance.should.containEql({ origin: 'collected',
      policyVersion: 'p0.1', transformVersion: 'odk-submit@1',
      degraded: { capturedAt: 'unknown' } });
    body.versions[0].provenance.integrityHash.should.match(/^[0-9a-f]{64}$/);
  }));

  it('appends an edit and returns the exact version detail', testService(async (service) => {
    const asAlice = await service.login('alice');
    await createSubmission(asAlice);
    await asAlice.put('/v1/projects/1/forms/simple/submissions/one')
      .send(withSimpleIds('one', 'two')).set('Content-Type', 'application/xml').expect(200);
    const { body } = await asAlice.get(claimPath).expect(200);
    body.versions.map((version) => version.ordinal).should.eql([1, 2]);
    body.versions[0].current.should.equal(false);
    body.versions[1].previousVersionId.should.equal(body.versions[0].id);
    body.versions[1].provenance.transformVersion.should.equal('odk-edit@1');
    body.currentVersionId.should.equal(body.versions[1].id);
    const detail = await asAlice.get(`/v1/field-data/claim-versions/${body.currentVersionId}`)
      .expect(200);
    detail.body.claim.id.should.equal(body.id);
    detail.body.project.id.should.equal(1);
    detail.body.form.xmlFormId.should.equal('simple');
  }));

  it('preserves a claim version on identical OpenRosa retry', testService(async (service) => {
    const asAlice = await service.login('alice');
    const upload = () => asAlice.post('/v1/projects/1/submission')
      .set('X-OpenRosa-Version', '1.0')
      .attach('xml_submission_file', Buffer.from(testData.instances.simple.one),
        { filename: 'data.xml' }).expect(201);
    await upload();
    await upload();
    const { body } = await asAlice.get(claimPath).expect(200);
    body.versions.should.have.length(1);
  }));

  it('rejects malformed IDs and hides claims from unauthorized readers', testService(async (service) => {
    const asAlice = await service.login('alice');
    const asChelsea = await service.login('chelsea');
    await createSubmission(asAlice);
    await service.get(claimPath).expect(401);
    await asChelsea.get(claimPath).expect(404);
    const bad = await asAlice.get('/v1/field-data/claim-versions/not-a-uuid').expect(400);
    bad.body.code.should.equal(400.44);
    const claim = await asAlice.get(claimPath).expect(200);
    await asChelsea.get(`/v1/field-data/claim-versions/${claim.body.currentVersionId}`)
      .expect(404);
  }));

  it('cascades versions when a deleted Submission is purged', testService(async (service,
    { Submissions, oneFirst }) => {
    const asAlice = await service.login('alice');
    await createSubmission(asAlice);
    await asAlice.delete('/v1/projects/1/forms/simple/submissions/one').expect(200);
    await Submissions.purge(true);
    (await oneFirst(sql`select count(*)::integer from field_data_claims`)).should.equal(0);
    (await oneFirst(sql`select count(*)::integer from field_data_claim_versions`)).should.equal(0);
  }));

  it('prevents two concurrent edits from branching', testServiceFullTrx(async (service) => {
    const asAlice = await service.login('alice');
    await createSubmission(asAlice);
    const edit = (id) => asAlice.put('/v1/projects/1/forms/simple/submissions/one')
      .send(withSimpleIds('one', id)).set('Content-Type', 'application/xml');
    const responses = await Promise.all([edit('two'), edit('three')]);
    responses.map(({ status }) => status).sort().should.eql([200, 409]);
    const { body } = await asAlice.get(claimPath).expect(200);
    body.versions.should.have.length(2);
  }));
});
