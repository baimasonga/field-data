// Adapter protocol for an external sensor/operator. Private keys stay with that operator.
import { createHash, createPublicKey, sign, verify } from 'node:crypto';
const hash = value => createHash('sha256').update(value).digest('hex');
const fingerprint = jwk => hash(createPublicKey({ key: jwk, format: 'jwk' }).export({ type: 'spki', format: 'der' }));
const normalizedContext = input => Object.fromEntries(['projectId','challengeId','submissionDefId','xmlFormId','instanceId','name','contentHash','nonceHash','issuedAt','expiresAt'].map(key => [key,input[key]]));
const normalizedMeasurement = input => {
  const fields = { proximity: ['kind','distanceM','uncertaintyM'], location: ['kind','latitude','longitude','accuracyM'], measurement: ['kind','name','unit','value'] }[input?.kind];
  if (!fields || Object.keys(input).length !== fields.length || fields.some(key => !Object.hasOwn(input,key))) throw new Error('Unsupported sensor measurement schema');
  const bounded = (value, lo, hi) => typeof value === 'number' && Number.isFinite(value) && value >= lo && value <= hi;
  if (input.kind === 'proximity' ? !bounded(input.distanceM,0,100000) || !bounded(input.uncertaintyM,0,100000) : input.kind === 'location' ? !bounded(input.latitude,-90,90) || !bounded(input.longitude,-180,180) || !bounded(input.accuracyM,0,100000) : typeof input.name !== 'string' || !input.name.trim() || input.name.length>100 || typeof input.unit !== 'string' || !input.unit.trim() || input.unit.length>30 || !bounded(input.value,-1e12,1e12)) throw new Error('Sensor measurement outside bounds');
  return Object.fromEntries(fields.map(key => [key,input[key]]));
};
export const signSensorReading = (context, { deviceId, readingId, counter, sampledAt, measurement }, privateKey) => {
  const bytes = Buffer.from(JSON.stringify({ purpose: 'field-data.sensor-reading@1', context: normalizedContext(context), deviceId, readingId, counter, sampledAt, measurement: normalizedMeasurement(measurement) }));
  return { algorithm: 'ES256', payload: bytes.toString('base64url'), signature: sign('sha256', bytes, { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url') };
};
export const verifySensorRecord = (record, expected) => {
  if (!expected?.publicKeys?.length || !expected.issuer || !expected.context) throw new Error('Independent authority keys, issuer and exact challenge context are required');
  const root = (envelope, kind) => {
    if (envelope?.algorithm !== 'ES256' || envelope.publicKey?.d != null || envelope.publicKey?.crv !== 'P-256' || typeof envelope.payload !== 'string' || envelope.payload.length > 24000 || !/^[A-Za-z0-9_-]{86}$/.test(envelope.signature ?? '') || envelope.keyId !== fingerprint(envelope.publicKey) || !expected.publicKeys.some(key => fingerprint(key) === envelope.keyId)) throw new Error('Untrusted sensor authority envelope');
    const bytes = Buffer.from(envelope.payload, 'base64url'); const signature = Buffer.from(envelope.signature, 'base64url');
  if (bytes.toString('base64url') !== envelope.payload || signature.toString('base64url') !== envelope.signature || !verify('sha256', bytes, { key: createPublicKey({ key: envelope.publicKey, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, signature)) throw new Error('Invalid sensor authority signature');
    const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (data.purpose !== `field-data.sensor-${kind}@1` || data.issuer !== expected.issuer || data.projectId !== expected.context.projectId) throw new Error('Invalid sensor authority scope'); return data;
  };
  const enrollment = root(record.enrollment, 'enrollment'); if (enrollment.publicKey?.d != null) throw new Error('Private sensor key material is forbidden'); const receipt = root(record.receipt, 'receipt'); const envelope = record.envelope;
  if (envelope?.algorithm !== 'ES256' || typeof envelope.payload !== 'string' || envelope.payload.length > 16000 || !/^[A-Za-z0-9_-]{86}$/.test(envelope.signature ?? '')) throw new Error('Invalid sensor envelope');
  const bytes = Buffer.from(envelope.payload, 'base64url'); const signature = Buffer.from(envelope.signature, 'base64url'); const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  normalizedMeasurement(data.measurement);
  if (Object.keys(data).length !== 7 || !Number.isInteger(data.counter) || data.counter < 1 || data.counter > 2147483647 || !Number.isFinite(Date.parse(data.sampledAt))) throw new Error('Invalid sensor reading schema');
  if (bytes.toString('base64url') !== envelope.payload || signature.toString('base64url') !== envelope.signature || !verify('sha256', bytes, { key: createPublicKey({ key: enrollment.publicKey, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, signature) || enrollment.keyHash !== fingerprint(enrollment.publicKey) || data.purpose !== 'field-data.sensor-reading@1' || JSON.stringify(data.context) !== JSON.stringify(normalizedContext(expected.context)) || data.deviceId !== enrollment.deviceId || data.measurement.kind !== enrollment.sensorKind || receipt.deviceId !== data.deviceId || receipt.readingId !== data.readingId || receipt.counter !== data.counter || receipt.recordId !== record.id || receipt.challengeId !== expected.context.challengeId || receipt.payloadHash !== hash(bytes) || receipt.signatureHash !== hash(envelope.signature) || receipt.enrollmentPayloadHash !== hash(Buffer.from(record.enrollment.payload, 'base64url')) || !(Date.parse(enrollment.enrolledAt) <= Date.parse(receipt.receivedAt) && Date.parse(receipt.receivedAt) < Date.parse(enrollment.expiresAt))) throw new Error('Sensor proof or receipt binding failed');
  if (!Array.isArray(record.reviews) || record.reviews.length > 21) throw new Error('Invalid sensor review bound');
  const reviews = record.reviews.map((review, index) => { const details = root(review.attestation, 'review'); if (details.recordId !== record.id || details.revision !== index + 1 || !['supports','contradicts','inconclusive','withdraw'].includes(details.outcome) || (details.revision === 21 && details.outcome !== 'withdraw') || details.readingPayloadHash !== hash(bytes)) throw new Error('Invalid sensor review history'); return details; });
  let revocation = null; if (record.revocation) { revocation = root(record.revocation, 'key-revocation'); if (revocation.deviceId !== data.deviceId || revocation.keyHash !== enrollment.keyHash) throw new Error('Wrong sensor key revocation'); }
  return { data, enrollment, receipt, reviews, revocation, revocationStatus: revocation ? 'revoked' : 'not-recorded-in-supplied-snapshot', limitations: 'A supplied snapshot cannot prove absence of later revocation or reviews. Signatures do not prove hardware provenance, calibration, independence or physical presence.' };
};
