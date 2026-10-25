const assert = require('node:assert/strict');
const { generateKeyPairSync, randomUUID } = require('node:crypto');
const sensor = require('../../../lib/util/sensor-corroboration');
describe('(util) signed sensor corroboration', () => {
  const row = { id: randomUUID(), projectId: 1, submissionDefId: 7, xmlFormId: 'household', instanceId: 'uuid:one', name: 'scene.jpg', contentHash: 'b'.repeat(64), nonce: 'a'.repeat(64), issuedAt: '2026-10-25T12:00:00Z', expiresAt: '2026-10-25T12:20:00Z' };
  it('verifies externally signed challenge bindings with bounded typed measurements and explicit clock/key/source diagnostics', async () => {
    // eslint-disable-next-line import/extensions, import/no-relative-packages
    const { signSensorReading, verifySensorRecord } = await import('../../../../../cloudflare/sensor-reading.mjs');
    const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }); const authority = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }); const publicKey = keys.publicKey.export({ format: 'jwk' });
    const rootKey = authority.publicKey.export({ format: 'jwk' }); const settings = { key: authority.privateKey, publicKey: rootKey, keyId: sensor.keyHash(rootKey), origin: 'https://field.example.test' };
    const device = { deviceId: randomUUID(), details: { publicKey, sensorKind: 'proximity', keyHash: sensor.keyHash(publicKey), expiresAt: '2026-10-26T12:00:00Z', enrolledAt: '2026-10-25T11:00:00Z', projectId: 1 } }; device.details.deviceId = device.deviceId;
    const context = sensor.context(row); const fields = { deviceId: device.deviceId, readingId: randomUUID(), counter: 2, sampledAt: '2026-10-25T12:01:00.000Z', measurement: { kind: 'proximity', distanceM: 2, uncertaintyM: 1 } };
    const envelope = signSensorReading(context, fields, keys.privateKey); const data = sensor.checked(envelope, context, device);
    assert.equal(data.measurement.distanceM, 2); assert.equal(sensor.diagnostics(row, data, device, false, '2026-10-25T12:02:00Z', true).eligibleForReview, true);
    assert.throws(() => sensor.checked(envelope, { ...context, contentHash: 'c'.repeat(64) }, device)); assert.throws(() => sensor.checked({ ...envelope, signature: 'a'.repeat(86) }, context, device));
    assert.ok(sensor.diagnostics(row, data, device, false, '2026-10-25T12:21:00Z', true).reasons.includes('server-receipt-after-challenge-window'));
    const badClock = { ...data, sampledAt: '2026-10-25T13:00:00Z' }; assert.equal(sensor.diagnostics(row, badClock, device, true, '2026-10-25T12:02:00Z', false, false).reasons.length, 5);
    const enrollment = sensor.attest(settings, 'enrollment', device.details); const id = randomUUID(); const receipt = sensor.attest(settings, 'receipt', { projectId: 1, recordId: id, challengeId: row.id, deviceId: device.deviceId, readingId: fields.readingId, counter: fields.counter, payloadHash: sensor.hash(Buffer.from(envelope.payload, 'base64url')), signatureHash: sensor.hash(envelope.signature), enrollmentPayloadHash: sensor.hash(Buffer.from(enrollment.payload, 'base64url')), receivedAt: '2026-10-25T12:02:00Z' });
    const record = { id, envelope, enrollment, receipt, reviews: [], revocation: null }; const expected = { publicKeys: [rootKey], issuer: settings.origin, context };
    assert.equal(verifySensorRecord(record, expected).data.counter, 2);
    assert.throws(() => verifySensorRecord(record, { ...expected, issuer: 'https://other.test' })); assert.throws(() => verifySensorRecord(record, { ...expected, publicKeys: [publicKey] }));
    assert.throws(() => verifySensorRecord({ ...record, receipt: { ...receipt, signature: 'a'.repeat(86) } }, expected));
    const revocation = sensor.attest(settings, 'key-revocation', { projectId: 1, deviceId: device.deviceId, keyHash: device.details.keyHash });
    assert.equal(verifySensorRecord({ ...record, revocation }, expected).revocationStatus, 'revoked');
  });
  it('rejects private or noncanonical keys and unsupported, oversized or non-finite measurements', () => {
    const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }); const key = keys.publicKey.export({ format: 'jwk' }); assert.equal(sensor.publicKey(key).x, key.x);
    assert.throws(() => sensor.publicKey({ ...key, d: 'private' })); assert.throws(() => sensor.measurement({ kind: 'proximity', distanceM: -1, uncertaintyM: 1 }));
    assert.throws(() => sensor.measurement({ kind: 'location', latitude: 91, longitude: 0, accuracyM: 1 })); assert.throws(() => sensor.measurement({ kind: 'measurement', name: 'temperature', unit: 'C', value: Infinity }));
    assert.deepEqual(sensor.measurement({ kind: 'location', latitude: 0, longitude: 0, accuracyM: 10 }), { kind: 'location', latitude: 0, longitude: 0, accuracyM: 10 });
    assert.throws(() => sensor.decode({ algorithm: 'ES256', payload: 'a'.repeat(16001), signature: 'a'.repeat(86) }));
  });
});
