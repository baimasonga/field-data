require('should');
const { ORIGINS, canonicalHash, buildEnvelope, validateEnvelope } = require('../../../lib/util/provenance');

const base = { origin: 'collected', xml: '<data/>', transformVersion: 'test@1' };

describe('(util) provenance', () => {
  describe('canonicalHash', () => {
    it('is a lowercase sha256 of the bytes', () => {
      canonicalHash('<data/>').should.match(/^[0-9a-f]{64}$/);
    });

    it('is stable across calls on the same input', () => {
      canonicalHash('<data>é</data>').should.equal(canonicalHash('<data>é</data>'));
    });

    it('hashes the bytes, not the characters', () => {
      // A hash that differed between a string and its own UTF-8 buffer would
      // answer "is this still what arrived" differently depending on how the
      // caller happened to hold it.
      canonicalHash('<data>é</data>')
        .should.equal(canonicalHash(Buffer.from('<data>é</data>', 'utf8')));
    });

    it('distinguishes content that differs only outside ASCII', () => {
      canonicalHash('<data>é</data>').should.not.equal(canonicalHash('<data>e</data>'));
    });
  });

  describe('buildEnvelope', () => {
    it('marks an unknown capture time rather than substituting the receipt time', () => {
      const envelope = buildEnvelope(base);
      (envelope.capturedAt === null).should.equal(true);
      envelope.degraded.should.eql({ capturedAt: 'unknown' });
    });

    it('keeps a capture time it was given', () => {
      const capturedAt = new Date('2026-09-01T10:00:00.000Z');
      const envelope = buildEnvelope({ ...base, capturedAt });
      envelope.capturedAt.toISOString().should.equal('2026-09-01T10:00:00.000Z');
      (envelope.degraded === null).should.equal(true);
    });

    it('accepts a capture time inside clock skew without comment', () => {
      const now = new Date('2026-09-01T10:00:00.000Z');
      const envelope = buildEnvelope({
        ...base, now, capturedAt: new Date(now.valueOf() + 60_000)
      });
      (envelope.degraded === null).should.equal(true);
    });

    it('records an implausible capture time rather than correcting it', () => {
      const now = new Date('2026-09-01T10:00:00.000Z');
      const capturedAt = new Date(now.valueOf() + (60 * 60 * 1000));
      const envelope = buildEnvelope({ ...base, now, capturedAt });
      envelope.degraded.should.eql({ capturedAt: 'implausible' });
      // Still the value it was given. A reviewer can judge a wrong clock; they
      // cannot judge a timestamp somebody quietly moved.
      envelope.capturedAt.valueOf().should.equal(capturedAt.valueOf());
    });

    it('marks a capture time it cannot read', () => {
      buildEnvelope({ ...base, capturedAt: 'not a date' })
        .degraded.should.eql({ capturedAt: 'unparseable' });
    });

    it('stamps the policy version so a row says which rules made it', () => {
      buildEnvelope(base).policyVersion.should.equal('p0.1');
    });
  });

  describe('validateEnvelope', () => {
    it('requires provenance at all', () => {
      (() => validateEnvelope(null)).should.throw(/required/);
    });

    it('refuses an origin outside the closed vocabulary', () => {
      (() => validateEnvelope({ ...buildEnvelope(base), origin: 'guessed' }))
        .should.throw(/origin must be one of/);
    });

    it('accepts every origin the vocabulary allows', () => {
      for (const origin of ORIGINS)
        validateEnvelope(buildEnvelope({ ...base, origin })).origin.should.equal(origin);
    });

    it('refuses a hash that is not a sha256 digest', () => {
      (() => validateEnvelope({ ...buildEnvelope(base), integrityHash: 'DEADBEEF' }))
        .should.throw(/sha256/);
    });

    it('refuses a row that will not say what produced it', () => {
      (() => validateEnvelope({ ...buildEnvelope(base), transformVersion: '' }))
        .should.throw(/what produced the row/);
    });

    it('refuses a capturedAt that is neither an instant nor null', () => {
      (() => validateEnvelope({ ...buildEnvelope(base), capturedAt: '2026-09-01' }))
        .should.throw(/instant or null/);
    });

    it('passes an envelope it just built', () => {
      validateEnvelope(buildEnvelope(base)).should.have.property('integrityHash');
    });
  });
});
