// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
//
// Answer contradictions (F1): rules a project manager writes per form, saying
// which answers should not occur together. A rule is a list of conditions that
// must all hold. Nothing here decides anything; a match becomes a finding for a
// reviewer, shown with the answers behind it and the author's own benign
// explanations.
//
// Contract: docs/field-intelligence/F1-answer-contradictions.md

const crypto = require('node:crypto');
const hparser = require('htmlparser2');

const LIMITS = { rules: 50, conditions: 10, where: 5, benign: 10 };
const NUMERIC = new Set(['int', 'decimal']);
const COMPARE = new Set(['=', '<>', '>', '<', '>=', '<=']);
const ORDERING = new Set(['>', '<', '>=', '<=']);
const PRESENCE = new Set(['empty', 'notEmpty']);
const SELECTION = new Set(['selected', 'notSelected']);
const OPERATORS = new Set([...COMPARE, ...PRESENCE, ...SELECTION]);
const PATH = /^\/(?:[A-Za-z_][A-Za-z0-9_.-]*\/)*[A-Za-z_][A-Za-z0-9_.-]*$/;
const NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

const invalid = (field, value, reason) => Object.assign(new Error(reason), { field, value, reason });
const text = (value, field, max) => {
  const out = String(value ?? '').trim();
  if (out === '' || out.length > max) throw invalid(field, value, `must be 1–${max} characters`);
  return out;
};

////////////////////////////////////////////////////////////////////////////////
// FORM SHAPE

// The repeats a path sits inside, innermost last.
const repeatsOf = (path, repeats) => repeats.filter((r) => path.startsWith(`${r}/`));

const shapeOf = (fields) => {
  const repeats = fields.filter((f) => f.type === 'repeat').map((f) => f.path);
  const byPath = new Map(fields
    .filter((f) => f.binary !== true && !['structure', 'repeat'].includes(f.type) && PATH.test(f.path))
    .map((f) => [f.path, { path: f.path, name: f.name, type: f.type, selectMultiple: f.selectMultiple === true, repeats: repeatsOf(f.path, repeats) }]));
  return { byPath, repeats: new Set(repeats), allRepeats: repeats };
};

////////////////////////////////////////////////////////////////////////////////
// VALIDATION
//
// A condition is checked against the current form. `scope` is the repeat a
// condition is evaluated inside (null at the top level): its fields must sit
// directly in that repeat, not in a nested one, so each has one value per entry.

// The right-hand side of a comparison: a fixed value or another question of the
// same kind in the same scope.
const compareTarget = (input, where, op, subject, shape, scope, missing, field) => {
  const numeric = NUMERIC.has(subject.type);
  if (ORDERING.has(op) && !numeric) throw invalid(`${where}.op`, op, 'orders only number questions');
  if (subject.selectMultiple) throw invalid(`${where}.op`, op, 'select-multiple questions use selected or notSelected');
  const hasValue = input.value != null; const hasOther = input.otherField != null;
  if (hasValue === hasOther) throw invalid(where, input, 'give either a value or another question to compare with');
  if (hasValue) {
    if (typeof input.value === 'object') throw invalid(`${where}.value`, input.value, 'must be a single value');
    const value = String(input.value).trim();
    if (value.length > 500) throw invalid(`${where}.value`, value, 'must be at most 500 characters');
    if (numeric && !NUMBER.test(value)) throw invalid(`${where}.value`, value, 'must be a number');
    return { value };
  }
  const other = field(input.otherField, `${where}.otherField`);
  if (other == null) return {};
  if (NUMERIC.has(other.type) !== numeric || other.selectMultiple)
    throw invalid(`${where}.otherField`, input.otherField, 'must be the same kind of answer (number or text)');
  return { otherField: other.path };
};

const normalizeCondition = (input, shape, where, scope, missing) => {
  if (input == null || typeof input !== 'object') throw invalid(where, input, 'must be a condition');
  const op = String(input.op ?? '');
  if (!OPERATORS.has(op)) throw invalid(`${where}.op`, op, `must be one of ${[...OPERATORS].join(', ')}`);

  const field = (path, at) => {
    const found = shape.byPath.get(String(path ?? ''));
    if (found == null) {
      if (missing != null) { missing.add(String(path)); return null; }
      throw invalid(at, path, 'must name a question in the current form definition');
    }
    const inner = found.repeats.at(-1) ?? null;
    if (inner !== scope)
      throw invalid(at, path, scope == null
        ? 'is inside a repeat; count it with a repeat condition instead'
        : 'must be directly inside the counted repeat');
    return found;
  };

  if (input.count != null) {
    if (scope != null) throw invalid(`${where}.count`, input.count, 'cannot be nested inside another count');
    if (!COMPARE.has(op)) throw invalid(`${where}.op`, op, 'a count is compared with =, <>, >, <, >= or <=');
    const repeat = String(input.count.repeat ?? '');
    if (!shape.repeats.has(repeat)) {
      if (missing != null) { missing.add(repeat); return null; }
      throw invalid(`${where}.count.repeat`, repeat, 'must name a repeat in the current form definition');
    }
    if (repeatsOf(repeat, shape.allRepeats).length > 0)
      throw invalid(`${where}.count.repeat`, repeat, 'repeats inside other repeats cannot be counted');
    const givenWhere = input.count.where ?? [];
    if (!Array.isArray(givenWhere) || givenWhere.length > LIMITS.where)
      throw invalid(`${where}.count.where`, givenWhere, `must be a list of at most ${LIMITS.where} conditions`);
    const whereList = givenWhere.map((c, i) => normalizeCondition(c, shape, `${where}.count.where[${i}]`, repeat, missing));
    const other = compareTarget(input, `${where}`, op, { type: 'int', selectMultiple: false }, shape, null, missing, field);
    return { count: { repeat, where: whereList }, op, ...other };
  }

  const subject = field(input.field, `${where}.field`);
  if (subject == null) return null;
  if (PRESENCE.has(op)) {
    if (input.value != null || input.otherField != null) throw invalid(where, input, `${op} takes no value`);
    return { field: subject.path, op };
  }
  if (SELECTION.has(op)) {
    if (!subject.selectMultiple) throw invalid(`${where}.op`, op, 'is only for select-multiple questions');
    if (input.otherField != null) throw invalid(`${where}.otherField`, input.otherField, `${op} compares with a choice name`);
    const value = text(input.value, `${where}.value`, 200);
    if (/\s/.test(value)) throw invalid(`${where}.value`, value, 'must be a single choice name');
    return { field: subject.path, op, value };
  }
  return { field: subject.path, op, ...compareTarget(input, where, op, subject, shape, scope, missing, field) };
};

const conditionsHash = (conditions) => crypto.createHash('sha256').update(JSON.stringify(conditions)).digest('hex');

// A rule as written by a manager, checked against the form as it is now.
const normalizeRule = (body, fields) => {
  const shape = shapeOf(fields);
  if (!Array.isArray(body?.conditions) || body.conditions.length === 0 || body.conditions.length > LIMITS.conditions)
    throw invalid('conditions', body?.conditions, `give 1–${LIMITS.conditions} conditions`);
  const conditions = body.conditions.map((c, i) => normalizeCondition(c, shape, `conditions[${i}]`, null, null));
  const benign = body.benignExplanations;
  if (!Array.isArray(benign) || benign.length === 0 || benign.length > LIMITS.benign)
    throw invalid('benignExplanations', benign, `give 1–${LIMITS.benign} ordinary reasons the answers could both be true`);
  return {
    title: text(body.title, 'title', 120),
    explanation: text(body.explanation, 'explanation', 2000),
    benignExplanations: benign.map((b, i) => text(b, `benignExplanations[${i}]`, 500)),
    nextStep: text(body.nextStep, 'nextStep', 1000),
    active: body.active !== false,
    conditions,
    conditionsHash: conditionsHash(conditions)
  };
};

// Whether a stored rule can still run against the current form. A rule is never
// run with a condition silently dropped, so anything missing makes it unusable.
const usability = (conditions, fields) => {
  const shape = shapeOf(fields); const missing = new Set();
  try {
    conditions.forEach((c, i) => normalizeCondition(c, shape, `conditions[${i}]`, null, missing));
  } catch (error) {
    return { usable: false, reason: 'changed', detail: error.reason ?? error.message, missing: [...missing] };
  }
  return missing.size > 0 ? { usable: false, reason: 'missing-fields', missing: [...missing] } : { usable: true };
};

////////////////////////////////////////////////////////////////////////////////
// SUBMISSION XML

// A small element tree: { name, text, children }. Namespaces are dropped from
// element names, as submission paths are written without them.
const parseInstance = (xml) => {
  const root = { name: null, text: '', children: [] };
  const stack = [root];
  const parser = new hparser.Parser({
    onopentag: (name) => {
      const node = { name: name.replace(/^[^:]+:/, ''), text: '', children: [] };
      stack.at(-1).children.push(node); stack.push(node);
    },
    ontext: (t) => { stack.at(-1).text += t; },
    onclosetag: () => { stack.pop(); }
  }, { xmlMode: true, decodeEntities: true });
  parser.write(xml); parser.end();
  return root.children[0] ?? { name: null, text: '', children: [] };
};

// Every node at a path (relative segments) beneath a node.
const nodesAt = (node, segments) => segments.reduce(
  (nodes, segment) => nodes.flatMap((n) => n.children.filter((c) => c.name === segment)),
  [node]
);
const relative = (path, scope) => (scope == null ? path : path.slice(scope.length)).split('/').filter(Boolean);
const answerAt = (node, path, scope) => {
  const found = nodesAt(node, relative(path, scope))[0];
  const value = found == null ? '' : found.text.trim();
  return value === '' ? null : value;
};

////////////////////////////////////////////////////////////////////////////////
// EVALUATION
//
// Three-valued: true, false, or null when an answer needed is missing or
// unreadable. A rule matches when every condition is true; any false condition
// settles it as no match; otherwise it could not be evaluated.

const compare = (op, a, b) => {
  switch (op) {
    case '=': return a === b;
    case '<>': return a !== b;
    case '>': return a > b;
    case '<': return a < b;
    case '>=': return a >= b;
    case '<=': return a <= b;
    default: return null;
  }
};
const asNumber = (raw) => (raw != null && NUMBER.test(raw) ? Number(raw) : null);

const evaluateCondition = (condition, node, types, scope) => {
  if (condition.count != null) {
    const entries = nodesAt(node, relative(condition.count.repeat, null));
    let count = 0; let unknown = false;
    for (const entry of entries) {
      const results = condition.count.where.map((c) => evaluateCondition(c, entry, types, condition.count.repeat).result);
      if (results.every((r) => r === true)) count += 1;
      else if (!results.includes(false)) unknown = true;
    }
    const right = condition.otherField != null ? asNumber(answerAt(node, condition.otherField, scope)) : Number(condition.value);
    // `counted`, not `count`: the condition's own `count` (repeat and filter) is kept beside it.
    const shown = { counted: count, repeat: condition.count.repeat, compareWith: condition.otherField ?? condition.value, compareAnswer: condition.otherField != null ? answerAt(node, condition.otherField, scope) : null };
    if (unknown || right == null) return { result: null, shown };
    return { result: compare(condition.op, count, right), shown };
  }

  const raw = answerAt(node, condition.field, scope);
  const shown = { field: condition.field, answer: raw };
  if (condition.op === 'empty') return { result: raw == null, shown };
  if (condition.op === 'notEmpty') return { result: raw != null, shown };
  if (raw == null) return { result: null, shown };
  if (condition.op === 'selected' || condition.op === 'notSelected') {
    const chosen = raw.split(/\s+/).includes(condition.value);
    return { result: condition.op === 'selected' ? chosen : !chosen, shown };
  }
  const numeric = NUMERIC.has(types.get(condition.field));
  const otherRaw = condition.otherField != null ? answerAt(node, condition.otherField, scope) : condition.value;
  if (condition.otherField != null) shown.compareAnswer = otherRaw;
  if (otherRaw == null) return { result: null, shown };
  const a = numeric ? asNumber(raw) : raw; const b = numeric ? asNumber(otherRaw) : otherRaw;
  if (a == null || b == null) return { result: null, shown };
  return { result: compare(condition.op, a, b), shown };
};

// The outcome of one rule on one submission's XML.
const evaluateRule = (conditions, instance, fields) => {
  const types = new Map(fields.map((f) => [f.path, f.type]));
  const evaluated = conditions.map((c) => ({ condition: c, ...evaluateCondition(c, instance, types, null) }));
  const results = evaluated.map((e) => e.result);
  const outcome = results.every((r) => r === true) ? 'match'
    : results.includes(false) ? 'no-match' : 'not-evaluated';
  return { outcome, conditions: evaluated.map(({ condition, shown }) => ({ ...condition, ...shown })) };
};

const RULE_PREFIX = 'contradiction:';

module.exports = {
  LIMITS, RULE_PREFIX, normalizeRule, usability, conditionsHash, parseInstance, evaluateRule, invalid
};
