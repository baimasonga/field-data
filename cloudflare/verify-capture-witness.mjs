// Verify an exported witness envelope without dependencies or a running server.
import { createPublicKey, verify } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
export const verifyCaptureWitness = (record, expectedHash) => {
  if (record?.algorithm !== 'ES256' || typeof record.payload !== 'string' || record.payload.length > 12000 ||
    !/^[A-Za-z0-9_-]{86}$/.test(record.signature ?? '') || record.publicKey?.kty !== 'EC' || record.publicKey.crv !== 'P-256' || record.publicKey.d != null) throw new Error('Invalid witness envelope');
  const bytes = Buffer.from(record.payload, 'base64url');
  if (bytes.toString('base64url') !== record.payload) throw new Error('Noncanonical payload');
  const data = JSON.parse(bytes.toString('utf8'));
  if (data.purpose !== 'field-data.capture-witness@1' || !/^[0-9a-f]{64}$/.test(data.contentHash ?? '') ||
    typeof data.statement !== 'string' || data.statement.length < 10 || data.statement.length > 2000 ||
    !Number.isInteger(data.witnessId) || (record.witnessId != null && record.witnessId !== data.witnessId) ||
    !Number.isFinite(Date.parse(data.signedAt)) || (expectedHash != null && expectedHash !== data.contentHash)) throw new Error('Invalid witness scope or image fingerprint');
  const key = createPublicKey({ key: record.publicKey, format: 'jwk' });
  if (!verify('sha256', bytes, { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(record.signature, 'base64url'))) throw new Error('Invalid witness signature');
  return data;
};
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const record = JSON.parse(await readFile(process.argv[2], 'utf8'));
    const data = verifyCaptureWitness(record, process.argv[3]);
    process.stdout.write(`Signature verified for challenge ${data.challengeId}, image ${data.contentHash}.\nAccount attribution requires the authenticated server record. This does not prove presence or claim truth.\n`);
  } catch (error) { process.stderr.write(`Verification failed: ${error.message}\n`); process.exitCode = 1; }
}
