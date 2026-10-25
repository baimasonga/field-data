// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const decode = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), ch => ch.charCodeAt(0));
const encode = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
export const verifyDelegationEnvelope = async (record, purpose) => {
  if (record?.algorithm !== 'ES256' || record.publicKey?.d != null || record.publicKey?.kty !== 'EC' || record.publicKey?.crv !== 'P-256' || typeof record.payload !== 'string' || record.payload.length > 24000 || !/^[A-Za-z0-9_-]{86}$/.test(record.signature ?? '')) throw new Error('Invalid delegation envelope');
  const bytes = decode(record.payload); const signature = decode(record.signature);
  if (encode(bytes) !== record.payload || encode(signature) !== record.signature) throw new Error('Invalid delegation encoding');
  const key = await crypto.subtle.importKey('jwk', record.publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
  if (record.keyId !== await hash(await crypto.subtle.exportKey('spki', key)) || !await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, bytes)) throw new Error('Invalid delegation signature');
  const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const issuer = new URL(data.issuer);
  if (data.purpose !== `field-data.witness-${purpose}@1` || issuer.origin !== data.issuer || issuer.username || issuer.password || (issuer.protocol !== 'https:' && !(issuer.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(issuer.hostname)))) throw new Error('Invalid delegation purpose or issuer');
  return data;
};
export const verifyAuthorization = async (authorization, witness) => {
  if (authorization == null) return null;
  if (authorization.kind !== 'delegated-witness') throw new Error('Invalid witness authorization');
  const [grant, receipt] = await Promise.all([verifyDelegationEnvelope(authorization.delegation, 'delegation'), verifyDelegationEnvelope(authorization.receipt, 'authorization')]);
  const data = JSON.parse(new TextDecoder().decode(decode(witness.payload)));
  const witnessKey = await crypto.subtle.importKey('jwk', witness.publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
  if (grant.projectId !== data.projectId || grant.xmlFormId !== data.xmlFormId || grant.delegateId !== data.witnessId || grant.delegationId !== receipt.delegationId ||
    receipt.projectId !== grant.projectId || receipt.formId !== grant.formId || receipt.xmlFormId !== grant.xmlFormId || receipt.delegateId !== grant.delegateId ||
    receipt.witnessKeyHash !== await hash(await crypto.subtle.exportKey('spki', witnessKey)) ||
    receipt.witnessPayloadHash !== await hash(decode(witness.payload)) || receipt.witnessSignatureHash !== await hash(new TextEncoder().encode(witness.signature)) ||
    receipt.delegationPayloadHash !== await hash(decode(authorization.delegation.payload)) ||
    !Number.isFinite(Date.parse(receipt.receivedAt)) || !(Date.parse(grant.grantedAt) <= Date.parse(receipt.receivedAt) && Date.parse(receipt.receivedAt) < Date.parse(grant.expiresAt)) || grant.issuer !== receipt.issuer) throw new Error('Invalid witness authorization binding');
  return { grant, receipt };
};
