// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { randomUUID, createHash, sign } = require('node:crypto');
const { sql } = require('slonik');
const Problem = require('./problem');
const { config } = require('./offline-assignments');
const digest = value => createHash('sha256').update(value).digest('hex');
const invalid = reason => Problem.user.unexpectedValue({ field: 'mediaCourier', reason });
const attest = (settings, kind, details) => {
  const bytes = Buffer.from(JSON.stringify({ ...details, purpose: `field-data.media-courier-${kind}@1`, issuer: settings.origin }));
  return { algorithm: 'ES256', keyId: settings.keyId, publicKey: settings.publicKey, payload: bytes.toString('base64url'), signature: sign('sha256', bytes, { key: settings.key, dsaEncoding: 'ieee-p1363' }).toString('base64url') };
};
const grantFor = (tx, uploadId) => tx.db.maybeOne(sql`SELECT * FROM field_data_media_couriers WHERE "uploadId"=${uploadId}`);
const account = (tx, id, projectId) => tx.db.maybeOne(sql`SELECT a.id FROM actors a JOIN field_keys fk ON fk."actorId"=a.id
 JOIN projects p ON p.id=fk."projectId" AND p."deletedAt" IS NULL AND p.archived IS NOT TRUE
 WHERE a.id=${id} AND a.type='field_key' AND a."deletedAt" IS NULL AND fk."projectId"=${projectId} FOR SHARE OF a,fk,p`);
const authorize = async (tx, actor, row) => {
  if (row.actorId === actor.id) return;
  const grant = await grantFor(tx, row.id);
  if (!grant || grant.ownerId !== row.actorId || grant.projectId !== row.projectId || grant.submissionDefId !== row.submissionDefId || JSON.stringify(grant.manifest) !== JSON.stringify(row.manifest) || grant.courierId !== actor.id || !await account(tx, actor.id, row.projectId)) throw Problem.user.notFound();
  const valid = await tx.db.oneFirst(sql`SELECT ${new Date(grant.expiresAt).toISOString()}::timestamptz>clock_timestamp()
    AND NOT EXISTS(SELECT 1 FROM field_data_media_courier_events WHERE "grantId"=${grant.id} AND kind='revoke')`);
  if (!valid) throw Problem.user.notFound();
};
const delivery = async (tx, actor, row, blobId) => {
  const grant = await grantFor(tx, row.id); if (!grant) return;
  const settings = config();
  if (!settings) throw invalid('Courier delivery signing is unavailable. Retry after service is restored.');
  if (JSON.parse(Buffer.from(grant.attestation.payload, 'base64url')).issuer !== settings.origin) throw invalid('The courier authority origin changed. Revoke this grant and start another transfer.');
  await authorize(tx, actor, row);
  const prior = await tx.db.maybeOne(sql`SELECT id FROM field_data_media_courier_events WHERE "grantId"=${grant.id} AND kind='delivery'`);
  if (prior) return;
  const { at } = await tx.db.one(sql`SELECT clock_timestamp() AS at`);
  if (actor.id !== row.actorId && (new Date(grant.expiresAt).getTime() <= new Date(at).getTime() || new Date(row.expiresAt).getTime() <= new Date(at).getTime())) throw Problem.user.notFound();
  const details = { grantId: grant.id, uploadId: row.id, projectId: row.projectId, submissionDefId: row.submissionDefId,
    ownerId: row.actorId, receivedBy: actor.id, sha256: row.manifest.sha256, size: row.manifest.size, blobId,
    grantPayloadHash: digest(Buffer.from(grant.attestation.payload, 'base64url')), receivedAt: new Date(at).toISOString() };
  await tx.db.query(sql`INSERT INTO field_data_media_courier_events(id,"grantId",kind,"requestId","requestHash",details,attestation)
    VALUES(${randomUUID()},${grant.id},'delivery',${randomUUID()},${digest(JSON.stringify(details))},${JSON.stringify(details)},${JSON.stringify(attest(settings, 'delivery', details))})`);
};
module.exports = { config, digest, invalid, attest, grantFor, account, authorize, delivery };
