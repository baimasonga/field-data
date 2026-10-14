require('should');
const { generateKeyPairSync, verify } = require('node:crypto');
const { issue, boundItineraries } = require('../../../lib/util/offline-assignments');
describe('(util) bounded signed offline itineraries', () => {
  it('keeps whole approved itineraries within date and stop bounds and reports omissions', () => {
    const plans = Array.from({ length: 6 }, (_, i) => ({ id: String(i), stops: Array(20).fill({}) }));
    const bounded = boundItineraries(plans);
    bounded.items.map(p => p.id).should.eql(['0', '1', '2', '3', '4']); bounded.complete.should.be.false(); bounded.omitted.should.equal(1);
    const prioritized = boundItineraries([{ id: 'past', date: '2026-10-12', stops: [] }, { id: 'future', date: '2026-10-14', stops: [] }, { id: 'today', date: '2026-10-13', stops: [] }], new Date('2026-10-13T12:00:00Z'));
    prioritized.items.map(p => p.id).should.eql(['today', 'future', 'past']);
    const oversized = boundItineraries([{ id: 'large', stops: Array(101).fill({}) }, { id: 'small', stops: [{}] }]);
    oversized.items.map(p => p.id).should.eql(['small']); oversized.omitted.should.equal(1);
    boundItineraries([]).should.eql({ items: [], complete: true, omitted: 0 });
  });
  it('signs routes alongside assignments while keeping the legacy no-route contract', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const settings = { key: privateKey, publicKey: publicKey.export({ format: 'jwk' }), keyId: 'test', origin: 'https://field.example.test' };
    const user = { actorId: 5, projectId: 1, displayName: 'Checker', projectName: 'Project' };
    const now = new Date('2026-10-13T12:00:00Z'); const plans = [{ id: 'plan', stops: [{ location: { latitude: 8.48, longitude: -13.23 } }] }];
    const bundle = issue(settings, user, [], now, plans); const bytes = Buffer.from(bundle.payload, 'base64url'); const data = JSON.parse(bytes);
    data.schemaVersion.should.equal('offline-assignments@2'); data.itineraries.items.should.eql(plans);
    data.expiresAt.should.equal('2026-10-13T20:00:00.000Z');
    verify('sha256', bytes, { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(bundle.signature, 'base64url')).should.be.true();
    const legacy = JSON.parse(Buffer.from(issue(settings, user, [], now).payload, 'base64url'));
    legacy.schemaVersion.should.equal('offline-assignments@1'); (legacy.itineraries === undefined).should.be.true();
    const largeItems = Array.from({ length: 50 }, () => ({ question: 'q'.repeat(2000) }));
    const largePlans = [{ id: 'big', stops: Array.from({ length: 100 }, () => ({ question: 's'.repeat(2000) })) }];
    const bounded = JSON.parse(Buffer.from(issue(settings, user, largeItems, now, largePlans).payload, 'base64url'));
    bounded.items.length.should.equal(50); bounded.itineraries.should.eql({ items: [], complete: false, omitted: 1 });

  });
});

describe('(util) bounded signed offline visits', () => {
  it('retains backchecks and reports visits omitted by the row and byte limits', () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const settings = { key: privateKey, origin: 'https://field.example.test' };
    const user = { actorId: 5, projectId: 1, displayName: 'Checker', projectName: 'Project' };
    const visits = { items: Array.from({ length: 51 }, (_, i) => ({ id: String(i), instruction: 'v'.repeat(6000) })), omitted: 2, complete: false };
    const rows = Array.from({ length: 50 }, () => ({ question: 'q'.repeat(2000) }));
    const bundle = issue(settings, user, rows, new Date(), [], visits);
    const bytes = Buffer.from(bundle.payload, 'base64url'); const data = JSON.parse(bytes);
    data.schemaVersion.should.equal('offline-assignments@3'); data.items.length.should.equal(50);
    bytes.length.should.be.belowOrEqual(262144); data.reverification.items.length.should.be.below(50);
    data.reverification.omitted.should.equal(53 - data.reverification.items.length); data.reverification.complete.should.be.false();
    const empty = JSON.parse(Buffer.from(issue(settings, user, [], new Date(), [], { items: [], omitted: 0, complete: true }).payload, 'base64url'));
    empty.reverification.should.eql({ items: [], omitted: 0, complete: true });
  });
});
