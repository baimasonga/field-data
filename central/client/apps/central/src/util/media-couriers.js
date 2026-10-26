// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
/* eslint-disable no-await-in-loop, no-continue */
import { fingerprint, verifyEnvelope } from './sensor-corroboration';

const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', value)), b => b.toString(16).padStart(2, '0')).join('');
const payload = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const canonical = value => JSON.stringify(value == null || typeof value !== 'object' ? value : Array.isArray(value) ? value.map(v => JSON.parse(canonical(v))) : Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(canonical(value[key]))])));
const verifyCourierProof = async (proof, projectId, origin = window.location.origin) => {
  const authority = async (envelope, kind) => {
    if (envelope?.keyId !== await fingerprint(envelope.publicKey)) throw new Error('Invalid courier authority');
    const details = await verifyEnvelope(envelope, envelope.publicKey);
    if (details.issuer !== origin || details.projectId !== projectId || details.purpose !== `field-data.media-courier-${kind}@1`) throw new Error('Invalid courier scope');
    return details;
  };
  const grant = proof?.grant;
  const details = await authority(grant?.attestation, 'grant');
  for (const key of ['id', 'uploadId', 'projectId', 'submissionDefId', 'ownerId', 'courierId']) if (details[key] !== grant[key]) throw new Error('Invalid courier identity');
  if (canonical(details.manifest) !== canonical(grant.manifest) || Date.parse(details.expiresAt) !== Date.parse(grant.expiresAt) || !Array.isArray(proof.events) || proof.events.length > 2) throw new Error('Invalid courier manifest');
  if (details.manifest.id !== grant.uploadId || !/^[a-f0-9]{64}$/.test(details.manifest.sha256) || !Number.isSafeInteger(details.manifest.size) || details.manifest.size < 1 || details.manifest.size > 20 * 1024 * 1024 || details.manifest.challengeId != null || !Number.isFinite(Date.parse(details.issuedAt)) || Date.parse(details.expiresAt) <= Date.parse(details.issuedAt) || Date.parse(details.expiresAt) - Date.parse(details.issuedAt) > 86400000) throw new Error('Invalid courier grant bounds');
  const grantHash = await hash(payload(grant.attestation.payload)); const seen = new Set(); let unsignedRevocation = false;
  for (const event of proof.events) {
    if (!['delivery', 'revoke'].includes(event.kind) || seen.has(event.kind) || event.grantId !== grant.id) throw new Error('Invalid courier event');
    seen.add(event.kind);
    if (event.kind === 'revoke' && event.attestation == null) { unsignedRevocation = true; continue; }
    const signed = await authority(event.attestation, event.kind);
    const expected = { ...event.details, purpose: signed.purpose, issuer: signed.issuer };
    if (canonical(signed) !== canonical(expected) || signed.grantId !== grant.id || signed.uploadId !== grant.uploadId || signed.grantPayloadHash !== grantHash) throw new Error('Invalid courier event binding');
    if (event.kind === 'revoke' && signed.revokedBy !== grant.ownerId) throw new Error('Invalid courier revoker');
    if (event.kind === 'delivery' && (signed.submissionDefId !== grant.submissionDefId || !Number.isFinite(Date.parse(signed.receivedAt)) || Date.parse(signed.receivedAt) < Date.parse(details.issuedAt) || (signed.receivedBy === grant.courierId && Date.parse(signed.receivedAt) >= Date.parse(details.expiresAt)) || signed.sha256 !== grant.manifest.sha256 || signed.size !== grant.manifest.size || signed.ownerId !== grant.ownerId || ![grant.ownerId, grant.courierId].includes(signed.receivedBy))) throw new Error('Invalid courier delivery');
  }
  return { details, revoked: seen.has('revoke'), delivered: seen.has('delivery'), unsignedRevocation };
};

export default verifyCourierProof;
