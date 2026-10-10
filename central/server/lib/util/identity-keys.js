// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
//
// Identity reuse (F2): keys a project manager declares per form, naming the
// questions that identify a household, respondent or other unit. A run groups
// submissions by key and reports a key used more often than allowed, or used
// again with answers that should not have changed. Matching is exact after
// normalising; there is no fuzzy matching and no score. Findings carry
// submission IDs and field paths only; answers are read from the submissions
// when a finding is shown.
//
// Contract: docs/field-intelligence/F2-identity-reuse.md

const crypto = require('node:crypto');
const { invalid } = require('./contradiction-rules');

const LIMITS = { keys: 20, fields: 3, sameFields: 10, ignoreValues: 50, benign: 10, maxUses: 1000, windowDays: 3650, listed: 20, submissions: 50000 };
const KEY_TYPES = new Set(['string', 'int', 'barcode']);
const SAME_TYPES = new Set(['string', 'int', 'decimal', 'date', 'barcode']);
const MATCHES = new Set(['exact', 'digits']);
const PATH = /^\/(?:[A-Za-z_][A-Za-z0-9_.-]*\/)*[A-Za-z_][A-Za-z0-9_.-]*$/;
const DEFAULT_IGNORE = ['none', 'n/a', 'na', 'null', 'nil', 'unknown', 'refused', 'no phone', '99', '999', '9999', '-'];
const DAY_MS = 24 * 60 * 60 * 1000;

const REUSED = 'identity-reused:';
const INCONSISTENT = 'identity-inconsistent:';

const text = (value, field, max) => {
  const out = String(value ?? '').trim();
  if (out === '' || out.length > max) throw invalid(field, value, `must be 1–${max} characters`);
  return out;
};
const integer = (value, field, min, max) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw invalid(field, value, `must be a whole number from ${min} to ${max}`);
  return n;
};

////////////////////////////////////////////////////////////////////////////////
// NORMALISING

// exact: case, surrounding and repeated spaces do not matter. digits: only the
// digits do, so "076 123-456" and "076123456" are the same phone number.
const normalizers = {
  exact: (raw) => String(raw).normalize('NFC').trim()
    .replace(/\s+/g, ' ')
    .toLowerCase(),
  digits: (raw) => String(raw).replace(/[^0-9]/g, '')
};
// A value of one character repeated ("0000000", "xxxx") is a placeholder.
const repeatedCharacter = (value) => value.length > 1 && /^(.)\1+$/su.test(value);

////////////////////////////////////////////////////////////////////////////////
// VALIDATION

// Questions a key may use: top level (not in a repeat), not media or
// locations, and not the form's own metadata, whose instance ID is unique by
// construction.
const topLevel = (fields) => {
  const repeats = fields.filter((f) => f.type === 'repeat').map((f) => f.path);
  return new Map(fields
    .filter((f) => f.binary !== true && PATH.test(f.path) && !f.path.startsWith('/meta/')
      && !repeats.some((r) => f.path.startsWith(`${r}/`)))
    .map((f) => [f.path, f]));
};

const lookup = (shape, path, at, missing, allowed, kind) => {
  const found = shape.get(String(path ?? ''));
  if (found == null) {
    if (missing != null) { missing.add(String(path)); return null; }
    throw invalid(at, path, 'must name a top-level question in the current form definition');
  }
  if (!allowed.has(found.type) || (kind === 'key' && found.selectMultiple === true))
    throw invalid(at, path, kind === 'key'
      ? 'must be a text, number, barcode or single-choice question'
      : 'must be a text, number, date, barcode or choice question');
  return found;
};

const shapeOfKey = (body, shape, missing) => {
  if (!Array.isArray(body?.fields) || body.fields.length === 0 || body.fields.length > LIMITS.fields)
    throw invalid('fields', body?.fields, `give 1–${LIMITS.fields} questions`);
  const fields = body.fields.map((input, i) => {
    const match = String(input?.match ?? 'exact');
    if (!MATCHES.has(match)) throw invalid(`fields[${i}].match`, match, 'must be exact or digits');
    const found = lookup(shape, input?.field, `fields[${i}].field`, missing, KEY_TYPES, 'key');
    return { field: found?.path ?? String(input?.field), match };
  });
  if (new Set(fields.map((f) => f.field)).size !== fields.length)
    throw invalid('fields', body.fields, 'each question can be used once');

  const same = body.sameFields ?? [];
  if (!Array.isArray(same) || same.length > LIMITS.sameFields)
    throw invalid('sameFields', same, `give at most ${LIMITS.sameFields} questions`);
  const sameFields = same.map((path, i) => lookup(shape, path, `sameFields[${i}]`, missing, SAME_TYPES, 'same')?.path ?? String(path));
  if (new Set(sameFields).size !== sameFields.length) throw invalid('sameFields', same, 'each question can be used once');
  if (sameFields.some((p) => fields.some((f) => f.field === p)))
    throw invalid('sameFields', same, 'a question in the key cannot also be one that should stay the same');
  return { fields, sameFields };
};

// What a key matches on. A change here is a new version; texts are not.
const matching = (body) => {
  const ignore = body.ignoreValues ?? DEFAULT_IGNORE;
  if (!Array.isArray(ignore) || ignore.length > LIMITS.ignoreValues)
    throw invalid('ignoreValues', ignore, `give at most ${LIMITS.ignoreValues} values`);
  return {
    maxUses: body.maxUses == null ? 1 : integer(body.maxUses, 'maxUses', 1, LIMITS.maxUses),
    windowDays: body.windowDays == null ? null : integer(body.windowDays, 'windowDays', 1, LIMITS.windowDays),
    ignoreValues: [...new Set(ignore.map((v, i) => normalizers.exact(text(v, `ignoreValues[${i}]`, 100))))],
    minLength: body.minLength == null ? 3 : integer(body.minLength, 'minLength', 1, 50)
  };
};

const definitionHash = (definition) => crypto.createHash('sha256').update(JSON.stringify(definition)).digest('hex');

// A key as written by a manager, checked against the form as it is now.
const normalizeKey = (body, fields) => {
  const { fields: keyFields, sameFields } = shapeOfKey(body, topLevel(fields), null);
  const benign = body.benignExplanations;
  if (!Array.isArray(benign) || benign.length === 0 || benign.length > LIMITS.benign)
    throw invalid('benignExplanations', benign, `give 1–${LIMITS.benign} ordinary reasons the same key could appear again`);
  const definition = { fields: keyFields, sameFields, ...matching(body) };
  return {
    title: text(body.title, 'title', 120),
    explanation: text(body.explanation, 'explanation', 2000),
    benignExplanations: benign.map((b, i) => text(b, `benignExplanations[${i}]`, 500)),
    nextStep: text(body.nextStep, 'nextStep', 1000),
    active: body.active !== false,
    definition,
    definitionHash: definitionHash(definition)
  };
};

// Whether a stored key can still run against the current form. A key is never
// run with a question silently dropped.
const usability = (definition, fields) => {
  const missing = new Set();
  try {
    shapeOfKey(definition, topLevel(fields), missing);
  } catch (error) {
    return { usable: false, reason: 'changed', detail: error.reason ?? error.message, missing: [...missing] };
  }
  return missing.size > 0 ? { usable: false, reason: 'missing-fields', missing: [...missing] } : { usable: true };
};

////////////////////////////////////////////////////////////////////////////////
// KEYS FROM ANSWERS

// `answer(path)` gives a submission's raw answer or null. Returns the
// normalised key, or null when any part is blank, a placeholder or the whole
// key is too short.
const keyOf = (definition, answer) => {
  const parts = [];
  for (const { field, match } of definition.fields) {
    const raw = answer(field);
    if (raw == null) return null;
    const value = normalizers[match](raw);
    const ignored = definition.ignoreValues.some((v) => normalizers[match](v) === value);
    if (value === '' || ignored || repeatedCharacter(value)) return null;
    parts.push(value);
  }
  return parts.join('').length < definition.minLength ? null : JSON.stringify(parts);
};

// How an answer compares for "should stay the same": as in exact keys, and for
// a select-multiple question the same choices in any order are the same.
const sameValue = (raw, multiple) => {
  const value = normalizers.exact(raw);
  return multiple ? value.split(' ').sort().join(' ') : value;
};

////////////////////////////////////////////////////////////////////////////////
// FINDINGS
//
// `submissions`: [{ instanceId, receivedAt (Date), submitter, answer(path) }],
// in the order received; `multiple`: paths of select-multiple questions.
// Returns findings without answers in them, and counts.

const findIdentityIssues = (key, submissions, multiple = new Set()) => {
  const { definition } = key;
  const groups = new Map();
  let noKey = 0;
  for (const submission of submissions) {
    const value = keyOf(definition, submission.answer);
    if (value == null) noKey += 1;
    else if (groups.has(value)) groups.get(value).push(submission);
    else groups.set(value, [submission]);
  }

  const brief = (s) => ({ instanceId: s.instanceId, receivedAt: s.receivedAt.toISOString(), submitter: s.submitter ?? null });
  const common = { keyId: key.id, title: key.title, explanation: key.explanation, alternatives: key.benignExplanations, nextStep: key.nextStep, fields: definition.fields.map((f) => f.field) };
  const findings = [];
  let reused = 0; let inconsistent = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue; // eslint-disable-line no-continue
    for (let i = 1; i < group.length; i += 1) {
      const submission = group[i];
      const earlier = group.slice(0, i).filter((other) => definition.windowDays == null
        || submission.receivedAt - other.receivedAt <= definition.windowDays * DAY_MS);
      if (earlier.length >= definition.maxUses) {
        reused += 1;
        findings.push({
          rule: `${REUSED}${key.id}`, ruleVersion: key.version, instanceId: submission.instanceId,
          relatedInstanceId: earlier[0].instanceId, outcome: 'concern',
          evidence: {
            ...common, kind: 'reused', sharedBy: group.length, earlierInWindow: earlier.length,
            maxUses: definition.maxUses, windowDays: definition.windowDays,
            submission: brief(submission), others: group.filter((s) => s !== submission).slice(0, LIMITS.listed).map(brief)
          }
        });
      }

      const first = group[0];
      const differing = definition.sameFields.filter((path) => {
        const a = first.answer(path); const b = submission.answer(path);
        return a != null && b != null && sameValue(a, multiple.has(path)) !== sameValue(b, multiple.has(path));
      });
      if (differing.length > 0) {
        inconsistent += 1;
        findings.push({
          rule: `${INCONSISTENT}${key.id}`, ruleVersion: key.version, instanceId: submission.instanceId,
          relatedInstanceId: first.instanceId, outcome: 'concern',
          evidence: { ...common, kind: 'inconsistent', differing, submission: brief(submission), others: [brief(first)] }
        });
      }
    }
  }
  return {
    findings,
    counts: { examined: submissions.length, noKey, distinct: groups.size, reused, inconsistent }
  };
};

module.exports = {
  LIMITS, DEFAULT_IGNORE, REUSED, INCONSISTENT,
  normalizeKey, usability, definitionHash, keyOf, sameValue, findIdentityIssues
};
