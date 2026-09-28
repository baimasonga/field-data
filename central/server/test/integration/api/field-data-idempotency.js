require('should');
const { sql } = require('slonik');
const { testService, testServiceFullTrx } = require('../setup');
const testData = require('../../data/xml');

const create = (alice) => alice.post('/v1/projects/1/forms/simple/submissions')
  .set('Content-Type', 'application/xml').send(testData.instances.simple.one).expect(200);
const path = (id) => `/v1/field-data/claim-versions/${id}/evidence-links`;

describe('api: P0.4 evidence link retries', () => {
  it('replays one link and one audit; rejects key reuse for different work',
    testService(async (service, { oneFirst }) => {
      const alice = await service.login('alice');
      const chelsea = await service.login('chelsea');
      await create(alice);
      const claim = (await alice.get('/v1/projects/1/forms/simple/submissions/one/claim')
        .expect(200)).body;
      const claimVersionId = claim.currentVersionId;
      const evidenceId = (await alice.get(
        `/v1/field-data/claim-versions/${claimVersionId}/evidence`
      ).expect(200)).body.items[0].id;
      const payload = { evidenceId, relation: 'supports' };
      const url = path(claimVersionId);
      await alice.post(url).send(payload).expect(400);
      await alice.post(url).set('Idempotency-Key', 'bad key').send(payload).expect(400);
      await chelsea.post(url).set('Idempotency-Key', 'retry-one').send(payload).expect(404);
      const first = await alice.post(url).set('Idempotency-Key', 'retry-one')
        .send(payload).expect(201);
      first.headers['idempotency-status'].should.equal('created');
      const replay = await alice.post(url).set('Idempotency-Key', 'retry-one')
        .send({ relation: 'supports', evidenceId }).expect(201);
      replay.headers['idempotency-status'].should.equal('replayed');
      replay.body.id.should.equal(first.body.id);
      (await alice.post(url).set('Idempotency-Key', 'retry-one')
        .send({ evidenceId, relation: 'contradicts' }).expect(409)).body.code
        .should.equal(409.29);
      (await oneFirst(sql`SELECT count(*)::integer FROM field_data_claim_evidence
        WHERE "claimVersionId" = ${claimVersionId} AND relation = 'supports'`)).should.equal(1);
      (await oneFirst(sql`SELECT count(*)::integer FROM audits
        WHERE action = 'field_data.evidence.link.create'`)).should.equal(1);
    }));

  it('makes concurrent identical requests converge on one link',
    testServiceFullTrx(async (service, { oneFirst }) => {
      const alice = await service.login('alice');
      await create(alice);
      const claim = (await alice.get('/v1/projects/1/forms/simple/submissions/one/claim')
        .expect(200)).body;
      const id = claim.currentVersionId;
      const evidenceId = (await alice.get(`/v1/field-data/claim-versions/${id}/evidence`)
        .expect(200)).body.items[0].id;
      const upload = () => alice.post(path(id)).set('Idempotency-Key', 'race-one')
        .send({ evidenceId, relation: 'supports' });
      const responses = await Promise.all([upload(), upload()]);
      responses.map((r) => r.status).should.eql([201, 201]);
      responses[0].body.id.should.equal(responses[1].body.id);
      responses.map((r) => r.headers['idempotency-status']).sort()
        .should.eql(['created', 'replayed']);
      (await oneFirst(sql`SELECT count(*)::integer FROM audits
        WHERE action = 'field_data.evidence.link.create'`)).should.equal(1);
    }));
});
