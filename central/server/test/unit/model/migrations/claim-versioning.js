const should = require('should');
const { buildBackfillRows } = require('../../../../lib/model/migrations/20260923-01-add-claim-versioning');

const rows = () => [
  { id: 13, submissionId: 8, root: false, current: true },
  { id: 4, submissionId: 7, root: false, current: true },
  { id: 3, submissionId: 7, root: true, current: false },
  { id: 12, submissionId: 8, root: true, current: false }
];
const uuidFactory = () => {
  let index = 0;
  return () => {
    index += 1;
    return `00000000-0000-0000-0000-${String(index).padStart(12, '0')}`;
  };
};

describe('(migration) P0.2 claim versioning', () => {
  it('groups versions in internal ID order with one predecessor per successor', () => {
    const { claims, versions } = buildBackfillRows(rows(), uuidFactory());
    claims.map((claim) => claim.submissionId).should.eql([7, 8]);
    versions.map((version) => version.submissionDefId).should.eql([3, 4, 12, 13]);
    versions.map((version) => version.ordinal).should.eql([1, 2, 1, 2]);
    should(versions[0].previousVersionId).be.null();
    versions[1].previousVersionId.should.equal(versions[0].id);
    versions[3].previousVersionId.should.equal(versions[2].id);
    versions[1].claimId.should.equal(claims[0].id);
    versions[3].claimId.should.equal(claims[1].id);
    versions[0].degraded.should.eql({
      reason: 'historical-lineage-inferred',
      assumption: 'submission_defs.id order reflects committed version order',
      auditCompleteness: 'not-required'
    });
    versions[0].lineageBasis.should.equal('backfill-id-order');
  });

  it('stops on ambiguous root and current flags', () => {
    (() => buildBackfillRows([{ id: 1, submissionId: 7, root: false, current: true }]))
      .should.throw(/CLAIM_BACKFILL_AMBIGUOUS.*one root/);
    (() => buildBackfillRows([
      { id: 1, submissionId: 7, root: true, current: true },
      { id: 2, submissionId: 7, root: false, current: true }
    ])).should.throw(/one current version/);
  });

  it('stops when the root is not first or submissionId is absent', () => {
    (() => buildBackfillRows([
      { id: 1, submissionId: 7, root: false, current: false },
      { id: 2, submissionId: 7, root: true, current: true }
    ])).should.throw(/root is not the first/);
    (() => buildBackfillRows([{ id: 1, submissionId: null, root: true, current: true }]))
      .should.throw(/missing submissionId/);
  });
});
