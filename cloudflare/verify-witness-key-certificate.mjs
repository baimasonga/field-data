// Verify a reviewed account/key certificate with independently pinned issuer keys.
import { createHash, createPublicKey, verify } from 'node:crypto';
import { verifyWitnessKeyRevocation } from './verify-witness-key-revocation.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fingerprint = jwk => hash(createPublicKey({ key: jwk, format: 'jwk' }).export({ type: 'spki', format: 'der' }));
export const verifyWitnessKeyCertificate = (record, expected, proof = null) => {
  const trusted = expected?.publicKeys ?? (expected?.publicKey ? [expected.publicKey] : []);
  if (!trusted.length || !expected?.issuer || !Number.isInteger(expected.projectId) || !Number.isInteger(expected.subjectAccountId) || !/^[a-f0-9]{64}$/.test(expected.keyHash ?? '')) throw new Error('Independently trusted authority keys, issuer and expected account/key scope are required');
  if (record?.algorithm !== 'ES256' || record.publicKey?.d != null || record.publicKey?.crv !== 'P-256' || typeof record.payload !== 'string' || record.payload.length > 24000 || !/^[A-Za-z0-9_-]{86}$/.test(record.signature ?? '')) throw new Error('Invalid certificate envelope');
  if (record.keyId !== fingerprint(record.publicKey) || !trusted.some(key => fingerprint(key) === record.keyId)) throw new Error('Untrusted certificate issuer');
  const bytes = Buffer.from(record.payload, 'base64url'); const signature = Buffer.from(record.signature, 'base64url');
  if (bytes.toString('base64url') !== record.payload || signature.toString('base64url') !== record.signature || !verify('sha256', bytes, { key: createPublicKey({ key: record.publicKey, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, signature)) throw new Error('Invalid certificate signature');
  const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (data.purpose !== 'field-data.witness-key-certificate@1' || data.issuer !== expected.issuer || data.projectId !== expected.projectId || data.keyHash !== expected.keyHash || data.subjectAccountId !== expected.subjectAccountId || !Number.isInteger(data.reviewedBy) || data.reviewedBy === data.subjectAccountId ||
    !['account-control', 'organization-record', 'in-person-review'].includes(data.assuranceMethod) || typeof data.identityLabel !== 'string' || !data.identityLabel.trim() || data.identityLabel.length > 200 || typeof data.verificationNote !== 'string' || data.verificationNote.length < 10 || data.verificationNote.length > 2000 ||
    !Number.isFinite(Date.parse(data.proofReceivedAt)) || !Number.isFinite(Date.parse(data.certifiedAt)) || !Number.isFinite(Date.parse(data.expiresAt)) || Date.parse(data.proofReceivedAt) > Date.parse(data.certifiedAt) || Date.parse(data.certifiedAt) >= Date.parse(data.expiresAt) || !/^[a-f0-9]{64}$/.test(data.proofPayloadHash ?? '') || !/^[a-f0-9]{64}$/.test(data.proofSignatureHash ?? '')) throw new Error('Invalid certificate scope or review');
  if (proof) {
    const payload = Buffer.from(proof.payload, 'base64url'); const statement = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload));
    if (hash(payload) !== data.proofPayloadHash || hash(proof.signature) !== data.proofSignatureHash || fingerprint(proof.publicKey) !== data.keyHash || statement.projectId !== data.projectId || statement.witnessId !== data.subjectAccountId || !verify('sha256', payload, { key: createPublicKey({ key: proof.publicKey, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(proof.signature, 'base64url'))) throw new Error('Invalid retained key proof');
  }
  let revocationStatus = 'unknown';
  if (expected.revocation === null) revocationStatus = 'not-recorded-in-supplied-snapshot';
  else if (expected.revocation !== undefined) {
    const publicKey = trusted.find(key => fingerprint(key) === expected.revocation.keyId);
    if (!publicKey) throw new Error('Untrusted revocation authority');
    verifyWitnessKeyRevocation(expected.revocation, { publicKey, issuer: expected.issuer, projectId: expected.projectId, keyHash: expected.keyHash }); revocationStatus = 'revoked';
  }
  const at = Date.parse(expected.at ?? new Date().toISOString()); if (!Number.isFinite(at)) throw new Error('Invalid verification time');
  return { certificate: data, timeStatus: at < Date.parse(data.certifiedAt) ? 'not-yet-issued' : at >= Date.parse(data.expiresAt) ? 'expired' : 'within-window', revocationStatus, proofChecked: proof != null };
};
