// Verify an exported witness envelope without dependencies or a running server.
import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const signedData = (record, limit = 12000) => {
  if (record?.algorithm !== 'ES256' || typeof record.payload !== 'string' || record.payload.length > limit ||
    !/^[A-Za-z0-9_-]{86}$/.test(record.signature ?? '') || record.publicKey?.kty !== 'EC' || record.publicKey.crv !== 'P-256' || record.publicKey.d != null) throw new Error('Invalid witness envelope');
  const bytes = Buffer.from(record.payload, 'base64url');
  if (bytes.toString('base64url') !== record.payload || Buffer.from(record.signature, 'base64url').toString('base64url') !== record.signature) throw new Error('Noncanonical payload');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const data = JSON.parse(text);
  const key = createPublicKey({ key: record.publicKey, format: 'jwk' });
  if (!verify('sha256', bytes, { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(record.signature, 'base64url'))) throw new Error('Invalid witness signature');
  return { data, text };
};
const hashPayload = record => createHash('sha256').update(Buffer.from(record.payload, 'base64url')).digest('hex');
const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value ?? '');
export const verifyCaptureWitness = (record, expectedHash) => {
  const { data } = signedData(record);
  if (data.purpose !== 'field-data.capture-witness@1' || !/^[0-9a-f]{64}$/.test(data.contentHash ?? '') ||
    typeof data.statement !== 'string' || data.statement.length < 10 || data.statement.length > 2000 ||
    !Number.isInteger(data.witnessId) || (record.witnessId != null && record.witnessId !== data.witnessId) ||
    !Number.isFinite(Date.parse(data.signedAt)) || (expectedHash != null && expectedHash !== data.contentHash)) throw new Error('Invalid witness scope or image fingerprint');
  if (record.events === undefined) return data;
  if (!uuid(record.id) || !Array.isArray(record.events) || record.events.length > 21) throw new Error('Invalid witness history');
  const { purpose, requestId, signedAt, statement, ...scope } = data;
  const originalPayloadHash = hashPayload(record); let previous = record; let status = 'active'; let effectiveStatement = data.statement;
  const changes = [];
  for (const event of record.events) {
    const { data: change, text } = signedData(event, 24000); const sequence = changes.length + 1;
    const expected = { purpose: 'field-data.capture-witness-change@1', ...scope, witnessRecordId: record.id, originalPayloadHash,
      sequence, previousPayloadHash: hashPayload(previous), requestId: change.requestId, signedAt: change.signedAt,
      action: change.action, statement: change.statement, reason: change.reason };
    if (status === 'withdrawn' || text !== JSON.stringify(expected) || event.sequence !== sequence || event.action !== change.action ||
      (event.actorId != null && event.actorId !== data.witnessId) || !uuid(change.requestId) || !Number.isFinite(Date.parse(change.signedAt)) ||
      !['correct', 'withdraw'].includes(change.action) || (change.action === 'correct' && sequence > 20) ||
      typeof change.reason !== 'string' || change.reason !== change.reason.trim() || change.reason.length < 10 || change.reason.length > 2000 ||
      (change.action === 'withdraw' ? change.statement !== null : typeof change.statement !== 'string' || change.statement !== change.statement.trim() || change.statement.length < 10 || change.statement.length > 2000)) throw new Error('Invalid witness change scope or chain');
    status = change.action === 'withdraw' ? 'withdrawn' : 'active'; effectiveStatement = change.statement;
    changes.push(change); previous = event;
  }
  if ((record.status != null && record.status !== status) || (record.revision != null && record.revision !== changes.length)) throw new Error('Inconsistent witness state');
  return { ...data, lifecycle: { status, effectiveStatement, changes } };
};
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const record = JSON.parse(await readFile(process.argv[2], 'utf8'));
    const data = verifyCaptureWitness(record, process.argv[3]);
    process.stdout.write(`${data.lifecycle ? `Included history ends ${data.lifecycle.status}. Current history must be checked with the authenticated server.\n` : 'No lifecycle history provided; active status is unknown.\n'}Signature verified for challenge ${data.challengeId}, image ${data.contentHash}.\nAccount attribution requires the authenticated server record. This does not prove presence or claim truth.\n`);
  } catch (error) { process.stderr.write(`Verification failed: ${error.message}\n`); process.exitCode = 1; }
}
