// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
import { createHash, createPublicKey, verify } from 'node:crypto';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(value == null || typeof value !== 'object' ? value : Array.isArray(value) ? value.map(v => JSON.parse(canonical(v))) : Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(canonical(value[k]))])));
export const verifyCollectHandoffSnapshot = (snapshot, expected) => {
  if (!expected?.issuer || !Number.isSafeInteger(expected.projectId) || !Number.isSafeInteger(expected.ownerId) || !Array.isArray(expected.publicKeys) || !expected.publicKeys.length) throw new Error('Independently pin issuer, project, collector and public keys');
  const keys = new Map(expected.publicKeys.map(jwk => { if (jwk.d != null || jwk.kty !== 'EC' || jwk.crv !== 'P-256') throw new Error('Use public P-256 keys'); const key = createPublicKey({ key: jwk, format: 'jwk' }); return [hash(key.export({ format: 'der', type: 'spki' })), key]; }));
  if (snapshot?.algorithm !== 'ES256' || typeof snapshot.payload !== 'string' || snapshot.payload.length > 24000 || !/^[A-Za-z0-9_-]{86}$/.test(snapshot.signature ?? '')) throw new Error('Invalid Collect snapshot envelope');
  const key = keys.get(snapshot.keyId); const bytes = Buffer.from(snapshot.payload, 'base64url'); const signature = Buffer.from(snapshot.signature, 'base64url');
  if (!key || bytes.toString('base64url') !== snapshot.payload || signature.toString('base64url') !== snapshot.signature || !verify('sha256', bytes, { key, dsaEncoding: 'ieee-p1363' }, signature)) throw new Error('Untrusted Collect snapshot signature');
  const d = JSON.parse(bytes.toString('utf8')); const m = d.manifest;
  if (d.purpose !== 'field-data.collect-handoff-snapshot@1' || d.issuer !== expected.issuer || d.projectId !== expected.projectId || d.ownerId !== expected.ownerId || ![d.formId, d.formDefId, d.submissionDefId].every(n => Number.isSafeInteger(n) && n > 0) || !Number.isFinite(Date.parse(d.submissionReceivedAt)) || !Number.isFinite(Date.parse(d.verifiedAt)) || Date.parse(d.submissionReceivedAt) > Date.parse(d.verifiedAt)) throw new Error('Wrong Collect snapshot scope');
  if (!m || Object.keys(m).length !== 5 || !['xmlFormId', 'instanceId', 'version'].every(k => typeof m[k] === 'string' && m[k].length <= 1000) || !m.xmlFormId || !m.instanceId || !m.xml || Object.keys(m.xml).length !== 2 || !Number.isSafeInteger(m.xml.size) || m.xml.size < 1 || m.xml.size > 1048576 || !/^[a-f0-9]{64}$/.test(m.xml.sha256) || !Array.isArray(m.files) || m.files.length > 10 || d.manifestHash !== hash(canonical(m)) || (expected.manifest && canonical(expected.manifest) !== canonical(m))) throw new Error('Invalid Collect manifest binding');
  let total = 0; const names = new Set();
  for (const f of m.files) {
    if (!f || Object.keys(f).length !== 3 || typeof f.name !== 'string' || !f.name.length || f.name.length > 255 || /[/\\\u0000-\u001f\u007f]/.test(f.name) || names.has(f.name) || !Number.isSafeInteger(f.size) || f.size < 1 || !/^[a-f0-9]{64}$/.test(f.sha256)) throw new Error('Invalid Collect file manifest'); names.add(f.name); total += f.size;
  }
  if (total > 20971520) throw new Error('Collect snapshot exceeds file bounds');
  return { ...d, limitations: 'Stored bytes verified at this time; no assertion of Collect origin, device presence, native queue status or later availability.' };
};
