// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
/* eslint-disable no-await-in-loop, no-continue */
import { fingerprint, verifyEnvelope } from './sensor-corroboration';

const canonical = value => JSON.stringify(value == null || typeof value !== 'object' ? value : Array.isArray(value) ? value.map(v => JSON.parse(canonical(v))) : Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(canonical(value[k]))])));
const decode = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
const verifyXmlCourierProof = async (proof, projectId, origin = window.location.origin) => {
  const authority = async (envelope, kind) => {
    if (envelope?.keyId !== await fingerprint(envelope.publicKey)) throw new Error('Invalid XML courier key');
    const details = await verifyEnvelope(envelope, envelope.publicKey);
    if (details.projectId !== projectId || details.issuer !== origin || details.purpose !== `field-data.xml-courier-${kind}@1`) throw new Error('Wrong XML courier scope'); return details;
  };
  const target = proof?.target; const grant = proof?.grant; const signed = await authority(grant?.attestation, 'grant');
  for (const key of ['projectId', 'formId', 'formDefId', 'ownerId']) if (signed[key] !== target[key]) throw new Error('Target mismatch');
  if (signed.id !== grant.id || signed.targetId !== target.id || grant.targetId !== target.id || signed.ownerId !== grant.ownerId || signed.courierId !== grant.courierId || canonical(signed.manifest) !== canonical(target.manifest) || Date.parse(signed.expiresAt) !== Date.parse(grant.expiresAt) || !Array.isArray(proof.events) || proof.events.length > 2) throw new Error('Grant mismatch');
  const m = signed.manifest;
  if (!m || !['xmlFormId', 'instanceId', 'version'].every(k => typeof m[k] === 'string' && m[k].length <= 1000) || !m.xmlFormId || !m.instanceId || !/^[a-f0-9]{64}$/.test(m.sha256) || !Number.isInteger(m.size) || m.size < 1 || m.size > 1048576 || !Number.isFinite(Date.parse(signed.issuedAt)) || Date.parse(signed.expiresAt) <= Date.parse(signed.issuedAt) || Date.parse(signed.expiresAt) - Date.parse(signed.issuedAt) > 86400000) throw new Error('Invalid XML grant bounds');
  const grantHash = await hash(decode(grant.attestation.payload)); const seen = new Set(); let unsignedRevocation = false; let delivery = null;
  for (const event of proof.events) {
    if (!['delivery', 'revoke'].includes(event.kind) || seen.has(event.kind) || event.grantId !== grant.id || event.targetId !== target.id) throw new Error('Invalid XML history'); seen.add(event.kind);
    if (event.kind === 'revoke' && event.attestation == null) { unsignedRevocation = true; continue; }
    const details = await authority(event.attestation, event.kind);
    if (canonical(details) !== canonical({ ...event.details, issuer: details.issuer, purpose: details.purpose }) || details.grantId !== grant.id || details.targetId !== target.id || details.ownerId !== target.ownerId || details.grantPayloadHash !== grantHash) throw new Error('Invalid XML event binding');
    if (event.kind === 'revoke' && details.revokedBy !== target.ownerId) throw new Error('Wrong revoker');
    if (event.kind === 'delivery') {
      if (details.receivedBy !== grant.courierId || details.formId !== target.formId || details.formDefId !== target.formDefId || details.sha256 !== m.sha256 || details.size !== m.size || typeof details.alreadyReceived !== 'boolean' || !Number.isSafeInteger(details.submissionDefId) || !Number.isFinite(Date.parse(details.acceptedAt)) || !Number.isFinite(Date.parse(details.submissionReceivedAt)) || Date.parse(details.acceptedAt) < Date.parse(signed.issuedAt) || Date.parse(details.acceptedAt) >= Date.parse(signed.expiresAt) || Date.parse(details.submissionReceivedAt) > Date.parse(details.acceptedAt) || (!details.alreadyReceived && Date.parse(details.submissionReceivedAt) < Date.parse(signed.issuedAt))) throw new Error('Invalid XML delivery receipt');
      delivery = details;
    }
  }
  return { details: signed, revoked: seen.has('revoke'), delivery, unsignedRevocation };
};
export default verifyXmlCourierProof;
