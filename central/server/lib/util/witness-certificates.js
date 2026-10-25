// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { sql } = require('slonik');
const { createHash } = require('node:crypto');
const { UUID_PATTERN } = require('./claim-versioning');
const Problem = require('./problem');
const trust = require('./witness-key-trust');
const { checked, checkedChange, changeContext } = require('./capture-witnesses');
const invalid = reason => Problem.user.unexpectedValue({ field: 'witnessKeyCertificate', reason });
const METHODS = ['account-control', 'organization-record', 'in-person-review'];
const digest = value => createHash('sha256').update(value).digest('hex');
const validate = body => {
  if (!body || Object.keys(body).length !== 7 || Object.keys(body).some(key => !['requestId', 'keyHash', 'identityLabel', 'method', 'verificationNote', 'expiresAt', 'reviewed'].includes(key)) || !UUID_PATTERN.test(body.requestId ?? '') || !/^[a-f0-9]{64}$/.test(body.keyHash ?? '') || !METHODS.includes(body.method) || body.reviewed !== true ||
    typeof body.identityLabel !== 'string' || body.identityLabel !== body.identityLabel.trim() || body.identityLabel.length < 1 || body.identityLabel.length > 200 || typeof body.verificationNote !== 'string' || body.verificationNote !== body.verificationNote.trim() || body.verificationNote.length < 10 || body.verificationNote.length > 2000 || typeof body.expiresAt !== 'string' || !Number.isFinite(Date.parse(body.expiresAt)) || new Date(body.expiresAt).toISOString() !== body.expiresAt) throw invalid('Choose a retained key, identity label, review method, note, UTC expiry and explicit review acknowledgment.');
  return body;
};
// Recheck retained proof and its history before certifying an account/key binding.
const readProof = record => { try { return JSON.parse(Buffer.from(record.payload, 'base64url')); } catch { throw invalid('The retained proof payload cannot be decoded.'); } };
const proofFor = (row, witness, events, keyHash) => {
  const original = readProof(witness);
  checked({ requestId: original.requestId, signedAt: original.signedAt, statement: original.statement, payload: witness.payload, publicKey: witness.publicKey, signature: witness.signature }, row, witness.witnessId);
  let proof = trust.keyHash(witness.publicKey) === keyHash ? witness : null; let previous = null;
  for (const event of events) {
    const data = readProof(event);
    if (previous?.action === 'withdraw' || event.sequence !== (previous?.sequence ?? 0) + 1 || event.action !== data.action || (event.action === 'correct' && event.sequence > 20)) throw invalid('The retained proof history is inconsistent.');
    checkedChange({ requestId: data.requestId, signedAt: data.signedAt, action: data.action, statement: data.statement, reason: data.reason, payload: event.payload, publicKey: event.publicKey, signature: event.signature }, changeContext(row, witness, previous));
    if (event.actorId !== witness.witnessId) throw invalid('The retained key proof has an inconsistent account.');
    if (trust.keyHash(event.publicKey) === keyHash && proof == null) proof = event;
    previous = event;
  }
  if (!proof) throw Problem.user.notFound();
  return proof;
};
const assertOwner = async (db, projectId, publicKey, actorId, receivedAt = null) => {
  const row = await db.maybeOne(sql`SELECT "subjectAccountId",(attestation->>'payload') AS payload,clock_timestamp() AS now FROM field_data_witness_key_certificates WHERE "projectId"=${Number(projectId)} AND "keyHash"=${trust.keyHash(publicKey)}`);
  if (row) {
    const expiry = Date.parse(JSON.parse(Buffer.from(row.payload, 'base64url')).expiresAt);
    if (row.subjectAccountId !== actorId || !Number.isFinite(expiry) || expiry <= new Date(receivedAt ?? row.now).valueOf()) throw Problem.user.captureWitnessConflict();
  }
};
module.exports = { validate, proofFor, assertOwner, invalid, digest, METHODS };
