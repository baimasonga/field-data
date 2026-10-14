// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { createPublicKey, createHash, verify } = require('node:crypto');
const { UUID_PATTERN } = require('./claim-versioning');
const Problem = require('./problem');
const context = (row, actorId) => ({ purpose: 'field-data.capture-witness@1', challengeId: row.id,
  projectId: row.projectId, submissionDefId: row.submissionDefId, xmlFormId: row.xmlFormId,
  instanceId: row.instanceId, name: row.name, code: row.nonce.slice(0, 8).toUpperCase(), contentHash: row.contentHash, witnessId: actorId });
const payload = (scope, requestId, signedAt, statement) => JSON.stringify({ ...scope, requestId, signedAt, statement });
const valid64 = (s, size) => typeof s === 'string' && /^[A-Za-z0-9_-]+$/.test(s) && Buffer.from(s, 'base64url').length === size && Buffer.from(s, 'base64url').toString('base64url') === s;
const checked = (body, row, actorId) => {
  try {
    if (!body || Object.keys(body).length !== 6 || Object.keys(body).some(k => !['requestId', 'signedAt', 'statement', 'payload', 'publicKey', 'signature'].includes(k)) ||
      !UUID_PATTERN.test(body.requestId ?? '') || typeof body.statement !== 'string' || body.statement !== body.statement.trim() || body.statement.length < 10 || body.statement.length > 2000 ||
      typeof body.signedAt !== 'string' || new Date(body.signedAt).toISOString() !== body.signedAt || typeof body.payload !== 'string' || body.payload.length > 12000 ||
      body.payload !== Buffer.from(payload(context(row, actorId), body.requestId, body.signedAt, body.statement)).toString('base64url') || !valid64(body.signature, 64)) throw new Error();
    const jwk = body.publicKey;
    if (!jwk || Object.keys(jwk).some(k => !['kty', 'crv', 'x', 'y', 'ext', 'key_ops'].includes(k)) || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !valid64(jwk.x, 32) || !valid64(jwk.y, 32)) throw new Error();
    const publicKey = { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
    const key = createPublicKey({ key: publicKey, format: 'jwk' });
    if (!verify('sha256', Buffer.from(body.payload, 'base64url'), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(body.signature, 'base64url'))) throw new Error();
    const requestHash = createHash('sha256').update(JSON.stringify({ payload: body.payload, publicKey, signature: body.signature })).digest('hex');
    return { ...body, publicKey, requestHash };
  } catch { throw Problem.user.captureWitnessInvalid(); }
};
const metadata = row => ({ id: row.id, witnessId: row.witnessId, witnessName: row.witnessName, receivedAt: row.receivedAt,
  algorithm: 'ES256', payload: row.payload, publicKey: row.publicKey, signature: row.signature });
module.exports = { context, payload, checked, metadata };
