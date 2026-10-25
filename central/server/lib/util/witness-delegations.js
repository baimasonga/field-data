// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { createHash, createPublicKey, sign } = require('node:crypto');
const { sql } = require('slonik');
const Problem = require('./problem');
const { config } = require('./offline-assignments');
const { lockGrant } = require('./knowledge-data');
const invalid = reason => Problem.user.unexpectedValue({ field: 'witnessDelegation', reason });
const digest = value => createHash('sha256').update(value).digest('hex');
const attest = (settings, purpose, details) => {
  const bytes = Buffer.from(JSON.stringify({ ...details, purpose: `field-data.witness-${purpose}@1`, issuer: settings.origin }));
  return { algorithm: 'ES256', keyId: settings.keyId, publicKey: settings.publicKey, payload: bytes.toString('base64url'), signature: sign('sha256', bytes, { key: settings.key, dsaEncoding: 'ieee-p1363' }).toString('base64url') };
};
const readGrant = (db, actorId, form) => db.maybeOne(sql`WITH RECURSIVE implied(id) AS (
 (SELECT ${form.acteeId}::varchar) UNION (SELECT unnest(ARRAY[parent,species]) FROM actees JOIN implied ON implied.id=actees.id))
 SELECT ass."actorId" FROM assignments ass JOIN implied ON implied.id=ass."acteeId" JOIN roles r ON r.id=ass."roleId"
 WHERE ass."actorId"=${actorId} AND r.verbs ? 'submission.read' LIMIT 1`);
const activeFor = (db, formId, actorId = null) => db.any(sql`SELECT g.* FROM field_data_witness_delegations g
 WHERE g."formId"=${formId} AND g.kind='grant' AND (${actorId}::integer IS NULL OR g."delegateId"=${actorId}::integer)
 AND (g.details->>'expiresAt')::timestamptz>clock_timestamp()
 AND NOT EXISTS(SELECT 1 FROM field_data_witness_delegations r WHERE r."delegationId"=g.id AND r.kind='revoke') ORDER BY g.sequence DESC LIMIT 100`);
const maySign = async (c, auth, form) => {
  if (auth.actor.orNull()?.type !== 'user') return false;
  if (await auth.can('submission.update', form)) return true;
  const settings = config();
  return settings != null && (await activeFor(c.db, form.id, auth.actor.get().id)).some(grant => JSON.parse(Buffer.from(grant.attestation.payload, 'base64url')).issuer === settings.origin);
};
const lockSigner = async (tx, auth, form, withdrawal = false) => {
  const actorId = auth.actor.get().id;
  const actor = await tx.db.maybeOne(sql`SELECT id,"displayName" FROM actors WHERE id=${actorId} AND type='user' AND "deletedAt" IS NULL FOR SHARE`);
  if (!actor) throw Problem.user.notFound();
  await lockGrant(tx.db, actorId, form.acteeId, 'submission.read');
  if (await auth.can('submission.update', form)) { await lockGrant(tx.db, actorId, form.acteeId, 'submission.update'); return { ...actor, authorization: null }; }
  if (withdrawal) return { ...actor, authorization: null };
  const settings = config(); const grant = (await activeFor(tx.db, form.id, actorId)).find(row => JSON.parse(Buffer.from(row.attestation.payload, 'base64url')).issuer === settings?.origin);
  if (!grant || !settings) throw Problem.user.notFound();
  return { ...actor, authorization: grant };
};
const receipt = (signer, body, receivedAt) => {
  if (!signer.authorization) return null;
  const settings = config(); if (!settings) throw invalid('Witness delegation signing is unavailable.');
  const grant = signer.authorization;
  if (JSON.parse(Buffer.from(grant.attestation.payload, 'base64url')).issuer !== settings.origin) throw invalid('The delegation authority origin changed. Revoke and renew this permission.');
  if (Date.parse(grant.details.expiresAt) <= Date.parse(receivedAt)) throw invalid('Witness delegation expired before the statement could be recorded.');
  return { kind: 'delegated-witness', delegation: grant.attestation, receipt: attest(settings, 'authorization', {
    projectId: grant.projectId, formId: grant.formId, xmlFormId: grant.details.xmlFormId, delegateId: signer.id,
    delegationId: grant.id, delegationPayloadHash: digest(Buffer.from(grant.attestation.payload, 'base64url')),
    witnessPayloadHash: digest(Buffer.from(body.payload, 'base64url')), witnessSignatureHash: digest(body.signature), witnessKeyHash: digest(createPublicKey({ key: body.publicKey, format: 'jwk' }).export({ type: 'spki', format: 'der' })), receivedAt: new Date(receivedAt).toISOString()
  }) };
};
module.exports = { invalid, digest, attest, readGrant, activeFor, maySign, lockSigner, receipt, config };
