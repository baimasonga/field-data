// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { createPublicKey, createHash, sign } = require('node:crypto');
const { sql } = require('slonik');
const { config } = require('./offline-assignments');
const { UUID_PATTERN } = require('./claim-versioning');
const keyHash = publicKey => createHash('sha256').update(createPublicKey({ key: publicKey, format: 'jwk' }).export({ type: 'spki', format: 'der' })).digest('hex');
const trustLock = (db, projectId) => db.query(sql`SELECT pg_advisory_xact_lock(74155, ${Number(projectId)})`);
const keyRevoked = async (db, projectId, publicKey) => (await db.maybeOne(sql`SELECT "keyHash" FROM field_data_witness_key_revocations WHERE "projectId" = ${Number(projectId)} AND "keyHash" = ${keyHash(publicKey)}`)) != null;
const trustFor = async (db, projectId, witness, events) => {
  const hashes = [...new Set([witness, ...events].map(row => keyHash(row.publicKey)))];
  const rows = await db.any(sql`SELECT "keyHash", attestation FROM field_data_witness_key_revocations WHERE "projectId" = ${Number(projectId)} AND "keyHash" = ANY(${sql.array(hashes, 'text')})`);
  const certificates = await db.any(sql`SELECT "keyHash",attestation FROM field_data_witness_key_certificates WHERE "projectId"=${Number(projectId)} AND "keyHash"=ANY(${sql.array(hashes, 'text')})`);
  return { status: rows.length ? 'revoked' : 'clear', checkedAt: new Date(await db.oneFirst(sql`SELECT clock_timestamp()`)).toISOString(),
    keys: hashes.map(hash => ({ keyHash: hash, revocation: rows.find(row => row.keyHash === hash)?.attestation ?? null, certificate: certificates.find(row => row.keyHash === hash)?.attestation ?? null })) };
};
const validateRevocation = body => {
  if (!body || Object.keys(body).length !== 4 || Object.keys(body).some(k => !['requestId', 'keyHash', 'reasonCode', 'reason'].includes(k)) || !UUID_PATTERN.test(body.requestId ?? '') ||
    !/^[0-9a-f]{64}$/.test(body.keyHash ?? '') || !['compromised', 'retired', 'other'].includes(body.reasonCode) ||
    typeof body.reason !== 'string' || body.reason !== body.reason.trim() || body.reason.length < 10 || body.reason.length > 2000) return null;
  return { requestId: body.requestId, keyHash: body.keyHash, reasonCode: body.reasonCode, reason: body.reason };
};
const revocationHash = (body, actorId) => createHash('sha256').update(JSON.stringify({ actorId, ...body })).digest('hex');
const attest = (settings, data) => {
  const bytes = Buffer.from(JSON.stringify({ ...data, purpose: 'field-data.witness-key-revocation@1', issuer: settings.origin }));
  return { algorithm: 'ES256', keyId: settings.keyId, publicKey: settings.publicKey, payload: bytes.toString('base64url'),
    signature: sign('sha256', bytes, { key: settings.key, dsaEncoding: 'ieee-p1363' }).toString('base64url') };
};
const lockProjectManager = async (tx, actorId, project) => {
  if (!project) return false;
  const grant = await tx.db.maybeOne(sql`WITH RECURSIVE implied(id) AS (
    (SELECT ${project.acteeId}::varchar) UNION (SELECT unnest(ARRAY[parent, species]) FROM actees JOIN implied ON implied.id = actees.id))
    SELECT ass."actorId" FROM assignments ass JOIN implied ON implied.id = ass."acteeId" JOIN roles r ON r.id = ass."roleId"
    WHERE ass."actorId" = ${actorId} AND r.verbs ? 'project.update' LIMIT 1 FOR SHARE OF ass, r`);
  return grant != null;
};
module.exports = { keyHash, trustLock, keyRevoked, trustFor, validateRevocation, revocationHash, attest, config, lockProjectManager };
