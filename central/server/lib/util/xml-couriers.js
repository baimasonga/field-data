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
  const text = (value, empty = false) => typeof value === 'string' && (empty || value.length > 0) && value.length <= 1000 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value); // eslint-disable-line no-control-regex
  if (!body || Object.keys(body).length !== keys.length || !keys.every(key => Object.hasOwn(body, key)) || !text(body.xmlFormId) || !text(body.instanceId) || !text(body.version, true) || !Number.isInteger(body.size) || body.size < 1 || body.size > LIMIT || !/^[a-f0-9]{64}$/.test(body.sha256 ?? '')) throw invalid('Provide a bounded form/version/instance, byte size and SHA-256 manifest.');
  return Object.fromEntries(keys.map(key => [key, body[key]]));
};
const attest = (settings, kind, details) => {
  const bytes = Buffer.from(JSON.stringify({ ...details, purpose: `field-data.xml-courier-${kind}@1`, issuer: settings.origin }));
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
  const stack = []; let metaCount = 0; let instanceCount = 0; let instance = ''; let formId; let version = '';
  try {
    const parser = new SaxesParser();
    parser.on('opentag', node => {
      const local = node.name.split(':').at(-1); stack.push(local);
      if (stack.length === 1) { formId = node.attributes.id; version = node.attributes.version ?? ''; }
      if (stack.length === 2 && local === 'meta') metaCount += 1;
      if (local === 'deprecatedID' || (stack.length > 3 && stack[1] === 'meta' && stack[2] === 'instanceID')) throw new Error('Edited or ambiguous XML');
      if (stack.length === 3 && stack[1] === 'meta' && local === 'instanceID') instanceCount += 1;
    });
    const append = value => { if (stack.length === 3 && stack[1] === 'meta' && stack[2] === 'instanceID') instance += value; };
    parser.on('text', append); parser.on('cdata', append); parser.on('closetag', () => stack.pop());
    parser.write(text).close();
  } catch { throw invalid('Choose well-formed new XML with one meta/instanceID.'); }
  if (metaCount !== 1 || instanceCount !== 1 || !instance.trim()) throw invalid('One meta/instanceID is required.');
  const manifest = manifestFor({ xmlFormId: formId, instanceId: instance.trim(), version, size: bytes.length, sha256: digest(bytes) });
  const partial = await Submission.fromXml(bytes);
  if (partial.deprecatedId.isDefined() || partial.def.localKey != null || partial.xmlFormId !== manifest.xmlFormId || partial.instanceId !== manifest.instanceId || partial.def.version !== manifest.version) throw invalid('XML identity differs from its native interpretation, or the envelope is encrypted.');
  return { partial, manifest };
};
const scope = async (tx, ownerId, projectId, manifest, pinned = null) => {
  if (!await account(tx, ownerId, projectId)) throw Problem.user.notFound();
  const form = await tx.db.maybeOne(sql`SELECT f.id,f."acteeId",fd.id AS "formDefId" FROM forms f JOIN form_defs fd ON fd."formId"=f.id AND fd.version=${manifest.version} AND fd."publishedAt" IS NOT NULL
    WHERE f."projectId"=${projectId} AND f."xmlFormId"=${manifest.xmlFormId} AND f."deletedAt" IS NULL AND f.state='open' FOR SHARE OF f,fd`);
  if (!form || (pinned && (pinned.formId !== form.id || pinned.formDefId !== form.formDefId))) throw Problem.user.notFound();
  const grant = await tx.db.maybeOne(sql`SELECT ass."actorId" FROM assignments ass JOIN roles r ON r.id=ass."roleId" WHERE ass."actorId"=${ownerId} AND ass."acteeId"=${form.acteeId} AND r.verbs ? 'submission.create' LIMIT 1 FOR SHARE OF ass,r`);
  if (!grant) throw Problem.user.notFound(); return form;
};
module.exports = { LIMIT, config, digest, invalid, manifestFor, attest, readBytes, parse, scope, account };
