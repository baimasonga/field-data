import checkedCertificate from './witness-certificates';
// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const decode = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
const publicKey = jwk => crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
const fingerprint = async jwk => hash(await crypto.subtle.exportKey('spki', await publicKey(jwk)));
// The authenticated server supplies online status. Included issuer keys allow
// signature checks, but offline consumers must pin an independently trusted key.
const verifyKeyTrust = async (record, projectId) => {
  const unknown = { status: 'unknown', keys: [], canRevoke: false, signingAvailable: false };
  try {
    const state = record.keyTrust;
    if (!state || !['clear', 'revoked'].includes(state.status) || !Number.isFinite(Date.parse(state.checkedAt)) || !Array.isArray(state.keys)) return unknown;
    const hashes = [...new Set(await Promise.all([record, ...(record.events ?? [])].map(row => fingerprint(row.publicKey))))];
    if (state.keys.length !== hashes.length || new Set(state.keys.map(row => row.keyHash)).size !== hashes.length || state.keys.some(row => !hashes.includes(row.keyHash))) return unknown;
    const keys = await Promise.all(state.keys.map(async row => {
      const checked = await checkedCertificate(row.certificate, projectId, row.keyHash, record.witnessId, state.checkedAt);
      const certificate = { canRevoke: row.canRevoke === undefined ? state.canRevoke === true : row.canRevoke === true, certificate: row.certificate ?? null, certificateDetails: checked?.details ?? null, certificateStatus: checked?.status ?? 'uncertified' };
      if (row.revocation === null) return { keyHash: row.keyHash, revocation: null, ...certificate };
      const cert = row.revocation;
      if (cert?.algorithm !== 'ES256' || typeof cert.payload !== 'string' || cert.payload.length > 12000 || !/^[A-Za-z0-9_-]{86}$/.test(cert.signature) || cert.publicKey?.d != null || cert.keyId !== await fingerprint(cert.publicKey)) throw new Error();
      const bytes = decode(cert.payload);
      if (!await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, await publicKey(cert.publicKey), decode(cert.signature), bytes)) throw new Error();
      const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (data.purpose !== 'field-data.witness-key-revocation@1' || data.projectId !== Number(projectId) || data.keyHash !== row.keyHash ||
        typeof data.reason !== 'string' || !['compromised', 'retired', 'other'].includes(data.reasonCode) || !Number.isFinite(Date.parse(data.revokedAt)) || new URL(data.issuer).origin !== data.issuer) throw new Error();
      return { keyHash: row.keyHash, revocation: cert, details: data, ...certificate };
    }));
    if ((keys.some(row => row.revocation !== null) ? 'revoked' : 'clear') !== state.status) return unknown;
    return { status: state.status, checkedAt: state.checkedAt, keys, canCertify: state.canCertify === true, canRevoke: state.canRevoke === true, signingAvailable: state.signingAvailable === true };
  } catch { return unknown; }
};

export default verifyKeyTrust;
