const assert = require('node:assert/strict');
const { generateKeyPairSync, createHash, verify } = require('node:crypto');
const { keyHash, validateRevocation, revocationHash, attest } = require('../../../lib/util/witness-key-trust');
describe('(util) witness key revocation', () => {
  it('fingerprints only public key material and signs a purpose-bound server attestation', () => {
    const root = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }); const witness = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const publicKey = root.publicKey.export({ format: 'jwk' }); const keyId = keyHash(publicKey);
    assert.equal(keyId, createHash('sha256').update(root.publicKey.export({ type: 'spki', format: 'der' })).digest('hex'));
    const record = attest({ key: root.privateKey, publicKey, keyId, origin: 'https://field.example.test' }, { projectId: 1, keyHash: keyHash(witness.publicKey.export({ format: 'jwk' })), revokedAt: '2026-10-24T10:00:00.000Z' });
    assert.equal(verify('sha256', Buffer.from(record.payload, 'base64url'), { key: root.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(record.signature, 'base64url')), true);
    assert.equal(JSON.parse(Buffer.from(record.payload, 'base64url')).purpose, 'field-data.witness-key-revocation@1');
    assert.equal(record.publicKey.d, undefined);
  });
  it('validates bounded reasons and binds replay identity to the authenticated actor', () => {
    const body = { requestId: '11111111-1111-4111-8111-111111111111', keyHash: 'a'.repeat(64), reasonCode: 'compromised', reason: 'The signing environment was compromised.' };
    assert.deepEqual(validateRevocation(body), body);
    for (const patch of [{ requestId: 'bad' }, { keyHash: 'bad' }, { reasonCode: 'unknown' }, { reason: 'short' }, { reason: 'x'.repeat(2001) }, { extra: true }]) assert.equal(validateRevocation({ ...body, ...patch }), null);
    assert.notEqual(revocationHash(body, 1), revocationHash(body, 2));
    assert.notEqual(revocationHash(body, 1), revocationHash({ ...body, reason: 'A different recorded reason.' }, 1));
  });
  it('requires an independently trusted issuer and rejects tampered or differently scoped revocations', async () => {
    // Standalone repository export verifier intentionally has no server package dependency.
    // eslint-disable-next-line import/extensions, import/no-relative-packages
    const { verifyWitnessKeyRevocation } = await import('../../../../../cloudflare/verify-witness-key-revocation.mjs');
    const root = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }); const publicKey = root.publicKey.export({ format: 'jwk' });
    const expected = { publicKey, issuer: 'https://field.example.test', projectId: 1, keyHash: 'a'.repeat(64) };
    const data = { projectId: 1, keyHash: expected.keyHash, revokedAt: '2026-10-24T10:00:00Z', reasonCode: 'retired', reason: 'This signing key has been retired.', purpose: 'cannot-override', issuer: 'cannot-override' };
    const cert = attest({ key: root.privateKey, publicKey, keyId: keyHash(publicKey), origin: expected.issuer }, data);
    assert.equal(verifyWitnessKeyRevocation(cert, expected).purpose, 'field-data.witness-key-revocation@1');
    assert.throws(() => verifyWitnessKeyRevocation(cert));
    for (const patch of [{ projectId: 2 }, { keyHash: 'b'.repeat(64) }, { issuer: 'https://other.test' }, { publicKey: generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'jwk' }) }]) assert.throws(() => verifyWitnessKeyRevocation(cert, { ...expected, ...patch }));
    assert.throws(() => verifyWitnessKeyRevocation({ ...cert, signature: 'a'.repeat(86) }, expected));
    assert.throws(() => verifyWitnessKeyRevocation({ ...cert, payload: `${cert.payload}=` }, expected));
  });

});
