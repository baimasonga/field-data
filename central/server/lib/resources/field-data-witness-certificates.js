// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { randomUUID } = require('node:crypto');
const { sql } = require('slonik');
const { scope, source } = require('../util/capture-review-target');
const delegation = require('../util/witness-delegations');
const trust = require('../util/witness-key-trust');
const certificates = require('../util/witness-certificates');
const { UUID_PATTERN } = require('../util/claim-versioning');
const Problem = require('../util/problem');
module.exports = (service, endpoint) => {
  const root = '/projects/:projectId/forms/:xmlFormId/submissions/:instanceId/capture-challenges/:challengeId/witnesses/:witnessRecordId/key-certificates';
  service.post(root, endpoint(async (c, { auth, params, body }, _, response) => {
    const form = await scope(c, auth, params); const actor = auth.actor.orNull();
    if (actor?.type !== 'user' || !UUID_PATTERN.test(params.witnessRecordId ?? '')) throw Problem.user.notFound();
    const data = certificates.validate(body);
    const result = await c.transacting(async tx => {
      await trust.trustLock(tx.db, params.projectId);
      const reviewer = await delegation.lockSigner(tx, auth, form, true);
      const project = (await tx.Projects.getById(params.projectId)).orNull();
      if (!await trust.lockProjectManager(tx, actor.id, project)) throw Problem.user.notFound();
      const row = await source(tx.db, params, form, true); if (!row) throw Problem.user.notFound();
      if (row.archived) throw certificates.invalid('Archived projects cannot issue key certificates.');
      const witness = await tx.db.maybeOne(sql`SELECT * FROM field_data_capture_witnesses WHERE id=${params.witnessRecordId} AND "challengeId"=${row.id}`);
      if (!witness || witness.witnessId === actor.id) throw Problem.user.notFound();
      const owner = await tx.db.maybeOne(sql`SELECT id,"displayName" FROM actors WHERE id=${witness.witnessId} AND type='user' AND "deletedAt" IS NULL FOR SHARE`);
      if (!owner) throw Problem.user.notFound();
      const events = await tx.db.any(sql`SELECT * FROM field_data_capture_witness_events WHERE "witnessRecordId"=${witness.id} ORDER BY sequence LIMIT 21`);
      const proof = certificates.proofFor(row, witness, events, data.keyHash);
      const requestHash = certificates.digest(JSON.stringify({ actorId: actor.id, witnessId: witness.id, ...data }));
      const prior = await tx.db.any(sql`SELECT * FROM field_data_witness_key_certificates WHERE "projectId"=${project.id} AND ("requestId"=${data.requestId} OR "keyHash"=${data.keyHash})`);
      if (prior.length) { if (prior.length !== 1 || prior[0].requestHash !== requestHash) throw new Problem(409, 'A key certificate or conflicting request already exists.'); return { attestation: prior[0].attestation, replayed: true }; }
      const settings = trust.config(); if (!settings) throw certificates.invalid('Server certificate signing is unavailable.');
      if (await trust.keyRevoked(tx.db, project.id, proof.publicKey)) throw new Problem(409, 'A revoked key cannot be certified.');
      const others = await tx.db.maybeOne(sql`SELECT id FROM (
        SELECT w.id,w."witnessId" AS actor,w."publicKey" FROM field_data_capture_witnesses w JOIN field_data_capture_challenges ch ON ch.id=w."challengeId" WHERE ch."projectId"=${project.id}
        UNION ALL SELECT e.id,e."actorId" AS actor,e."publicKey" FROM field_data_capture_witness_events e JOIN field_data_capture_witnesses w ON w.id=e."witnessRecordId" JOIN field_data_capture_challenges ch ON ch.id=w."challengeId" WHERE ch."projectId"=${project.id}
      ) signatures WHERE "publicKey"=${sql.json(proof.publicKey)} AND actor<>${owner.id} LIMIT 1`);
      if (others) throw new Problem(409, 'This retained key has been used by different accounts and cannot receive an unambiguous account certificate.');
      const at = new Date(await tx.db.oneFirst(sql`SELECT clock_timestamp()`));
      if (Date.parse(data.expiresAt) < at.valueOf() + 60000 || Date.parse(data.expiresAt) > at.valueOf() + 365 * 86400000) throw certificates.invalid('Certificate expiry must be one minute to 365 days ahead.');
      if (new Date(proof.receivedAt).valueOf() > at.valueOf()) throw certificates.invalid('The retained proof receipt is later than the certificate review time.');
      const id = randomUUID(); const details = { certificateId: id, projectId: project.id, keyHash: data.keyHash, subjectAccountId: owner.id, subjectAccountName: owner.displayName, identityLabel: data.identityLabel,
        assuranceMethod: data.method, verificationNote: data.verificationNote, reviewedBy: reviewer.id, reviewerName: reviewer.displayName, requestId: data.requestId,
        referenceWitnessId: witness.id, proofPayloadHash: certificates.digest(Buffer.from(proof.payload, 'base64url')), proofSignatureHash: certificates.digest(proof.signature), proofReceivedAt: new Date(proof.receivedAt).toISOString(), certifiedAt: at.toISOString(), expiresAt: data.expiresAt };
      const attestation = delegation.attest(settings, 'key-certificate', details);
      await tx.db.query(sql`INSERT INTO field_data_witness_key_certificates(id,"projectId","keyHash","subjectAccountId","requestId","requestHash",attestation) VALUES(${id},${project.id},${data.keyHash},${owner.id},${data.requestId},${requestHash},${sql.json(attestation)})`);
      await tx.Audits.log(auth.actor, 'field_data.witness.key.certified', form, { certificateId: id, keyHash: data.keyHash, subjectAccountId: owner.id, assuranceMethod: data.method, issuerKeyId: settings.keyId });
      return { attestation, replayed: false };
    });
    response.set('Cache-Control', 'private, no-store'); response.set('Idempotency-Status', result.replayed ? 'replayed' : 'created'); return result;
  }));
};
