// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const encode = bytes => btoa(Array.from(new Uint8Array(bytes), b => String.fromCharCode(b)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decode = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
export const signWitness = async (context, statement) => {
  if (!crypto.subtle || context?.purpose !== 'field-data.capture-witness@1') throw new Error('Signing unavailable');
  const requestId = crypto.randomUUID(); const signedAt = new Date().toISOString();
  const bytes = new TextEncoder().encode(JSON.stringify({ ...context, requestId, signedAt, statement }));
  // Only the public key is exported. The nonextractable private key is used once
  // in memory; retry uses the same signed envelope rather than a new key.
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, bytes);
  return { requestId, signedAt, statement, payload: encode(bytes), publicKey: await crypto.subtle.exportKey('jwk', keys.publicKey), signature: encode(signature) };
};
export const verifyWitness = async (record, context) => {
  if (record.algorithm !== 'ES256' || record.payload.length > 12000 || record.signature.length !== 86 || record.publicKey.kty !== 'EC' || record.publicKey.crv !== 'P-256') throw new Error('Invalid witness');
  const bytes = decode(record.payload); const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (data.purpose !== 'field-data.capture-witness@1' || data.challengeId !== context.id || data.contentHash !== context.contentHash ||
    (data.witnessId !== record.witnessId && record.witnessId != null) || typeof data.statement !== 'string' || data.statement.length > 2000 || !Number.isFinite(Date.parse(data.signedAt))) throw new Error('Invalid witness scope');
  const key = await crypto.subtle.importKey('jwk', record.publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, decode(record.signature), bytes);
  if (!valid) throw new Error('Invalid witness signature');
  return { ...record, statement: data.statement, signedAt: data.signedAt };
};
