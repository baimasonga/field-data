// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const decode = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
const encode = bytes => btoa(Array.from(bytes, b => String.fromCharCode(b)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const imported = key => crypto.subtle.importKey('jwk', key, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
export const fingerprint = async key => hash(new Uint8Array(await crypto.subtle.exportKey('spki', await imported(key))));
export const verifyEnvelope = async (record, publicKey) => {
  if (record?.algorithm !== 'ES256' || typeof record.payload !== 'string' || record.payload.length > 24000 || !/^[A-Za-z0-9_-]{86}$/.test(record.signature ?? '') || publicKey?.d != null || publicKey?.kty !== 'EC' || publicKey?.crv !== 'P-256') throw new Error('Invalid sensor envelope');
  const bytes = decode(record.payload); const signature = decode(record.signature);
  if (encode(bytes) !== record.payload || encode(signature) !== record.signature || !await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, await imported(publicKey), signature, bytes)) throw new Error('Invalid sensor signature');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
};
export const verifySensorAuthority = async (envelope, kind, projectId) => {
  if (envelope?.keyId !== await fingerprint(envelope.publicKey)) throw new Error('Invalid sensor authority key');
  const data = await verifyEnvelope(envelope, envelope.publicKey); const issuer = new URL(data.issuer);
  if (data.purpose !== `field-data.sensor-${kind}@1` || data.projectId !== Number(projectId) || data.issuer !== issuer.origin || (issuer.protocol !== 'https:' && !(issuer.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(issuer.hostname)))) throw new Error('Invalid sensor authority scope'); return data;
};
export const verifySensorItem = async (item, context) => {
  const enrollment = await verifySensorAuthority(item.enrollment, 'enrollment', context.projectId); const receipt = await verifySensorAuthority(item.receipt, 'receipt', context.projectId);
  const data = await verifyEnvelope(item.envelope, enrollment.publicKey);
  if (enrollment.keyHash !== await fingerprint(enrollment.publicKey) || data.purpose !== 'field-data.sensor-reading@1' || JSON.stringify(data.context) !== JSON.stringify(context) || data.deviceId !== enrollment.deviceId || data.measurement.kind !== enrollment.sensorKind || receipt.recordId !== item.id || Date.parse(receipt.receivedAt) !== Date.parse(item.receivedAt) || receipt.challengeId !== context.challengeId || receipt.deviceId !== data.deviceId || receipt.readingId !== data.readingId || receipt.counter !== data.counter || receipt.payloadHash !== await hash(decode(item.envelope.payload)) || receipt.signatureHash !== await hash(new TextEncoder().encode(item.envelope.signature)) || receipt.enrollmentPayloadHash !== await hash(decode(item.enrollment.payload)) || !(Date.parse(enrollment.enrolledAt) <= Date.parse(receipt.receivedAt) && Date.parse(receipt.receivedAt) < Date.parse(enrollment.expiresAt))) throw new Error('Invalid sensor receipt binding');
  let revoked = false; if (item.revocation) { const details = await verifySensorAuthority(item.revocation, 'key-revocation', context.projectId); if (details.deviceId !== data.deviceId || details.keyHash !== enrollment.keyHash) throw new Error('Invalid sensor key revocation'); revoked = true; }
  if (!Array.isArray(item.reviews) || item.reviews.length > 21) throw new Error('Invalid sensor review history');
  const reviews = [];
  for (const review of item.reviews) {
    // eslint-disable-next-line no-await-in-loop
    const details = await verifySensorAuthority(review.attestation, 'review', context.projectId);
    // eslint-disable-next-line no-await-in-loop
    if (details.recordId !== item.id || details.revision !== reviews.length + 1 || (details.revision === 21 && details.outcome !== 'withdraw') || details.readingPayloadHash !== await hash(decode(item.envelope.payload)) || !['supports', 'contradicts', 'inconclusive', 'withdraw'].includes(details.outcome)) throw new Error('Invalid sensor review binding'); reviews.push(details);
  }
  const latest = reviews.at(-1) ? Object.fromEntries(Object.entries(reviews.at(-1)).filter(([key]) => !['issuer', 'purpose'].includes(key))) : null;
  if (item.revision !== reviews.length || (latest == null ? item.latestReview != null : !item.latestReview || Object.keys(latest).length !== Object.keys(item.latestReview).length || Object.keys(latest).some(key => latest[key] !== item.latestReview[key]))) throw new Error('Inconsistent sensor review metadata');
  if (!item.diagnostics || !Array.isArray(item.diagnostics.reasons) || (revoked && item.diagnostics.eligibleForReview)) throw new Error('Invalid sensor diagnostics');
  return { ...item, data, device: enrollment, verifiedReviews: reviews };
};
