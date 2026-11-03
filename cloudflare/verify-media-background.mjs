// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
import { webcrypto as crypto } from 'node:crypto';
const verify = async (proof, expected) => {
  const canonical = value => JSON.stringify(value == null || typeof value !== 'object' ? value : Array.isArray(value) ? value.map(v => JSON.parse(canonical(v))) : Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(canonical(value[k]))])));
  const decode = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const encode = value => btoa(String.fromCharCode(...value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  if (!expected?.issuer || !Number.isSafeInteger(expected.projectId)) throw new Error('Pin media background scope');
  const pins = new Set();
  if (expected.publicKeys) for (const jwk of expected.publicKeys) {
    if (jwk.d != null || jwk.kty !== 'EC' || jwk.crv !== 'P-256') throw new Error('Use public P-256 keys');
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']); pins.add(await hash(await crypto.subtle.exportKey('spki', key)));
  }
  if (expected.publicKeys && !pins.size) throw new Error('Pin trusted public keys');
  const authority = async (e, kind, prefix = 'media-background') => {
    if (e?.algorithm !== 'ES256' || e.publicKey?.d != null || e.publicKey?.kty !== 'EC' || e.publicKey?.crv !== 'P-256' || typeof e.payload !== 'string' || e.payload.length > 24000 || !/^[A-Za-z0-9_-]{86}$/.test(e.signature ?? '')) throw new Error('Invalid media background envelope');
    const key = await crypto.subtle.importKey('jwk', e.publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']); const bytes = decode(e.payload); const signature = decode(e.signature);
    if (await hash(await crypto.subtle.exportKey('spki', key)) !== e.keyId || (expected.publicKeys && !pins.has(e.keyId)) || encode(bytes) !== e.payload || encode(signature) !== e.signature || !await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, bytes)) throw new Error('Untrusted media background signature');
    const d = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (d.issuer !== expected.issuer || d.projectId !== expected.projectId || d.purpose !== `field-data.${prefix}-${kind}@1`) throw new Error('Wrong media background scope'); return d;
  };
  const a = proof?.authorization; const d = await authority(a?.attestation, 'authorization');
  for (const k of ['id', 'uploadId', 'ownerId', 'senderId', 'projectId', 'submissionDefId', 'tokenHash']) if (d[k] !== a[k]) throw new Error('Media authorization binding mismatch');
  const m = d.manifest; const start = Date.parse(d.issuedAt); const end = Date.parse(d.expiresAt);
  if (!m || Object.keys(m).length !== 8 || m.id !== d.uploadId || !['xmlFormId', 'instanceId', 'name', 'contentType'].every(k => typeof m[k] === 'string' && m[k].length > 0 && m[k].length <= 1000) || !Number.isSafeInteger(m.size) || m.size < 1 || m.size > 20971520 || ![1, 2, 3].includes(m.priority) || !/^[a-f0-9]{64}$/.test(m.sha256) || !/^[a-f0-9]{64}$/.test(d.tokenHash) || canonical(m) !== canonical(a.manifest) || ![d.ownerId, d.senderId, d.submissionDefId].every(n => Number.isSafeInteger(n) && n > 0) || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 86400000 || Date.parse(a.expiresAt) !== end || !Array.isArray(proof.events) || proof.events.length > 2) throw new Error('Invalid media authorization bounds');
  let courierReceipt = null; let courierRevoked = false; let unsignedRevocation = false;
  if (a.courierGrantId) {
    const cp = proof.courier; const g = await authority(cp?.grant?.attestation, 'grant', 'media-courier');
    for (const k of ['id', 'uploadId', 'ownerId', 'courierId', 'projectId', 'submissionDefId']) if (g[k] !== cp.grant[k]) throw new Error('Invalid original media grant');
    const grantHash = await hash(decode(cp.grant.attestation.payload));
    if (d.courierGrantId !== a.courierGrantId || g.id !== a.courierGrantId || g.uploadId !== d.uploadId || g.ownerId !== d.ownerId || g.courierId !== d.senderId || g.submissionDefId !== d.submissionDefId || canonical(g.manifest) !== canonical(m) || canonical(cp.grant.manifest) !== canonical(m) || d.courierGrantPayloadHash !== grantHash || Date.parse(cp.grant.expiresAt) !== Date.parse(g.expiresAt) || !Number.isFinite(Date.parse(g.issuedAt)) || Date.parse(g.expiresAt) <= Date.parse(g.issuedAt) || Date.parse(g.expiresAt) - Date.parse(g.issuedAt) > 86400000 || start < Date.parse(g.issuedAt) || end > Date.parse(g.expiresAt) || !Array.isArray(cp.events) || cp.events.length > 2) throw new Error('Invalid media courier continuation');
    const seen = new Set();
    for (const e of cp.events) {
      if (!['revoke', 'delivery'].includes(e.kind) || seen.has(e.kind) || e.grantId !== g.id) throw new Error('Invalid media custody history'); seen.add(e.kind);
      if (e.kind === 'revoke' && !e.attestation) { courierRevoked = true; unsignedRevocation = true; continue; }
      const v = await authority(e.attestation, e.kind, 'media-courier');
      if (canonical(v) !== canonical({ ...e.details, issuer: v.issuer, purpose: v.purpose }) || v.grantId !== g.id || v.uploadId !== g.uploadId || v.grantPayloadHash !== grantHash) throw new Error('Invalid media custody binding');
      if (e.kind === 'revoke') { if (v.revokedBy !== g.ownerId) throw new Error('Wrong original revoker'); courierRevoked = true; }
      else {
        if (v.ownerId !== d.ownerId || v.submissionDefId !== d.submissionDefId || ![g.ownerId, g.courierId].includes(v.receivedBy) || v.sha256 !== m.sha256 || v.size !== m.size || !Number.isSafeInteger(v.blobId) || !Number.isFinite(Date.parse(v.receivedAt)) || Date.parse(v.receivedAt) < Date.parse(g.issuedAt) || (v.receivedBy === g.courierId && Date.parse(v.receivedAt) >= Date.parse(g.expiresAt))) throw new Error('Invalid original delivery'); courierReceipt = v;
      }
    }
  } else if (d.courierGrantId != null || proof.courier != null || d.ownerId !== d.senderId) throw new Error('Unexpected media delegation');
  const authorizationHash = await hash(decode(a.attestation.payload)); const seen = new Set(); let delivery = null;
  for (const e of proof.events) {
    if (!['delivery', 'revoke'].includes(e.kind) || seen.has(e.kind) || e.authorizationId !== a.id) throw new Error('Invalid media background history'); seen.add(e.kind);
    if (e.kind === 'revoke' && !e.attestation) { unsignedRevocation = true; continue; }
    const v = await authority(e.attestation, e.kind);
    if (canonical(v) !== canonical({ ...e.details, issuer: v.issuer, purpose: v.purpose }) || v.authorizationId !== a.id || v.uploadId !== d.uploadId || v.ownerId !== d.ownerId || v.senderId !== d.senderId || v.authorizationPayloadHash !== authorizationHash) throw new Error('Invalid media background event');
    if (e.kind === 'revoke' && ![d.ownerId, d.senderId].includes(v.revokedBy)) throw new Error('Wrong media background revoker');
    if (e.kind === 'delivery') {
      if (v.submissionDefId !== d.submissionDefId || v.receivedBy !== d.senderId || v.sha256 !== m.sha256 || v.size !== m.size || !Number.isSafeInteger(v.blobId) || v.blobId < 1 || v.transport !== 'background-capability' || typeof v.alreadyReceived !== 'boolean' || !Number.isFinite(Date.parse(v.receivedAt)) || Date.parse(v.receivedAt) < start || Date.parse(v.receivedAt) >= end || (a.courierGrantId && (!courierReceipt || courierReceipt.blobId !== v.blobId || (!v.alreadyReceived && (courierReceipt.receivedBy !== d.senderId || courierReceipt.backgroundAuthorizationId !== a.id || courierReceipt.backgroundAuthorizationPayloadHash !== authorizationHash))))) throw new Error('Invalid media background receipt'); delivery = v;
    }
  }
  return { details: d, delivery, revoked: seen.has('revoke') || courierRevoked, unsignedRevocation };
};
export const verifyMediaBackgroundProof = async (proof, expected) => {
  if (!Array.isArray(expected?.publicKeys) || !expected.publicKeys.length) throw new Error('Independently pin issuer, project and public keys');
  const result = await verify(proof, expected);
  if (result.unsignedRevocation) throw new Error('Unsigned revocation requires a current authenticated server snapshot');
  return result;
};
