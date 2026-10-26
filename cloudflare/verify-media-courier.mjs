// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
import { createHash, createPublicKey, verify } from 'node:crypto';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(value == null || typeof value !== 'object' ? value : Array.isArray(value) ? value.map(v => JSON.parse(canonical(v))) : Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(canonical(value[k]))])));
export const verifyMediaCourierProof = (proof, expected) => {
  if (!expected?.issuer || !Number.isSafeInteger(expected.projectId) || !Array.isArray(expected.publicKeys) || !expected.publicKeys.length) throw new Error('Independently pinned issuer, project and public keys are required');
  const keys = new Map(expected.publicKeys.map(jwk => { if (jwk.d != null || jwk.kty !== 'EC' || jwk.crv !== 'P-256') throw new Error('Use public P-256 keys'); const key = createPublicKey({ key: jwk, format: 'jwk' }); return [hash(key.export({ type: 'spki', format: 'der' })), key]; }));
  const authority = (record, kind) => {
    if (!record || record.algorithm !== 'ES256' || typeof record.payload !== 'string' || record.payload.length > 24000 || !/^[A-Za-z0-9_-]{86}$/.test(record.signature ?? '')) throw new Error('Invalid authority envelope');
    const key = keys.get(record.keyId); const bytes = Buffer.from(record.payload, 'base64url'); const signature = Buffer.from(record.signature, 'base64url');
    if (!key || bytes.toString('base64url') !== record.payload || signature.toString('base64url') !== record.signature || !verify('sha256', bytes, { key, dsaEncoding: 'ieee-p1363' }, signature)) throw new Error('Untrusted or invalid authority signature');
    const details = JSON.parse(bytes.toString('utf8'));
    if (details.issuer !== expected.issuer || details.projectId !== expected.projectId || details.purpose !== `field-data.media-courier-${kind}@1`) throw new Error('Wrong authority scope'); return details;
  };
  const grant = proof?.grant; const details = authority(grant?.attestation, 'grant');
  for (const key of ['id', 'uploadId', 'projectId', 'submissionDefId', 'ownerId', 'courierId']) if (details[key] !== grant[key]) throw new Error('Grant identity mismatch');
  if (canonical(details.manifest) !== canonical(grant.manifest) || Date.parse(details.expiresAt) !== Date.parse(grant.expiresAt) || !Array.isArray(proof.events) || proof.events.length > 2) throw new Error('Invalid grant manifest');
  if (details.manifest.id !== grant.uploadId || !/^[a-f0-9]{64}$/.test(details.manifest.sha256) || !Number.isSafeInteger(details.manifest.size) || details.manifest.size < 1 || details.manifest.size > 20 * 1024 * 1024 || details.manifest.challengeId != null || !Number.isFinite(Date.parse(details.issuedAt)) || Date.parse(details.expiresAt) <= Date.parse(details.issuedAt) || Date.parse(details.expiresAt) - Date.parse(details.issuedAt) > 86400000) throw new Error('Invalid courier grant bounds');
  const grantHash = hash(Buffer.from(grant.attestation.payload, 'base64url')); const events = []; const kinds = new Set();
  for (const event of proof.events) {
    if (!['delivery', 'revoke'].includes(event.kind) || kinds.has(event.kind) || event.grantId !== grant.id) throw new Error('Invalid custody history'); kinds.add(event.kind);
    if (event.attestation == null) throw new Error('History contains an unsigned revocation; obtain the current authenticated server state');
    const signed = authority(event.attestation, event.kind);
    if (canonical(signed) !== canonical({ ...event.details, issuer: signed.issuer, purpose: signed.purpose }) || signed.grantId !== grant.id || signed.uploadId !== grant.uploadId || signed.grantPayloadHash !== grantHash) throw new Error('Invalid event binding');
    if (event.kind === 'revoke' && signed.revokedBy !== grant.ownerId) throw new Error('Invalid revoker binding');
    if (event.kind === 'delivery' && (signed.submissionDefId !== grant.submissionDefId || !Number.isFinite(Date.parse(signed.receivedAt)) || Date.parse(signed.receivedAt) < Date.parse(details.issuedAt) || (signed.receivedBy === grant.courierId && Date.parse(signed.receivedAt) >= Date.parse(details.expiresAt)) || signed.sha256 !== grant.manifest.sha256 || signed.size !== grant.manifest.size || signed.ownerId !== grant.ownerId || ![grant.ownerId, grant.courierId].includes(signed.receivedBy))) throw new Error('Invalid delivery binding');
    events.push(signed);
  }
  return { grant: details, events, revocation: kinds.has('revoke') ? 'recorded' : 'not-recorded-in-supplied-snapshot', limitations: 'Server account transport assertions only. This snapshot cannot prove physical custody or absence of later events.' };
};
