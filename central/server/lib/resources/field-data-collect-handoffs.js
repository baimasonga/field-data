// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
/* eslint-disable no-await-in-loop, no-control-regex */
const { createHash, sign } = require('node:crypto');
const { Writable } = require('node:stream');
const { sql } = require('slonik');
const { Form } = require('../model/frames');
const Problem = require('../util/problem');
const xml = require('../util/xml-couriers');
const canonical = value => JSON.stringify(value == null || typeof value !== 'object' ? value : Array.isArray(value) ? value.map(v => JSON.parse(canonical(v))) : Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(canonical(value[k]))])));
const hash = value => createHash('sha256').update(value).digest('hex');
const invalid = () => Problem.user.mediaUploadInvalid(); const conflict = () => Problem.user.mediaUploadConflict();
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const file = value => exact(value, ['size', 'sha256']) && Number.isSafeInteger(value.size) && value.size > 0 && /^[a-f0-9]{64}$/.test(value.sha256);
const manifestFor = body => {
  if (!exact(body, ['xmlFormId', 'instanceId', 'version', 'xml', 'files']) || !['xmlFormId', 'instanceId', 'version'].every(k => typeof body[k] === 'string' && body[k].length <= 1000 && body[k].trim() === body[k] && !/[\u0000-\u001f\u007f]/.test(body[k])) || !body.xmlFormId || !body.instanceId || !file(body.xml) || body.xml.size > 1048576 || !Array.isArray(body.files) || body.files.length > 10) throw invalid();
  const names = new Set(); let total = 0;
  for (const entry of body.files) {
    if (!exact(entry, ['name', 'size', 'sha256']) || typeof entry.name !== 'string' || !entry.name.length || entry.name.length > 255 || /[/\\\u0000-\u001f\u007f]/.test(entry.name) || !file({ size: entry.size, sha256: entry.sha256 }) || names.has(entry.name)) throw invalid(); // eslint-disable-line no-control-regex
    names.add(entry.name); total += entry.size;
  }
  if (total > 20971520) throw invalid();
  return { ...body, files: [...body.files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) };
};
const verifyBlob = async (tx, blobId, expected) => {
  const blob = await tx.db.maybeOne(sql`SELECT id,sha,s3_status,octet_length(content) AS size FROM blobs WHERE id=${blobId} FOR SHARE`); if (!blob) throw conflict();
  if (blob.s3_status !== 'uploaded') {
    if (blob.size !== expected.size) throw conflict();
    const bytes = await tx.db.oneFirst(sql`SELECT content FROM blobs WHERE id=${blobId} AND octet_length(content)=${expected.size}`); if (!Buffer.isBuffer(bytes) || hash(bytes) !== expected.sha256) throw conflict(); return;
  }
  let size = 0; const digest = createHash('sha256');
  const sink = new Writable({ write(bytes, _, done) { size += bytes.length; if (size > expected.size) return done(conflict()); digest.update(bytes); done(); } });
  const stream = await tx.s3.pipeContent(blob);
  await new Promise((resolve, reject) => { stream.with(sink).pipelineToPromise(resolve, reject); });
  if (size !== expected.size || digest.digest('hex') !== expected.sha256) throw conflict();
};
const visits = new Map();
module.exports = (service, endpoint) => {
  service.post('/field-data/app-user/collect-handoffs/verify', endpoint(async (c, { auth, body }, request, response) => {
    const actor = auth.actor.orNull(); if (actor?.type !== 'field_key') throw Problem.user.insufficientRights();
    const manifest = manifestFor(body); const now = Date.now(); const key = `${actor.id}:${hash(request.headers.authorization ?? '')}`; let visit = visits.get(key);
    if (!visit || now - visit.at > 60000) { if (visits.size >= 1000) visits.delete(visits.keys().next().value); visit = { at: now, count: 0 }; visits.set(key, visit); }
    visit.count += 1; if (visit.count > 6) { response.status(429).set('Retry-After', '60'); return { message: 'Please retry in one minute.' }; }
    const result = await c.transacting(async tx => {
      await tx.db.query(sql`SELECT pg_advisory_xact_lock(74166)`);
      const projectId = await tx.db.maybeOneFirst(sql`SELECT "projectId" FROM field_keys WHERE "actorId"=${actor.id}`); if (!projectId) throw Problem.user.notFound();
      const form = await xml.scope(tx, actor.id, projectId, manifest);
      const source = await tx.db.maybeOne(sql`SELECT sd.id,sd.xml,sd."createdAt" FROM submission_defs sd JOIN submissions s ON s.id=sd."submissionId"
        WHERE s."formId"=${form.id} AND s."deletedAt" IS NULL AND s.draft=FALSE AND s."submitterId"=${actor.id} AND sd."submitterId"=${actor.id} AND sd.current AND sd."instanceId"=${manifest.instanceId} AND sd."formDefId"=${form.formDefId} FOR SHARE OF s,sd`);
      if (!source) throw Problem.user.notFound();
      if (Buffer.byteLength(source.xml) !== manifest.xml.size || hash(source.xml) !== manifest.xml.sha256) throw conflict();
      const attachments = await tx.db.any(sql`SELECT name,"blobId" FROM submission_attachments WHERE "submissionDefId"=${source.id} ORDER BY name FOR SHARE`);
      if (attachments.length !== manifest.files.length || attachments.some(a => !a.blobId || !manifest.files.some(entry => entry.name === a.name))) throw conflict();
      for (const attachment of attachments) await verifyBlob(tx, attachment.blobId, manifest.files.find(entry => entry.name === attachment.name));
      const settings = xml.config(); if (!settings) throw xml.invalid('Handoff snapshot signing is unavailable. The original files remain unchanged.');
      const { at } = await tx.db.one(sql`SELECT clock_timestamp() AS at`);
      const details = { projectId, ownerId: actor.id, formId: form.id, formDefId: form.formDefId, submissionDefId: source.id, manifest, manifestHash: hash(canonical(manifest)), submissionReceivedAt: new Date(source.createdAt).toISOString(), verifiedAt: new Date(at).toISOString(), issuer: settings.origin, purpose: 'field-data.collect-handoff-snapshot@1' };
      const bytes = Buffer.from(JSON.stringify(details)); const snapshot = { algorithm: 'ES256', keyId: settings.keyId, publicKey: settings.publicKey, payload: bytes.toString('base64url'), signature: sign('sha256', bytes, { key: settings.key, dsaEncoding: 'ieee-p1363' }).toString('base64url') };
      await tx.Audits.log(auth.actor, 'field_data.collect.handoff.verified', new Form({ id: form.id, acteeId: form.acteeId }), { submissionDefId: source.id, manifestHash: details.manifestHash, snapshotHash: hash(bytes), files: manifest.files.length });
      return { snapshot };
    }); response.set('Cache-Control', 'private, no-store'); return result;
  }));
};
