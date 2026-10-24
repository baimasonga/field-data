// Verify a revocation against an independently trusted issuer public key.
import { createHash, createPublicKey, verify } from 'node:crypto';
const fingerprint = key => createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex');
export const verifyWitnessKeyRevocation = (record, expected) => {
  if (!expected?.publicKey || !expected.issuer || !Number.isInteger(expected.projectId) || !/^[a-f0-9]{64}$/.test(expected.keyHash ?? '')) throw new Error('An independently trusted issuer key and expected scope are required');
  const trusted = createPublicKey({ key: expected.publicKey, format: 'jwk' });
  if (record?.algorithm !== 'ES256' || record.publicKey?.d != null || record.publicKey?.crv !== 'P-256' || typeof record.payload !== 'string' || record.payload.length > 12000 || !/^[A-Za-z0-9_-]{86}$/.test(record.signature ?? '')) throw new Error('Invalid revocation envelope');
  const key = createPublicKey({ key: record.publicKey, format: 'jwk' });
  if (record.keyId !== fingerprint(trusted) || fingerprint(key) !== fingerprint(trusted)) throw new Error('Untrusted revocation issuer key');
  const bytes = Buffer.from(record.payload, 'base64url'); const signature = Buffer.from(record.signature, 'base64url');
  if (bytes.toString('base64url') !== record.payload || signature.toString('base64url') !== record.signature || !verify('sha256', bytes, { key: trusted, dsaEncoding: 'ieee-p1363' }, signature)) throw new Error('Invalid revocation signature');
  const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (data.purpose !== 'field-data.witness-key-revocation@1' || data.issuer !== expected.issuer || data.projectId !== expected.projectId || data.keyHash !== expected.keyHash || !Number.isFinite(Date.parse(data.revokedAt)) || !['compromised', 'retired', 'other'].includes(data.reasonCode) || typeof data.reason !== 'string' || data.reason.length < 10 || data.reason.length > 2000) throw new Error('Invalid revocation scope');
  return data;
};
