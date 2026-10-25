// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { createHash, createPublicKey, sign, verify } = require('node:crypto');
const { sql } = require('slonik');
const { UUID_PATTERN } = require('./claim-versioning');
const { config } = require('./offline-assignments');
const { keyHash } = require('./witness-key-trust');
const Problem = require('./problem');
const invalid = reason => Problem.user.unexpectedValue({ field: 'sensorCorroboration', reason });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const text = (value, min = 1, max = 2000) => typeof value === 'string' && value === value.trim() && value.length >= min && value.length <= max;
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const publicKey = key => {
  try {
    if (!key || Object.keys(key).some(name => !['kty', 'crv', 'x', 'y', 'ext', 'key_ops'].includes(name)) || key.kty !== 'EC' || key.crv !== 'P-256' || !/^[A-Za-z0-9_-]{43}$/.test(key.x ?? '') || !/^[A-Za-z0-9_-]{43}$/.test(key.y ?? '')) throw new Error();
    if ([key.x, key.y].some(value => Buffer.from(value, 'base64url').length !== 32 || Buffer.from(value, 'base64url').toString('base64url') !== value)) throw new Error();
    const result = { kty: 'EC', crv: 'P-256', x: key.x, y: key.y }; createPublicKey({ key: result, format: 'jwk' }); return result;
  } catch { throw invalid('Use a public P-256 key without private key material.'); }
};
const attest = (settings, kind, data) => {
  const bytes = Buffer.from(JSON.stringify({ ...data, purpose: `field-data.sensor-${kind}@1`, issuer: settings.origin }));
  return { algorithm: 'ES256', publicKey: settings.publicKey, keyId: settings.keyId, payload: bytes.toString('base64url'), signature: sign('sha256', bytes, { key: settings.key, dsaEncoding: 'ieee-p1363' }).toString('base64url') };
};
const context = row => ({ projectId: row.projectId, challengeId: row.id, submissionDefId: row.submissionDefId, xmlFormId: row.xmlFormId, instanceId: row.instanceId, name: row.name, contentHash: row.contentHash, nonceHash: hash(row.nonce), issuedAt: new Date(row.issuedAt).toISOString(), expiresAt: new Date(row.expiresAt).toISOString() });
const measurement = data => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw invalid('Provide a typed sensor measurement.');
  const bounded = (value, low, high) => typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high;
  if (data.kind === 'proximity' && Object.keys(data).length === 3 && bounded(data.distanceM, 0, 100000) && bounded(data.uncertaintyM, 0, 100000)) return { kind: data.kind, distanceM: data.distanceM, uncertaintyM: data.uncertaintyM };
  if (data.kind === 'location' && Object.keys(data).length === 4 && bounded(data.latitude, -90, 90) && bounded(data.longitude, -180, 180) && bounded(data.accuracyM, 0, 100000)) return { kind: data.kind, latitude: data.latitude, longitude: data.longitude, accuracyM: data.accuracyM };
  if (data.kind === 'measurement' && Object.keys(data).length === 4 && text(data.name, 1, 100) && text(data.unit, 1, 30) && bounded(data.value, -1e12, 1e12)) return { kind: data.kind, name: data.name, unit: data.unit, value: data.value };
  throw invalid('Use bounded proximity, location or named scalar measurement fields.');
};
const decode = envelope => {
  try {
    if (!envelope || Object.keys(envelope).length !== 3 || envelope.algorithm !== 'ES256' || typeof envelope.payload !== 'string' || envelope.payload.length > 16000 || !/^[A-Za-z0-9_-]{86}$/.test(envelope.signature ?? '')) throw new Error();
    const bytes = Buffer.from(envelope.payload, 'base64url'); const signature = Buffer.from(envelope.signature, 'base64url');
    if (bytes.toString('base64url') !== envelope.payload || signature.toString('base64url') !== envelope.signature) throw new Error();
    const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (Object.keys(data).length !== 7 || data.purpose !== 'field-data.sensor-reading@1' || !UUID_PATTERN.test(data.deviceId ?? '') || !UUID_PATTERN.test(data.readingId ?? '') || !Number.isInteger(data.counter) || data.counter < 1 || data.counter > 2147483647 || !iso(data.sampledAt) || !data.context || typeof data.context !== 'object') throw new Error();
    measurement(data.measurement); return data;
  } catch { throw invalid('The signed sensor envelope is malformed or exceeds its bounds.'); }
};
const checked = (envelope, expected, device) => {
  const data = decode(envelope);
  const expectedPayload = JSON.stringify({ purpose: 'field-data.sensor-reading@1', context: expected, deviceId: data.deviceId, readingId: data.readingId, counter: data.counter, sampledAt: data.sampledAt, measurement: measurement(data.measurement) });
  if (data.deviceId !== device.deviceId || data.measurement.kind !== device.details.sensorKind || envelope.payload !== Buffer.from(expectedPayload).toString('base64url') || !verify('sha256', Buffer.from(envelope.payload, 'base64url'), { key: createPublicKey({ key: device.details.publicKey, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(envelope.signature, 'base64url'))) throw invalid('Sensor signature, device type or challenge/image binding does not match.');
  return data;
};
const keyRows = (db, projectId) => db.any(sql`SELECT * FROM field_data_sensor_keys WHERE "projectId"=${Number(projectId)} ORDER BY sequence DESC LIMIT 2000`);
const assertNotSensorKey = async (db, projectId, key) => { if (await db.maybeOne(sql`SELECT id FROM field_data_sensor_keys WHERE "projectId"=${Number(projectId)} AND kind='enroll' AND details->>'keyHash'=${keyHash(key)}`)) throw Problem.user.captureWitnessConflict(); };
const diagnostics = (row, data, device, revoked, receiptAt, current, integrityVerified = true) => {
  const reasons = [];
  if (!integrityVerified) reasons.push('source-image-not-verified');
  if (!current) reasons.push('image-or-submission-replaced');
  if (revoked) reasons.push('sensor-key-revoked');
  if (Date.parse(device.details.expiresAt) <= Date.parse(receiptAt)) reasons.push('sensor-key-expired-at-receipt');
  if (Date.parse(data.sampledAt) < Date.parse(row.issuedAt) || Date.parse(data.sampledAt) > Date.parse(row.expiresAt)) reasons.push('sensor-clock-outside-challenge-window');
  if (Date.parse(receiptAt) > Date.parse(row.expiresAt)) reasons.push('server-receipt-after-challenge-window');
  if (Date.parse(data.sampledAt) > Date.parse(receiptAt) + 60000) reasons.push('sensor-clock-ahead-of-server-receipt');
  return { eligibleForReview: reasons.length === 0, reasons, limitations: 'The enrolled sensor key signed this context and measurement. Device/operator independence, clock accuracy, calibration, proximity and physical presence are not established by the signature.' };
};
module.exports = { invalid, hash, text, iso, publicKey, attest, context, measurement, decode, checked, keyRows, assertNotSensorKey, diagnostics, config, keyHash };
