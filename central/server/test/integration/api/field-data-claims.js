require('should');
const config = require('config');
const { sql } = require('slonik');
const { knexConnect } = require('../../../lib/model/knex-migrator');
const claimMigration = require('../../../lib/model/migrations/20260923-01-add-claim-versioning');
const evidenceMigration = require('../../../lib/model/migrations/20260923-02-add-xml-evidence');
const attachmentEvidenceMigration = require('../../../lib/model/migrations/20260923-03-add-attachment-evidence');
const verificationMigration = require('../../../lib/model/migrations/20260923-04-add-evidence-verifications');
const derivationMigration = require('../../../lib/model/migrations/20260923-05-add-evidence-derivations');
const idempotencyMigration = require('../../../lib/model/migrations/20260923-06-add-evidence-link-idempotency');
const reviewMigration = require('../../../lib/model/migrations/20260924-01-add-claim-review');
const reviewRoutingMigration = require('../../../lib/model/migrations/20260924-02-route-legacy-review-cases');
const degradedRoutingMigration = require('../../../lib/model/migrations/20260924-05-route-degraded-provenance');
const captureRoutingMigration = require('../../../lib/model/migrations/20260924-06-route-missing-capture-findings');
const backcheckMigration = require('../../../lib/model/migrations/20260924-07-add-backcheck-requests');
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

  it('reports missing mappings to analytics readers', testService(async (service, { oneFirst }) => {
    const asAlice = await service.login('alice');
    const asChelsea = await service.login('chelsea');
    await createSubmission(asAlice);
    await asChelsea.get('/v1/field-data/claim-health').expect(403);
    const healthy = await asAlice.get('/v1/field-data/claim-health').expect(200);
    healthy.body.should.eql({ missingClaims: 0, missingVersions: 0, lineageConflicts: 0 });

    await oneFirst(sql`delete from field_data_claim_versions returning 1`);
    const missing = await asAlice.get('/v1/field-data/claim-health').expect(200);
    missing.body.should.eql({ missingClaims: 0, missingVersions: 1, lineageConflicts: 0 });
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

  it('backfills a stored multi-version Submission and continues the chain',
    testServiceFullTrx(async (service) => {
      const asAlice = await service.login('alice');
      await createSubmission(asAlice);
      await asAlice.put('/v1/projects/1/forms/simple/submissions/one')
        .send(withSimpleIds('one', 'two'))
        .set('Content-Type', 'application/xml').expect(200);

      const db = knexConnect(config.get('test.database'));
      try {
        await db.transaction(async (trx) => {
          await backcheckMigration.down(trx);
          await captureRoutingMigration.down(trx);
          await degradedRoutingMigration.down(trx);
          await reviewRoutingMigration.down(trx);
          await reviewMigration.down(trx);
          await idempotencyMigration.down(trx);
          await derivationMigration.down(trx);
          await verificationMigration.down(trx);
          await attachmentEvidenceMigration.down(trx);
          await evidenceMigration.down(trx);
          await claimMigration.down(trx);
          await claimMigration.up(trx);
          await evidenceMigration.up(trx);
          await attachmentEvidenceMigration.up(trx);
          await verificationMigration.up(trx);
          await derivationMigration.up(trx);
          await idempotencyMigration.up(trx);
          await reviewMigration.up(trx);
          await reviewRoutingMigration.up(trx);
          await degradedRoutingMigration.up(trx);
          await captureRoutingMigration.up(trx);
          await backcheckMigration.up(trx);
        });
      } finally {
        await db.destroy();
      }

      const { body } = await asAlice.get(claimPath).expect(200);
      body.versions.map((version) => version.ordinal).should.eql([1, 2]);
      body.versions[0].lineageBasis.should.equal('backfill-id-order');
      body.versions[1].previousVersionId.should.equal(body.versions[0].id);
      body.versions[1].degraded.reason.should.equal('historical-lineage-inferred');

      await asAlice.put('/v1/projects/1/forms/simple/submissions/one')
        .send(withSimpleIds('two', 'three'))
        .set('Content-Type', 'application/xml').expect(200);
      const continued = await asAlice.get(claimPath).expect(200);
      continued.body.id.should.equal(body.id);
      continued.body.versions.map((version) => version.ordinal).should.eql([1, 2, 3]);
      continued.body.versions[2].previousVersionId.should.equal(body.versions[1].id);
      continued.body.versions[2].lineageBasis.should.equal('created');
    }));
});
