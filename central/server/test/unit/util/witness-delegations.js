const assert = require('node:assert/strict');
const { generateKeyPairSync, sign } = require('node:crypto');
const { attest, digest } = require('../../../lib/util/witness-delegations');
const { keyHash } = require('../../../lib/util/witness-key-trust');
describe('(util) delegated witness authorization', () => {
  it('binds independently trusted issuer keys, actor, form, witness key, bytes and server receipt time across authority rotation', async () => {
    // eslint-disable-next-line import/extensions, import/no-relative-packages
    const { verifyWitnessAuthorization } = await import('../../../../../cloudflare/verify-witness-authorization.mjs');
    const authority = () => { const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }); const publicKey = keys.publicKey.export({ format: 'jwk' }); return { key: keys.privateKey, publicKey, keyId: keyHash(publicKey), origin: 'https://field.example.test' }; };
    const first = authority(); const second = authority(); const witnessKeys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const data = { projectId: 7, xmlFormId: 'household', witnessId: 9 }; const bytes = Buffer.from(JSON.stringify(data));
    const witness = { payload: bytes.toString('base64url'), publicKey: witnessKeys.publicKey.export({ format: 'jwk' }), signature: sign('sha256', bytes, { key: witnessKeys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url') };
    const details = { projectId: 7, xmlFormId: 'household', formId: 11, delegateId: 9, delegationId: 'grant-id', grantedAt: '2026-10-25T10:00:00Z', expiresAt: '2026-10-26T10:00:00Z' };
    const grant = attest(first, 'delegation', details);
    const receiptData = { ...details, delegationPayloadHash: digest(Buffer.from(grant.payload, 'base64url')), witnessPayloadHash: digest(bytes), witnessSignatureHash: digest(witness.signature), witnessKeyHash: keyHash(witness.publicKey), receivedAt: '2026-10-25T11:00:00Z' };
    const authorization = { kind: 'delegated-witness', delegation: grant, receipt: attest(second, 'authorization', receiptData) };
    const expected = { publicKeys: [first.publicKey, second.publicKey], issuer: first.origin, projectId: 7, xmlFormId: 'household', delegateId: 9 };
    assert.equal(verifyWitnessAuthorization(authorization, witness, expected).grant.delegateId, 9);
    for (const patch of [{ publicKeys: [first.publicKey] }, { issuer: 'https://other.test' }, { projectId: 8 }, { xmlFormId: 'other' }, { delegateId: 10 }]) assert.throws(() => verifyWitnessAuthorization(authorization, witness, { ...expected, ...patch }));
    for (const patch of [{ receivedAt: '2026-10-24T10:00:00Z' }, { receivedAt: details.expiresAt }, { witnessKeyHash: 'a'.repeat(64) }, { witnessSignatureHash: 'a'.repeat(64) }, { delegationId: 'other-grant' }]) assert.throws(() => verifyWitnessAuthorization({ ...authorization, receipt: attest(second, 'authorization', { ...receiptData, ...patch }) }, witness, expected));
    assert.throws(() => verifyWitnessAuthorization({ ...authorization, receipt: attest(second, 'delegation', receiptData) }, witness, expected));
    assert.throws(() => verifyWitnessAuthorization({ ...authorization, delegation: { ...grant, payload: `${grant.payload}=` } }, witness, expected));
    assert.throws(() => verifyWitnessAuthorization(authorization, { ...witness, publicKey: second.publicKey }, expected));
  });
});
