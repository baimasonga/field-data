require('should');
const { SCHEMA_VERSION, LINEAGE_BASES, validateClaimVersion, validateClaimChain,
  shapeClaimVersion, shapeClaim } = require('../../../lib/util/claim-versioning');

const CLAIM_ID = 'b6e1d75d-4ef5-4e76-b37a-a868768e36db';
const FIRST_ID = 'e6d10d22-f9cb-4970-a9c5-27afba3a09b7';
const SECOND_ID = '4488be99-8e3b-4997-b24f-2dd365914f58';

const provenance = {
  origin: 'collected',
  sourceRef: null,
  capturedAt: new Date('2026-09-23T09:00:00.000Z'),
  receivedAt: new Date('2026-09-23T10:00:00.000Z'),
  integrityHash: 'a'.repeat(64),
  transformVersion: 'odk-submit@1',
  policyVersion: 'p0.1',
  degraded: null,
  privateColumn: 'not part of the API'
};

const version = (overrides = {}) => ({
  id: FIRST_ID,
  claimId: CLAIM_ID,
  submissionDefId: 101,
  ordinal: 1,
  previousVersionId: null,
  lineageBasis: 'created',
  degraded: null,
  schemaVersion: SCHEMA_VERSION,
  instanceId: 'uuid:root',
  formVersion: '2026-09-01',
  current: true,
  root: true,
  provenance,
  ...overrides
});

const chain = () => [
  version({ current: false }),
  version({
    id: SECOND_ID,
    submissionDefId: 102,
    ordinal: 2,
    previousVersionId: FIRST_ID,
    instanceId: 'uuid:edit-2',
    current: true,
    root: false
  })
];

const expectCode = (operation, code) => {
  let error;
  try {
    operation();
  } catch (caught) {
    error = caught;
  }
  error.should.be.an.Error();
  error.code.should.equal(code);
  error.claimLineageInvalid.should.equal(true);
  return error;
};

describe('(util) claim versioning', () => {
  describe('validateClaimVersion', () => {
    it('accepts the P0.2 version shape', () => {
      validateClaimVersion(version()).should.have.property('id', FIRST_ID);
    });

    it('keeps lineage basis a closed vocabulary', () => {
      LINEAGE_BASES.should.eql(['created', 'backfill-id-order']);
      expectCode(
        () => validateClaimVersion(version({ lineageBasis: 'guessed' })),
        'CLAIM_LINEAGE_INVALID'
      ).message.should.match(/lineageBasis/);
    });

    it('rejects malformed public identifiers before a query can use them', () => {
      expectCode(
        () => validateClaimVersion(version({ id: 'not-a-uuid' })),
        'CLAIM_VERSION_ID_INVALID'
      ).details.should.eql({ field: 'id' });
    });

    it('requires positive integer ordinals and Submission version IDs', () => {
      expectCode(
        () => validateClaimVersion(version({ ordinal: 0 })),
        'CLAIM_LINEAGE_INVALID'
      );
      expectCode(
        () => validateClaimVersion(version({ submissionDefId: 1.5 })),
        'CLAIM_LINEAGE_INVALID'
      );
    });

    it('requires explicit P0.2 schema versioning', () => {
      expectCode(
        () => validateClaimVersion(version({ schemaVersion: 'p0.3' })),
        'CLAIM_LINEAGE_INVALID'
      ).message.should.match(/p0\.2/);
    });

    it('accepts structured degradation but not an unstructured list', () => {
      validateClaimVersion(version({ degraded: { reason: 'historical' } }));
      expectCode(
        () => validateClaimVersion(version({ degraded: ['historical'] })),
        'CLAIM_LINEAGE_INVALID'
      );
    });
  });

  describe('validateClaimChain', () => {
    it('orders a copy by ordinal and leaves query results untouched', () => {
      const input = chain().reverse();
      const originalOrder = input.map((item) => item.id);
      const ordered = validateClaimChain(input);

      ordered.map((item) => item.id).should.eql([FIRST_ID, SECOND_ID]);
      input.map((item) => item.id).should.eql(originalOrder);
    });

    it('requires a mapping rather than manufacturing an empty chain', () => {
      expectCode(() => validateClaimChain([]), 'CLAIM_MAPPING_MISSING');
    });

    it('requires a linear chain that starts at ordinal 1', () => {
      expectCode(
        () => validateClaimChain([version({ ordinal: 2 })]),
        'CLAIM_LINEAGE_INVALID'
      ).message.should.match(/contiguous/);
    });

    it('requires each version to point to its immediate predecessor', () => {
      const versions = chain();
      versions[1].previousVersionId = '852f914e-990d-45bf-a2b6-972e950af804';
      expectCode(
        () => validateClaimChain(versions),
        'CLAIM_LINEAGE_INVALID'
      ).message.should.match(/immediately preceding/);
    });

    it('does not allow versions from different claims in one chain', () => {
      const versions = chain();
      versions[1].claimId = '18e8d9ea-15ab-4e4f-9d9f-a3cc12fcf41b';
      expectCode(
        () => validateClaimChain(versions),
        'CLAIM_LINEAGE_INVALID'
      ).message.should.match(/same claim/);
    });

    it('does not map one Submission version twice', () => {
      const versions = chain();
      versions[1].submissionDefId = versions[0].submissionDefId;
      expectCode(
        () => validateClaimChain(versions),
        'CLAIM_LINEAGE_INVALID'
      ).message.should.match(/only one position/);
    });

    it('allows live versions after a backfill but not backfill after live creation', () => {
      validateClaimChain([
        version({ lineageBasis: 'backfill-id-order', current: false }),
        chain()[1]
      ]).should.have.length(2);

      const invalidChain = chain();
      invalidChain[1].lineageBasis = 'backfill-id-order';
      expectCode(
        () => validateClaimChain(invalidChain),
        'CLAIM_LINEAGE_INVALID'
      ).message.should.match(/cannot follow/);
    });
  });

  describe('response shaping', () => {
    it('returns the public version contract without internal identifiers', () => {
      const shaped = shapeClaimVersion(version());
      shaped.should.eql({
        id: FIRST_ID,
        ordinal: 1,
        previousVersionId: null,
        instanceId: 'uuid:root',
        formVersion: '2026-09-01',
        current: true,
        root: true,
        lineageBasis: 'created',
        degraded: null,
        provenance: {
          origin: 'collected',
          sourceRef: null,
          capturedAt: provenance.capturedAt,
          receivedAt: provenance.receivedAt,
          integrityHash: 'a'.repeat(64),
          transformVersion: 'odk-submit@1',
          policyVersion: 'p0.1',
          degraded: null
        }
      });
      shaped.should.not.have.property('submissionDefId');
      shaped.provenance.should.not.have.property('privateColumn');
    });

    it('does not hide a missing P0.1 provenance mapping', () => {
      expectCode(
        () => shapeClaimVersion(version({ provenance: null })),
        'CLAIM_MAPPING_MISSING'
      ).message.should.match(/P0\.1 provenance/);
    });

    it('refuses to publish an invalid P0.1 provenance envelope', () => {
      expectCode(
        () => shapeClaimVersion(version({
          provenance: { ...provenance, integrityHash: 'not-a-sha256' }
        })),
        'CLAIM_LINEAGE_INVALID'
      ).message.should.match(/invalid P0\.1 provenance/);
    });

    it('builds an ordered claim response and identifies its current version', () => {
      const shaped = shapeClaim({
        claim: { id: CLAIM_ID, submissionId: 731, schemaVersion: SCHEMA_VERSION },
        submission: { id: 731, instanceId: 'uuid:root' },
        versions: chain().reverse()
      });

      shaped.id.should.equal(CLAIM_ID);
      shaped.submissionId.should.equal(731);
      shaped.rootInstanceId.should.equal('uuid:root');
      shaped.currentVersionId.should.equal(SECOND_ID);
      shaped.versions.map((item) => item.id).should.eql([FIRST_ID, SECOND_ID]);
    });

    it('does not hide a missing claim mapping', () => {
      expectCode(
        () => shapeClaim({ claim: null, submission: {}, versions: [] }),
        'CLAIM_MAPPING_MISSING'
      );
    });

    it('requires exactly one current version', () => {
      const versions = chain();
      versions[0].current = true;
      expectCode(
        () => shapeClaim({
          claim: { id: CLAIM_ID, submissionId: 731, schemaVersion: SCHEMA_VERSION },
          submission: { id: 731, instanceId: 'uuid:root' },
          versions
        }),
        'CLAIM_LINEAGE_INVALID'
      ).message.should.match(/exactly one current/);
    });

    it('requires the root version to match the logical Submission', () => {
      expectCode(
        () => shapeClaim({
          claim: { id: CLAIM_ID, submissionId: 731, schemaVersion: SCHEMA_VERSION },
          submission: { id: 731, instanceId: 'uuid:different-root' },
          versions: chain()
        }),
        'CLAIM_LINEAGE_INVALID'
      ).message.should.match(/does not match/);
    });
  });
});
