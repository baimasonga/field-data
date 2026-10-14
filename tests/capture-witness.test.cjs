const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, sign, randomUUID } = require('node:crypto');
const fixture = () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const data = { purpose: 'field-data.capture-witness@1', challengeId: randomUUID(), projectId: 1, submissionDefId: 2,
    xmlFormId: 'survey', instanceId: 'one', name: 'photo.jpg', code: '12345678', contentHash: 'a'.repeat(64), witnessId: 3,
    requestId: randomUUID(), signedAt: new Date().toISOString(), statement: 'I personally observed the matching scene.' };
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  return { data, record: { algorithm: 'ES256', witnessId: 3, payload, publicKey: publicKey.export({ format: 'jwk' }),
    signature: sign('sha256', Buffer.from(payload, 'base64url'), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url') } };
};
test('exported witness verifies independently against the expected image hash', async () => {
  const { verifyCaptureWitness } = await import('../cloudflare/verify-capture-witness.mjs'); const { data, record } = fixture();
  assert.deepEqual(verifyCaptureWitness(JSON.parse(JSON.stringify(record)), data.contentHash), data);
  assert.throws(() => verifyCaptureWitness(record, 'b'.repeat(64)), /fingerprint/);
});
test('export verifier rejects signature, payload, key, algorithm and account tampering', async () => {
  const { verifyCaptureWitness } = await import('../cloudflare/verify-capture-witness.mjs'); const { data, record } = fixture();
  const other = fixture().record;
  for (const patch of [{ algorithm: 'none' }, { signature: 'a'.repeat(86) }, { witnessId: 9 }, { publicKey: other.publicKey },
    { publicKey: { ...record.publicKey, d: 'private' } }, { payload: Buffer.from(JSON.stringify({ ...data, statement: 'A falsified statement' })).toString('base64url') }]) assert.throws(() => verifyCaptureWitness({ ...record, ...patch }));
});
