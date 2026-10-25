// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { createHash } = require('node:crypto');
const { activeRules } = require('../resources/field-data-export-recodes');
const Problem = require('./problem');
const invalid = reason => Problem.user.recodeInvalid({ field: 'valueRecodes', reason });
const prepare = async (db, auth, form, draft, query, rootOnly = false) => {
  if (query.valueRecodes == null || query.valueRecodes === 'false') return null;
  if (query.valueRecodes !== 'true') throw invalid('Use true or false.');
  await auth.canOrReject('form.read', form);
  if (rootOnly || draft || form.def.keyId != null || String(query.splitSelectMultiples).toLowerCase() === 'true') throw invalid('Use a published unencrypted CSV ZIP with combined select-multiple values. Plain CSV and split columns are not supported.');
  const rules = await activeRules(db, [form.id]);
  if (rules.length > 200 || Buffer.byteLength(JSON.stringify(rules)) > 200 * 1024) throw invalid('The active rules exceed the native export limit. Retire unnecessary rules or export stored answers.');
  const keys = new Set();
  for (const rule of rules) {
    if (!['value', 'path'].includes(rule.kind) || typeof rule.path !== 'string' || !Array.isArray(rule.versions) || rule.versions.length > 50 || rule.versions.some(version => typeof version !== 'string') ||
      (rule.kind === 'value' && (!rule.values || typeof rule.values !== 'object' || Array.isArray(rule.values) || Object.keys(rule.values).length > 200 || Object.values(rule.values).some(value => typeof value !== 'string' || value.length > 200)))) throw invalid('An active rule is invalid. Review the rules before export.');
    if (rule.kind === 'value') for (const version of rule.versions) {
      const key = `${version}\n${rule.path}`;
      if (keys.has(key)) throw invalid('Ambiguous value rules share a version and field. Review the rules before export.');
      keys.add(key);
    }
  }
  const source = { xmlFormId: form.xmlFormId, definitionId: form.def.id, version: form.def.version, groupPaths: String(query.groupPaths).toLowerCase() !== 'false', deletedFields: String(query.deletedFields).toLowerCase() === 'true', attachments: String(query.attachments).toLowerCase() !== 'false', filtered: query.$filter != null };
  return { source, rules, fingerprint: createHash('sha256').update(JSON.stringify({ source, filter: query.$filter ?? null, rules })).digest('hex') };
};
const compile = (snapshot, fields) => {
  if (!snapshot) return null;
  const byPath = new Map(fields.map(field => [field.path, field]));
  const applied = []; const skipped = [];
  for (const rule of snapshot.rules) {
    const field = byPath.get(rule.path);
    const reason = rule.kind !== 'value' ? 'moved-question rule unsupported'
      : !field || ['repeat', 'structure', 'geopoint', 'geotrace', 'geoshape'].includes(field.type) || field.binary ? 'field unavailable or unsupported' : null;
    if (reason) skipped.push({ id: rule.id, kind: rule.kind, path: rule.path, reason });
    else applied.push(rule);
  }
  const lookup = new Map();
  for (const rule of applied) for (const version of rule.versions) lookup.set(`${version}\n${rule.path}`, rule.values);
  return { manifest: { method: 'native-csv-value-recodes@1', source: snapshot.source, fingerprint: snapshot.fingerprint, appliedRules: applied, skippedRules: skipped,
    limitations: 'Version-bound value rules only. Existing native filters run before recoding. No moved questions, geometry, binary fields or OData recoding. Rule lists describe scope, not a count of changed answers.' },
  value: (field, version, value) => {
    const mapping = lookup.get(`${version}\n${field.path}`);
    if (!mapping || typeof value !== 'string' || value === '') return value;
    const recode = token => (Object.hasOwn(mapping, token) ? mapping[token] : token);
    return field.selectMultiple ? value.split(/\s+/).map(recode).join(' ') : recode(value);
  } };
};
const etag = (base, snapshot) => (snapshot ? createHash('sha256').update(`${base}\n${snapshot.fingerprint}`).digest('hex') : base);
module.exports = { prepare, compile, etag };
