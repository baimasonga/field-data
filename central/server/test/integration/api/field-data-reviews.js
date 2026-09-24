// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

require('should');
const { strict: assert } = require('assert');
const { sql } = require('slonik');
const { testService } = require('../setup');
const testData = require('../../data/xml');

describe('api: P0.5 review case detail', () => {
  it('scopes the exact claim and decisions to authorized form readers',
    testService(async (service, { one, run }) => {
      const alice = await service.login('alice');
      const chelsea = await service.login('chelsea');
      await alice.post('/v1/projects/1/forms/simple/submissions')
        .send(testData.instances.simple.one).set('Content-Type', 'application/xml').expect(200);
      const claim = (await alice.get('/v1/projects/1/forms/simple/submissions/one/claim')
        .expect(200)).body;
      const reviewCase = await one(sql`INSERT INTO field_data_review_cases
        ("claimVersionId", "reasonCodes")
        VALUES (${claim.currentVersionId}, '["manual-referral"]'::jsonb)
        RETURNING id`);
      const decision = await one(sql`INSERT INTO field_data_review_decisions
        ("caseId", "claimVersionId", sequence, outcome, "reasonCode",
          "evidenceSnapshot", "evidenceSnapshotHash", "integritySnapshot")
        VALUES (${reviewCase.id}, ${claim.currentVersionId}, 1, 'needs-evidence',
          'manual-referral', '[]'::jsonb, ${`sha256:${'0'.repeat(64)}`}, '[]'::jsonb)
        RETURNING id`);
      const path = `/v1/field-data/review-queue/${reviewCase.id}`;
      const response = await alice.get(path).expect(200);
      response.headers.etag.should.equal('"review-case-1"');
      response.body.claim.id.should.equal(claim.currentVersionId);
      response.body.reasonCodes.should.deepEqual(['manual-referral']);
      response.body.decisions[0].id.should.equal(decision.id);
      await chelsea.get(path).expect(404);
      await alice.get('/v1/field-data/review-queue/not-a-uuid').expect(404);
      await assert.rejects(run(sql`DELETE FROM field_data_review_decisions
        WHERE id = ${decision.id}`), /Review decisions are append-only/);
    }));
});
