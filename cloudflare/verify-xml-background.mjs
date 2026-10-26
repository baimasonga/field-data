// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
import { createHash, createPublicKey, verify } from 'node:crypto';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(value == null || typeof value !== 'object' ? value : Array.isArray(value) ? value.map(v => JSON.parse(canonical(v))) : Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(canonical(value[k]))])));
export const verifyXmlBackgroundProof = (proof, expected) => {
  if (!expected?.issuer || !Number.isSafeInteger(expected.projectId) || !Array.isArray(expected.publicKeys) || !expected.publicKeys.length) throw new Error('Independently pin issuer, project and public keys');
  const keys = new Map(expected.publicKeys.map(jwk => { if (jwk.d != null || jwk.kty !== 'EC' || jwk.crv !== 'P-256') throw new Error('Use public P-256 keys'); const key = createPublicKey({ key: jwk, format: 'jwk' }); return [hash(key.export({ type: 'spki', format: 'der' })), key]; }));
  const authority = (envelope, kind) => {
    if (envelope?.algorithm !== 'ES256' || typeof envelope.payload !== 'string' || envelope.payload.length > 24000 || !/^[A-Za-z0-9_-]{86}$/.test(envelope.signature ?? '')) throw new Error('Invalid background proof');
    const key = keys.get(envelope.keyId); const bytes = Buffer.from(envelope.payload, 'base64url'); const signature = Buffer.from(envelope.signature, 'base64url');
    if (!key || bytes.toString('base64url') !== envelope.payload || signature.toString('base64url') !== envelope.signature || !verify('sha256', bytes, { key, dsaEncoding: 'ieee-p1363' }, signature)) throw new Error('Untrusted background signature');
    const details = JSON.parse(bytes.toString('utf8')); if (details.issuer !== expected.issuer || details.projectId !== expected.projectId || details.purpose !== `field-data.xml-background-${kind}@1`) throw new Error('Wrong background scope'); return details;
  };
  const t = proof?.target; const a = proof?.authorization; const signed = authority(a?.attestation, 'authorization');
  for (const key of ['projectId', 'formId', 'formDefId', 'ownerId']) if (signed[key] !== t[key]) throw new Error('Target mismatch');
  if (signed.id !== a.id || signed.targetId !== t.id || a.targetId !== t.id || a.ownerId !== signed.ownerId || a.tokenHash !== signed.tokenHash || canonical(t.manifest) !== canonical(signed.manifest) || Date.parse(a.expiresAt) !== Date.parse(signed.expiresAt)) throw new Error('Authorization mismatch');
  const m = signed.manifest; const start = Date.parse(signed.issuedAt); const end = Date.parse(signed.expiresAt);
  if (!m || !['xmlFormId', 'instanceId', 'version'].every(k => typeof m[k] === 'string' && m[k].length <= 1000) || !m.xmlFormId || !m.instanceId || !/^[a-f0-9]{64}$/.test(m.sha256) || !/^[a-f0-9]{64}$/.test(signed.tokenHash) || !Number.isInteger(m.size) || m.size < 1 || m.size > 1048576 || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 86400000 || Object.keys(m).length !== (m.deprecatedId ? 7 : 5) || !Array.isArray(proof.events) || proof.events.length > 2) throw new Error('Invalid background bounds');
  if (m.deprecatedId && (typeof m.deprecatedId !== 'string' || m.deprecatedId.length > 1000 || m.deprecatedId === m.instanceId || !/^[a-f0-9]{64}$/.test(m.baseSha256 ?? '') || !Number.isSafeInteger(signed.baseSubmissionDefId) || signed.baseSubmissionDefId < 1)) throw new Error('Invalid edit base');
  const authorizationHash = hash(Buffer.from(a.attestation.payload, 'base64url')); const seen = new Set(); const events = [];
  for (const event of proof.events) {
    if (!['delivery', 'revoke'].includes(event.kind) || seen.has(event.kind) || event.authorizationId !== a.id || event.targetId !== t.id || event.attestation == null) throw new Error('Invalid or unsigned background history'); seen.add(event.kind);
    const d = authority(event.attestation, event.kind);
    if (canonical(d) !== canonical({ ...event.details, issuer: d.issuer, purpose: d.purpose }) || d.authorizationId !== a.id || d.targetId !== t.id || d.ownerId !== t.ownerId || d.authorizationPayloadHash !== authorizationHash) throw new Error('Event mismatch');
    if (event.kind === 'revoke' && d.revokedBy !== t.ownerId) throw new Error('Wrong revoker');
    if (event.kind === 'delivery' && (d.transport !== 'background-capability' || d.formId !== t.formId || d.formDefId !== t.formDefId || d.sha256 !== m.sha256 || d.size !== m.size || typeof d.alreadyReceived !== 'boolean' || !Number.isSafeInteger(d.submissionDefId) || !Number.isFinite(Date.parse(d.acceptedAt)) || !Number.isFinite(Date.parse(d.submissionReceivedAt)) || Date.parse(d.acceptedAt) < start || Date.parse(d.acceptedAt) >= end || Date.parse(d.submissionReceivedAt) > Date.parse(d.acceptedAt) || (!d.alreadyReceived && Date.parse(d.submissionReceivedAt) < start))) throw new Error('Invalid delivery receipt');
    if (event.kind === 'delivery' && m.deprecatedId && (d.deprecatedId !== m.deprecatedId || d.baseSha256 !== m.baseSha256 || d.baseSubmissionDefId !== signed.baseSubmissionDefId || d.submissionDefId === d.baseSubmissionDefId)) throw new Error('Wrong edit lineage');
    events.push(d);
  }
  return { authorization: signed, events, revocation: seen.has('revoke') ? 'recorded' : 'not-recorded-in-supplied-snapshot', limitations: 'Exact-file browser authorization only; no account-presence or physical-custody assertion.' };
};
