const assert = require('node:assert/strict');
const { generateKeyPairSync, randomUUID } = require('node:crypto');
const { attest, digest } = require('../../../lib/util/media-couriers');
describe('(util) media courier custody', () => {
  it('verifies pinned account/manifest/time bindings and rejects wrong keys, altered delivery and unsigned events', async () => {
    // eslint-disable-next-line import/extensions, import/no-relative-packages
    const { verifyMediaCourierProof } = await import('../../../../../cloudflare/verify-media-courier.mjs');
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const settings = { key: privateKey, publicKey: publicKey.export({ format: 'jwk' }), keyId: digest(publicKey.export({ type: 'spki', format: 'der' })), origin: 'https://courier.example' };
    const uploadId = randomUUID(); const id = randomUUID();
    const manifest = { id: uploadId, xmlFormId: 'verify', instanceId: 'one', name: 'proof.jpg', sha256: 'a'.repeat(64), size: 42, contentType: 'image/jpeg', priority: 1 };
    const details = { id, uploadId, projectId: 1, submissionDefId: 5, ownerId: 2, courierId: 3, manifest, issuedAt: '2026-10-26T12:00:00.000Z', expiresAt: '2026-10-26T13:00:00.000Z' };
    const grant = { ...details, attestation: attest(settings, 'grant', details) };
    const delivered = { grantId: id, uploadId, projectId: 1, submissionDefId: 5, ownerId: 2, receivedBy: 3, sha256: manifest.sha256, size: 42, blobId: 1, receivedAt: '2026-10-26T12:30:00.000Z', grantPayloadHash: digest(Buffer.from(grant.attestation.payload, 'base64url')) };
    const event = { grantId: id, kind: 'delivery', details: delivered, attestation: attest(settings, 'delivery', delivered) };
    const proof = { grant, events: [event] }; const expected = { issuer: settings.origin, projectId: 1, publicKeys: [settings.publicKey] };
    assert.equal(verifyMediaCourierProof(proof, expected).events[0].receivedBy, 3);
    assert.throws(() => verifyMediaCourierProof(proof, { ...expected, publicKeys: [generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'jwk' })] }));
    assert.throws(() => verifyMediaCourierProof({ ...proof, events: [{ ...event, details: { ...delivered, receivedBy: 4 } }] }, expected));
    assert.throws(() => verifyMediaCourierProof({ ...proof, events: [{ grantId: id, kind: 'revoke', attestation: null }] }, expected));
    const late = { ...delivered, receivedAt: '2026-10-26T13:01:00.000Z' };
    assert.throws(() => verifyMediaCourierProof({ ...proof, events: [{ ...event, details: late, attestation: attest(settings, 'delivery', late) }] }, expected));
  });
});
