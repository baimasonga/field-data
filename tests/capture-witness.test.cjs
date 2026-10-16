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

const changedFixture = () => {
  const { data, record } = fixture(); record.id = randomUUID(); record.events = []; record.status = 'active'; record.revision = 0;
  const append = (action, patch = {}) => {
    const { createHash } = require('node:crypto');
    const digest = value => createHash('sha256').update(Buffer.from(value.payload, 'base64url')).digest('hex');
    const { purpose, requestId, signedAt, statement, ...scope } = data;
    const fields = { purpose: 'field-data.capture-witness-change@1', ...scope, witnessRecordId: record.id,
      originalPayloadHash: digest(record), sequence: record.events.length + 1, previousPayloadHash: digest(record.events.at(-1) ?? record),
      requestId: randomUUID(), signedAt: new Date().toISOString(), action,
      statement: action === 'withdraw' ? null : 'I could confirm the code but not the pump operation.',
      reason: 'I need to clarify the limits of what I observed.', ...patch };
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const payload = Buffer.from(JSON.stringify(fields)).toString('base64url');
    record.events.push({ id: randomUUID(), actorId: data.witnessId, actorName: 'Witness', sequence: fields.sequence, action,
      algorithm: 'ES256', payload, publicKey: publicKey.export({ format: 'jwk' }),
      signature: sign('sha256', Buffer.from(payload, 'base64url'), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url') });
    record.status = action === 'withdraw' ? 'withdrawn' : 'active'; record.revision = record.events.length;
    return fields;
  };
  return { data, record, append };
};
test('export verification derives corrected and withdrawn state while retaining the original signed statement', async () => {
  const { verifyCaptureWitness } = await import('../cloudflare/verify-capture-witness.mjs');
  const { data, record, append } = changedFixture();
  assert.equal(verifyCaptureWitness(record).lifecycle.status, 'active');
  const correction = append('correct');
  assert.equal(verifyCaptureWitness(record).lifecycle.effectiveStatement, correction.statement);
  append('withdraw');
  const verified = verifyCaptureWitness(record, data.contentHash);
  assert.equal(verified.statement, data.statement); assert.equal(verified.lifecycle.status, 'withdrawn');
  assert.equal(verified.lifecycle.effectiveStatement, null); assert.equal(verified.lifecycle.changes.length, 2);
  assert.equal(verifyCaptureWitness({ ...record, events: undefined }).lifecycle, undefined);
});
test('export verification rejects tampered, omitted, reordered and transplanted changes and changes after withdrawal', async () => {
  const { verifyCaptureWitness } = await import('../cloudflare/verify-capture-witness.mjs');
  const { record, append } = changedFixture(); append('correct'); append('withdraw');
  for (const changed of [{ ...record, status: 'active' }, { ...record, revision: 0 }, { ...record, events: null },
    { ...record, id: randomUUID() }, { ...record, events: record.events.slice(1) }, { ...record, events: record.events.slice(0, 1) },
    { ...record, events: [...record.events].reverse() },
    { ...record, events: [{ ...record.events[0], signature: 'a'.repeat(86) }, record.events[1]] }]) assert.throws(() => verifyCaptureWitness(changed));
  append('correct'); assert.throws(() => verifyCaptureWitness(record));
  const forged = changedFixture(); forged.append('correct', { previousPayloadHash: '0'.repeat(64) });
  assert.throws(() => verifyCaptureWitness(forged.record));
});
