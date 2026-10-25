const assert = require('node:assert/strict');
const { generateKeyPairSync, sign } = require('node:crypto');
const { validate, assertOwner, digest } = require('../../../lib/util/witness-certificates');
const { keyHash, attest: revocation } = require('../../../lib/util/witness-key-trust');
const { attest } = require('../../../lib/util/witness-delegations');
describe('(util) reviewed witness key certificates', () => {
  it('bounds explicit reviews and enforces certified account ownership and expiry using database time', async () => {
    const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }); const publicKey = keys.publicKey.export({ format: 'jwk' });
    const body = { requestId: '11111111-1111-4111-8111-111111111111', keyHash: keyHash(publicKey), identityLabel: 'Witness account', method: 'account-control', verificationNote: 'Checked authenticated account control and retained signature.', expiresAt: '2026-10-26T12:00:00.000Z', reviewed: true };
    assert.equal(validate(body), body);
    for (const patch of [{ reviewed: false }, { method: 'automatic' }, { keyHash: 'bad' }, { extra: true }, { identityLabel: '' }, { verificationNote: 'short' }, { expiresAt: 'invalid' }]) assert.throws(() => validate({ ...body, ...patch }));
    const row = { subjectAccountId: 9, now: '2026-10-25T12:00:00Z', payload: Buffer.from(JSON.stringify({ expiresAt: body.expiresAt })).toString('base64url') };
    const db = { maybeOne: async () => row };
    await assertOwner(db, 1, publicKey, 9);
    await assert.rejects(assertOwner(db, 1, publicKey, 10));
    await assert.rejects(assertOwner(db, 1, publicKey, 9, body.expiresAt));
    row.now = body.expiresAt; await assert.rejects(assertOwner(db, 1, publicKey, 9));
    row.payload = Buffer.from(JSON.stringify({ expiresAt: 'invalid' })).toString('base64url'); await assert.rejects(assertOwner(db, 1, publicKey, 9));
    await assertOwner({ maybeOne: async () => null }, 1, publicKey, 10);
  });
  it('requires independent authority keys and scope, checks key proof, review time, expiry and separately signed revocation', async () => {
    // eslint-disable-next-line import/extensions, import/no-relative-packages
    const { verifyWitnessKeyCertificate } = await import('../../../../../cloudflare/verify-witness-key-certificate.mjs');
    const authority = () => { const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }); const publicKey = keys.publicKey.export({ format: 'jwk' }); return { key: keys.privateKey, publicKey, keyId: keyHash(publicKey), origin: 'https://field.example.test' }; };
    const root = authority(); const next = authority(); const signer = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const bytes = Buffer.from(JSON.stringify({ projectId: 1, witnessId: 9 }));
    const proof = { payload: bytes.toString('base64url'), publicKey: signer.publicKey.export({ format: 'jwk' }), signature: sign('sha256', bytes, { key: signer.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url') };
    const data = { projectId: 1, keyHash: keyHash(proof.publicKey), subjectAccountId: 9, reviewedBy: 1, identityLabel: 'Witness staff account', assuranceMethod: 'organization-record', verificationNote: 'Reviewed organization record and retained signing-key proof.', proofReceivedAt: '2026-10-25T10:00:00Z', certifiedAt: '2026-10-25T11:00:00Z', expiresAt: '2026-10-26T11:00:00Z', proofPayloadHash: digest(bytes), proofSignatureHash: digest(proof.signature) };
    const certificate = attest(root, 'key-certificate', data); const expected = { publicKeys: [root.publicKey, next.publicKey], issuer: root.origin, projectId: 1, subjectAccountId: 9, keyHash: data.keyHash, at: '2026-10-25T12:00:00Z' };
    assert.equal(verifyWitnessKeyCertificate(certificate, expected, proof).revocationStatus, 'unknown');
    assert.equal(verifyWitnessKeyCertificate(certificate, { ...expected, revocation: null }, proof).timeStatus, 'within-window');
    assert.equal(verifyWitnessKeyCertificate(certificate, { ...expected, at: data.expiresAt }).timeStatus, 'expired');
    assert.equal(verifyWitnessKeyCertificate(certificate, { ...expected, at: data.proofReceivedAt }).timeStatus, 'not-yet-issued');
    for (const patch of [{ issuer: 'https://other.test' }, { publicKeys: [next.publicKey] }, { subjectAccountId: 10 }, { projectId: 2 }, { keyHash: 'a'.repeat(64) }]) assert.throws(() => verifyWitnessKeyCertificate(certificate, { ...expected, ...patch }, proof));
    assert.throws(() => verifyWitnessKeyCertificate(certificate));
    assert.throws(() => verifyWitnessKeyCertificate({ ...certificate, payload: `${certificate.payload}=` }, expected));
    assert.throws(() => verifyWitnessKeyCertificate(attest(root, 'delegation', data), expected));
    assert.throws(() => verifyWitnessKeyCertificate(attest(root, 'key-certificate', { ...data, reviewedBy: 9 }), expected));
    assert.throws(() => verifyWitnessKeyCertificate(certificate, expected, { ...proof, signature: 'a'.repeat(86) }));
    const revoked = revocation(next, { projectId: 1, keyHash: data.keyHash, revokedAt: '2026-10-25T12:00:00Z', reasonCode: 'retired', reason: 'The signing environment was retired.' });
    assert.equal(verifyWitnessKeyCertificate(certificate, { ...expected, revocation: revoked }, proof).revocationStatus, 'revoked');
  });
});
