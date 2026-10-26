// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { createHash, sign } = require('node:crypto');
const { SaxesParser } = require('saxes');
const { sql } = require('slonik');
const { Submission } = require('../model/frames');
const Problem = require('./problem');
const { config } = require('./offline-assignments');
const { account } = require('./media-couriers');
const LIMIT = 1024 * 1024;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const invalid = reason => Problem.user.unexpectedValue({ field: 'xmlCourier', reason });
const manifestFor = body => {
  const keys = ['xmlFormId', 'instanceId', 'version', 'size', 'sha256'];
  const edit = Object.hasOwn(body ?? {}, 'deprecatedId'); if (edit) keys.push('deprecatedId', 'baseSha256');
  const text = (value, empty = false) => typeof value === 'string' && (empty || value.length > 0) && value.length <= 1000 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value); // eslint-disable-line no-control-regex
  if (!body || Object.keys(body).length !== keys.length || !keys.every(key => Object.hasOwn(body, key)) || !text(body.xmlFormId) || !text(body.instanceId) || !text(body.version, true) || !Number.isInteger(body.size) || body.size < 1 || body.size > LIMIT || !/^[a-f0-9]{64}$/.test(body.sha256 ?? '')) throw invalid('Provide a bounded form/version/instance, byte size and SHA-256 manifest.');
  if (edit && (!text(body.deprecatedId) || body.deprecatedId === body.instanceId || !/^[a-f0-9]{64}$/.test(body.baseSha256 ?? ''))) throw invalid('Bind the edit to a different prior instance and its exact SHA-256.');
  return Object.fromEntries(keys.map(key => [key, body[key]]));
};
const attest = (settings, kind, details, edit = false) => {
  const bytes = Buffer.from(JSON.stringify({ ...details, purpose: `field-data.xml-courier-${kind}@${edit ? 2 : 1}`, issuer: settings.origin }));
  return { algorithm: 'ES256', keyId: settings.keyId, publicKey: settings.publicKey, payload: bytes.toString('base64url'), signature: sign('sha256', bytes, { key: settings.key, dsaEncoding: 'ieee-p1363' }).toString('base64url') };
};
const readBytes = async request => {
  if (request.headers['content-type'] !== 'application/octet-stream' || Number(request.headers['content-length']) > LIMIT) throw invalid('Send XML bytes as application/octet-stream, at most 1 MiB.');
  const chunks = []; let size = 0;
  for await (const bytes of request) { size += bytes.length; if (size > LIMIT) throw invalid('XML exceeds 1 MiB.'); chunks.push(bytes); }
  if (!size) throw invalid('XML is empty.'); return Buffer.concat(chunks);
};
const parse = async bytes => {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > LIMIT) throw invalid('Choose XML bytes within 1 MiB.');
  let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw invalid('Use valid UTF-8 XML.'); }
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw invalid('External entities and document types are unsupported.');
  const envelope = new Map(); const fields = new Set(['base64EncryptedKey', 'encryptedXmlFile', 'base64EncryptedElementSignature']);
  let deprecatedCount = 0; let deprecatedId = '';
  const stack = []; let rootInstanceCount = 0; let rootInstance = ''; let metaCount = 0; let instanceCount = 0; let instance = ''; let formId; let version = '';
  try {
    const parser = new SaxesParser();
    parser.on('opentag', node => {
      const local = node.name.split(':').at(-1); stack.push(local);
      if (stack.length === 1) { formId = node.attributes.id; version = node.attributes.version ?? ''; }
      if (stack.length === 2 && local === 'instanceID') rootInstanceCount += 1;
      if (fields.has(local)) {
        if (stack.length !== 2 || envelope.has(local)) throw new Error('Ambiguous encrypted envelope');
        envelope.set(local, '');
      }
      if (stack.length > 2 && (fields.has(stack[1]) || stack[1] === 'instanceID')) throw new Error('Nested envelope value');
      if (stack.length === 2 && local === 'meta') metaCount += 1;
      if (local === 'deprecatedID') { if (stack.length !== 3 || stack[1] !== 'meta') throw new Error('Ambiguous edit'); deprecatedCount += 1; }
      if (stack.length > 3 && stack[1] === 'meta' && ['instanceID', 'deprecatedID'].includes(stack[2])) throw new Error('Ambiguous XML');
      if (stack.length === 3 && stack[1] === 'meta' && local === 'instanceID') instanceCount += 1;
    });
    const append = value => {
      if (stack.length === 3 && stack[1] === 'meta' && stack[2] === 'instanceID') instance += value;
      if (stack.length === 3 && stack[1] === 'meta' && stack[2] === 'deprecatedID') deprecatedId += value;
      if (stack.length === 2 && stack[1] === 'instanceID') rootInstance += value;
      if (stack.length === 2 && fields.has(stack[1])) envelope.set(stack[1], envelope.get(stack[1]) + value);
    };
    parser.on('text', append); parser.on('cdata', append); parser.on('closetag', () => stack.pop());
    parser.write(text).close();
  } catch { throw invalid('Choose well-formed new XML with one unambiguous instanceID.'); }
  const encrypted = envelope.size > 0;
  if (encrypted) {
    const base64 = value => typeof value === 'string' && value.length > 0 && value.length <= 16384 && Buffer.from(value, 'base64').toString('base64') === value;
    const name = envelope.get('encryptedXmlFile');
    if (envelope.size !== 3 || !base64(envelope.get('base64EncryptedKey')) || !base64(envelope.get('base64EncryptedElementSignature')) || typeof name !== 'string' || !name.length || name.length > 255 || name.trim() !== name || /[/\\\u0000-\u001f\u007f]/.test(name)) throw invalid('Provide one complete encrypted envelope with bounded key/signature and ciphertext filename.'); // eslint-disable-line no-control-regex
  }
  if (metaCount > 1 || instanceCount > 1 || rootInstanceCount > (encrypted ? 1 : 0) || instanceCount + rootInstanceCount !== 1 || (instanceCount === 1 && metaCount !== 1)) throw invalid('One unambiguous instanceID is required.');
  instance = instanceCount === 1 ? instance : rootInstance;
  if (!instance.trim()) throw invalid('One instanceID is required.');
  const manifest = manifestFor({ xmlFormId: formId, instanceId: instance.trim(), version, size: bytes.length, sha256: digest(bytes) });
  if (deprecatedCount > 1 || (deprecatedCount && (!deprecatedId.trim() || deprecatedId.trim() === manifest.instanceId || deprecatedId.trim().length > 1000))) throw invalid('Provide one different prior instance for an edit.');
  const partial = await Submission.fromXml(bytes);
  if (partial.deprecatedId.orNull() !== (deprecatedCount ? deprecatedId.trim() : null) || partial.xmlFormId !== manifest.xmlFormId || partial.instanceId !== manifest.instanceId || partial.def.version !== manifest.version) throw invalid('XML identity differs from its native interpretation.');
  if (encrypted && (partial.def.localKey !== envelope.get('base64EncryptedKey') || partial.def.encDataAttachmentName !== envelope.get('encryptedXmlFile') || partial.def.signature !== envelope.get('base64EncryptedElementSignature'))) throw invalid('Envelope metadata differs from its native interpretation.');
  return { partial, manifest, deprecatedId: deprecatedCount ? deprecatedId.trim() : null };
};
const scope = async (tx, ownerId, projectId, manifest, pinned = null) => {
  if (!await account(tx, ownerId, projectId)) throw Problem.user.notFound();
  const form = await tx.db.maybeOne(sql`SELECT f.id,f."acteeId",fd.id AS "formDefId" FROM forms f JOIN form_defs fd ON fd."formId"=f.id AND fd.version=${manifest.version} AND fd."publishedAt" IS NOT NULL
    WHERE f."projectId"=${projectId} AND f."xmlFormId"=${manifest.xmlFormId} AND f."deletedAt" IS NULL AND f.state='open' FOR SHARE OF f,fd`);
  if (!form || (pinned && (pinned.formId !== form.id || pinned.formDefId !== form.formDefId))) throw Problem.user.notFound();
  const grant = await tx.db.maybeOne(sql`SELECT ass."actorId" FROM assignments ass JOIN roles r ON r.id=ass."roleId" WHERE ass."actorId"=${ownerId} AND ass."acteeId"=${form.acteeId} AND r.verbs ? 'submission.create' LIMIT 1 FOR SHARE OF ass,r`);
  if (!grant) throw Problem.user.notFound(); return form;
};
const editBase = async (tx, ownerId, formId, manifest, reviewOnly = false) => {
  if (!manifest.deprecatedId) return null;
  const ref = await tx.db.maybeOne(sql`SELECT sd.id,sd."submissionId" FROM submission_defs sd JOIN submissions s ON s.id=sd."submissionId"
    WHERE s."formId"=${formId} AND s.draft=FALSE AND s."deletedAt" IS NULL AND s."submitterId"=${ownerId} AND sd."submitterId"=${ownerId} AND sd."instanceId"=${manifest.deprecatedId}`);
  if (!ref) throw Problem.user.notFound();
  await tx.db.query(sql`SELECT id FROM field_data_claims WHERE "submissionId"=${ref.submissionId} FOR UPDATE`);
  const base = await tx.db.maybeOne(sql`SELECT sd.*,s."deletedAt",s."submitterId" AS "rootOwnerId" FROM submission_defs sd JOIN submissions s ON s.id=sd."submissionId"
    WHERE sd.id=${ref.id} AND s."deletedAt" IS NULL AND s."submitterId"=${ownerId} AND sd."submitterId"=${ownerId} FOR UPDATE OF s,sd`);
  if (!base) throw Problem.user.notFound();
  const sha256 = digest(base.xml);
  if (!reviewOnly) {
    if (sha256 !== manifest.baseSha256) throw Problem.user.mediaUploadConflict();
    if (!base.current) {
      const received = await tx.db.maybeOne(sql`SELECT sd.* FROM submission_defs sd JOIN field_data_claim_versions cv ON cv."submissionDefId"=sd.id
        JOIN field_data_claim_versions previous ON previous.id=cv."previousVersionId" AND previous."submissionDefId"=${base.id}
        WHERE sd."submissionId"=${base.submissionId} AND sd.current AND sd."submitterId"=${ownerId} AND sd."instanceId"=${manifest.instanceId}`);
      if (!received || digest(received.xml) !== manifest.sha256) throw Problem.user.mediaUploadConflict();
    }
  }
  return { ...base, sha256 };
};
module.exports = { LIMIT, config, digest, invalid, manifestFor, attest, readBytes, parse, scope, account, editBase };
