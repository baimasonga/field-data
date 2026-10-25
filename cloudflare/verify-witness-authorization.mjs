// Independently pinned verification of delegated witness authorization receipts.
import { createHash, createPublicKey, verify } from 'node:crypto';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fingerprint = jwk => hash(createPublicKey({ key: jwk, format: 'jwk' }).export({ type: 'spki', format: 'der' }));
export const verifyWitnessAuthorization = (authorization, witness, expected) => {
  const keys = expected?.publicKeys ?? (expected?.publicKey ? [expected.publicKey] : []);
  if (!keys.length || typeof expected?.issuer !== 'string' || !Number.isInteger(expected.projectId) || typeof expected.xmlFormId !== 'string' || !Number.isInteger(expected.delegateId)) throw new Error('Independently trusted authority keys, issuer and expected scope are required');
  if (authorization?.kind !== 'delegated-witness') throw new Error('Missing delegated witness authorization');
  const checked = (envelope, purpose) => {
    if (envelope?.algorithm !== 'ES256' || envelope.publicKey?.d != null || envelope.publicKey?.crv !== 'P-256' || typeof envelope.payload !== 'string' || envelope.payload.length > 24000 || !/^[A-Za-z0-9_-]{86}$/.test(envelope.signature ?? '')) throw new Error('Invalid authority envelope');
    const keyId = fingerprint(envelope.publicKey);
    if (envelope.keyId !== keyId || !keys.some(key => fingerprint(key) === keyId)) throw new Error('Untrusted witness authorization authority');
    const bytes = Buffer.from(envelope.payload, 'base64url'); const signature = Buffer.from(envelope.signature, 'base64url');
    if (bytes.toString('base64url') !== envelope.payload || signature.toString('base64url') !== envelope.signature || !verify('sha256', bytes, { key: createPublicKey({ key: envelope.publicKey, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, signature)) throw new Error('Invalid authority signature');
    const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (data.purpose !== `field-data.witness-${purpose}@1` || data.issuer !== expected.issuer) throw new Error('Invalid authority purpose or issuer');
    return data;
  };
  const grant = checked(authorization.delegation, 'delegation'); const receipt = checked(authorization.receipt, 'authorization');
  const bytes = Buffer.from(witness.payload, 'base64url'); const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (grant.projectId !== expected.projectId || grant.xmlFormId !== expected.xmlFormId || grant.delegateId !== expected.delegateId ||
    grant.projectId !== data.projectId || grant.xmlFormId !== data.xmlFormId || grant.delegateId !== data.witnessId || receipt.projectId !== grant.projectId || receipt.formId !== grant.formId || receipt.xmlFormId !== grant.xmlFormId || receipt.delegateId !== grant.delegateId || receipt.delegationId !== grant.delegationId ||
    receipt.delegationPayloadHash !== hash(Buffer.from(authorization.delegation.payload, 'base64url')) || receipt.witnessPayloadHash !== hash(bytes) || receipt.witnessSignatureHash !== hash(witness.signature) || receipt.witnessKeyHash !== fingerprint(witness.publicKey) ||
    !Number.isFinite(Date.parse(receipt.receivedAt)) || !(Date.parse(grant.grantedAt) <= Date.parse(receipt.receivedAt) && Date.parse(receipt.receivedAt) < Date.parse(grant.expiresAt))) throw new Error('Invalid witness authorization binding');
  return { grant, receipt };
};
