// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
import { createHash, createPublicKey, verify } from 'node:crypto';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(value == null || typeof value !== 'object' ? value : Array.isArray(value) ? value.map(v => JSON.parse(canonical(v))) : Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(canonical(value[k]))])));
export const verifyXmlCourierProof = (proof, expected) => {
  if (!expected?.issuer || !Number.isSafeInteger(expected.projectId) || !Array.isArray(expected.publicKeys) || !expected.publicKeys.length) throw new Error('Independently pin issuer, project and public keys');
  const keys = new Map(expected.publicKeys.map(jwk => { if (jwk.d != null || jwk.kty !== 'EC' || jwk.crv !== 'P-256') throw new Error('Use public P-256 keys'); const key = createPublicKey({ key: jwk, format: 'jwk' }); return [hash(key.export({ type: 'spki', format: 'der' })), key]; }));
  const authority = (record, kind) => {
    if (!record || record.algorithm !== 'ES256' || typeof record.payload !== 'string' || record.payload.length > 24000 || !/^[A-Za-z0-9_-]{86}$/.test(record.signature ?? '')) throw new Error('Invalid XML courier envelope');
    const key = keys.get(record.keyId); const bytes = Buffer.from(record.payload, 'base64url'); const signature = Buffer.from(record.signature, 'base64url');
    if (!key || bytes.toString('base64url') !== record.payload || signature.toString('base64url') !== record.signature || !verify('sha256', bytes, { key, dsaEncoding: 'ieee-p1363' }, signature)) throw new Error('Untrusted XML courier signature');
    const details = JSON.parse(bytes.toString('utf8'));
    if (details.issuer !== expected.issuer || details.projectId !== expected.projectId || details.purpose !== `field-data.xml-courier-${kind}@1`) throw new Error('Wrong XML courier scope'); return details;
  };
  const target = proof?.target; const grant = proof?.grant; const signed = authority(grant?.attestation, 'grant');
  for (const key of ['projectId', 'formId', 'formDefId', 'ownerId']) if (signed[key] !== target[key]) throw new Error('Target binding mismatch');
  if (signed.id !== grant.id || signed.targetId !== target.id || grant.targetId !== target.id || signed.ownerId !== grant.ownerId || signed.courierId !== grant.courierId || canonical(signed.manifest) !== canonical(target.manifest) || Date.parse(signed.expiresAt) !== Date.parse(grant.expiresAt)) throw new Error('Grant binding mismatch');
  const m = signed.manifest;
  if (!m || !['xmlFormId', 'instanceId', 'version'].every(k => typeof m[k] === 'string' && m[k].length <= 1000) || !m.xmlFormId || !m.instanceId || !/^[a-f0-9]{64}$/.test(m.sha256) || !Number.isInteger(m.size) || m.size < 1 || m.size > 1048576 || !Number.isFinite(Date.parse(signed.issuedAt)) || Date.parse(signed.expiresAt) <= Date.parse(signed.issuedAt) || Date.parse(signed.expiresAt) - Date.parse(signed.issuedAt) > 86400000 || !Array.isArray(proof.events) || proof.events.length > 2) throw new Error('Invalid XML courier bounds');
  const grantHash = hash(Buffer.from(grant.attestation.payload, 'base64url')); const seen = new Set(); const events = [];
  for (const event of proof.events) {
    if (!['delivery', 'revoke'].includes(event.kind) || seen.has(event.kind) || event.grantId !== grant.id || event.targetId !== target.id || event.attestation == null) throw new Error('Invalid or unsigned XML custody history'); seen.add(event.kind);
    const details = authority(event.attestation, event.kind);
    if (canonical(details) !== canonical({ ...event.details, issuer: details.issuer, purpose: details.purpose }) || details.grantId !== grant.id || details.targetId !== target.id || details.ownerId !== target.ownerId || details.grantPayloadHash !== grantHash) throw new Error('Event binding mismatch');
    if (event.kind === 'revoke' && details.revokedBy !== target.ownerId) throw new Error('Wrong revoker');
    if (event.kind === 'delivery' && (details.receivedBy !== grant.courierId || details.formId !== target.formId || details.formDefId !== target.formDefId || details.sha256 !== m.sha256 || details.size !== m.size || typeof details.alreadyReceived !== 'boolean' || !Number.isSafeInteger(details.submissionDefId) || !Number.isFinite(Date.parse(details.acceptedAt)) || !Number.isFinite(Date.parse(details.submissionReceivedAt)) || Date.parse(details.acceptedAt) < Date.parse(signed.issuedAt) || Date.parse(details.acceptedAt) >= Date.parse(signed.expiresAt) || Date.parse(details.submissionReceivedAt) > Date.parse(details.acceptedAt) || (!details.alreadyReceived && Date.parse(details.submissionReceivedAt) < Date.parse(signed.issuedAt)))) throw new Error('Invalid XML delivery receipt');
    events.push(details);
  }
  return { grant: signed, events, revocation: seen.has('revoke') ? 'recorded' : 'not-recorded-in-supplied-snapshot', limitations: 'Account transport assertions only; no proof of physical custody or absence of later events.' };
};
