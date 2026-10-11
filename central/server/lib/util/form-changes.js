// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

// S3: what changed between two versions of a form definition, and what each
// change does to the data collected. Deterministic and computed on request.
// Contract: docs/field-intelligence/S3-version-changes.md

const { readForm } = require('./survey-doctor');

const CHANGES_VERSION = 1;
const LIMITS = { changes: 1000 };

// Strongest first.
const EFFECTS = ['meaning', 'continuity', 'population', 'wording'];
const EFFECT_OF = {
  'type-changed': 'meaning',
  'choice-kind-changed': 'meaning',
  'repeat-changed': 'meaning',
  'calculation-changed': 'meaning',
  'choice-relabelled': 'meaning',
  added: 'continuity',
  removed: 'continuity',
  moved: 'continuity',
  'relevant-changed': 'population',
  'constraint-changed': 'population',
  'required-changed': 'population',
  'readonly-changed': 'population',
  'choices-added': 'population',
  'choices-removed': 'population',
  'choice-source-changed': 'population',
  'label-changed': 'wording'
};

// Columns in the data: questions, calculations, hidden values and repeats.
// Groups only matter through their relevance, which applies to everything in
// them.
const COLUMNS = new Set(['question', 'calculate', 'hidden', 'repeat']);
const nameOf = (path) => path.slice(path.lastIndexOf('/') + 1);
const isMeta = (form, path) => path === `${form.root}/meta` || path.startsWith(`${form.root}/meta/`);

// Whitespace differences are not changes: runs collapse to one space, and a
// space next to anything but a letter or digit goes. Quoted text is kept.
const normalise = (expression) => {
  if (expression == null) return '';
  let out = ''; let quote = null; let space = false;
  for (const c of expression) {
    if (quote != null) { out += c; if (c === quote) quote = null; } else if (/\s/.test(c)) space = true; else {
      if (space && out !== '' && /[\w.]$/.test(out) && /[\w.$]/.test(c)) out += ' ';
      space = false;
      out += c;
      if (c === '"' || c === "'") quote = c;
    }
  }
  return out;
};
const NORMAL_DEFAULTS = { required: 'false()', readonly: 'false()', relevant: 'true()' };
const bindValue = (node, name) => {
  const value = normalise(node.binds[name]);
  return value === NORMAL_DEFAULTS[name] ? '' : value;
};

// A label's text in each language. A plain label has the language ''.
const labelsOf = (form, label) => {
  const out = new Map();
  if (label == null) return out;
  if (label.itextId == null) {
    if (label.text !== '') out.set('', label.text);
    return out;
  }
  for (const [lang, entry] of form.texts.get(label.itextId) ?? new Map())
    if (entry.label !== '' && entry.label !== '-') out.set(lang, entry.label);
  return out;
};
// Pairs of texts to compare: the languages both have, or, when they share none
// (translations added or removed), each version's first.
const labelPairs = (fromLabels, toLabels) => {
  const shared = [...fromLabels.keys()].filter((lang) => toLabels.has(lang));
  if (shared.length > 0) return shared.map((lang) => [lang, fromLabels.get(lang), toLabels.get(lang)]);
  if (fromLabels.size === 0 || toLabels.size === 0) return [];
  const [[fromLang, fromText]] = fromLabels; const [[toLang, toText]] = toLabels;
  return [[fromLang === toLang ? fromLang : `${fromLang || 'default'} → ${toLang || 'default'}`, fromText, toText]];
};

const repeatsAbove = (form, path) => {
  const names = [];
  for (let at = path.slice(0, path.lastIndexOf('/')); at.length > form.root.length; at = at.slice(0, at.lastIndexOf('/'))) {
    if (form.nodes.get(at)?.kind === 'repeat') names.unshift(nameOf(at));
  }
  return names;
};
const typeOf = (node) => (node.kind === 'repeat' ? 'repeat' : node.binds.type ?? 'string');
const KIND_WORDS = { question: 'a question', calculate: 'a calculation', hidden: 'a hidden value', repeat: 'a repeat', group: 'a group' };
const SELECT_TYPES = new Set(['select1', 'select']);

const compareChoices = (from, to, fromNode, toNode, add) => {
  const fromChoices = fromNode.choices; const toChoices = toNode.choices;
  if (fromChoices == null || toChoices == null) return;
  const itemised = (c) => c.kind !== 'external';
  if (fromChoices.kind !== toChoices.kind && (fromChoices.kind !== 'list' || toChoices.kind !== 'list')) {
    add('choice-source-changed', { from: fromChoices.kind, to: toChoices.kind });
  }
  if (!itemised(fromChoices) || !itemised(toChoices)) return;
  const index = (items) => {
    const map = new Map();
    for (const item of items) if (!map.has(item.value)) map.set(item.value, item);
    return map;
  };
  const before = index(fromChoices.items); const after = index(toChoices.items);
  const added = [...after.keys()].filter((v) => !before.has(v));
  const removed = [...before.keys()].filter((v) => !after.has(v));
  if (added.length > 0) add('choices-added', { values: added });
  if (removed.length > 0) add('choices-removed', { values: removed });
  for (const [value, item] of after) {
    if (!before.has(value)) continue; // eslint-disable-line no-continue
    for (const [language, old, now] of labelPairs(labelsOf(from, before.get(value).label), labelsOf(to, item.label)))
      if (old !== now) add('choice-relabelled', { value, language, from: old, to: now });
  }
};

const compareNodes = (from, to, fromNode, toNode, add) => {
  if (toNode.kind === 'group' || fromNode.kind === 'group') {
    // A group is compared only for what applies to the questions in it.
    for (const name of ['relevant', 'readonly']) {
      const old = bindValue(fromNode, name); const now = bindValue(toNode, name);
      if (old !== now) add(`${name}-changed`, { from: old, to: now });
    }
    return;
  }
  if (fromNode.kind !== toNode.kind) {
    add('type-changed', { from: KIND_WORDS[fromNode.kind], to: KIND_WORDS[toNode.kind] });
  } else {
    const old = typeOf(fromNode); const now = typeOf(toNode);
    if (old !== now) add(SELECT_TYPES.has(old) && SELECT_TYPES.has(now) ? 'choice-kind-changed' : 'type-changed', { from: old, to: now });
  }
  const oldRepeats = repeatsAbove(from, fromNode.path); const newRepeats = repeatsAbove(to, toNode.path);
  if (oldRepeats.join('/') !== newRepeats.join('/'))
    add('repeat-changed', { from: oldRepeats.length === 0 ? null : oldRepeats.join(' / '), to: newRepeats.length === 0 ? null : newRepeats.join(' / ') });
  const oldCalc = bindValue(fromNode, 'calculate'); const newCalc = bindValue(toNode, 'calculate');
  if (oldCalc !== newCalc) add('calculation-changed', { from: oldCalc, to: newCalc });
  for (const name of ['relevant', 'constraint', 'required', 'readonly']) {
    const old = bindValue(fromNode, name); const now = bindValue(toNode, name);
    if (old !== now) add(`${name}-changed`, { from: old, to: now });
  }
  compareChoices(from, to, fromNode, toNode, add);
  for (const [language, old, now] of labelPairs(labelsOf(from, fromNode.label), labelsOf(to, toNode.label)))
    if (old !== now) add('label-changed', { language, from: old, to: now });
};

// Both arguments are readForm results.
const compareForms = (from, to) => {
  const comparable = (form) => [...form.nodes.values()]
    .filter((n) => (COLUMNS.has(n.kind) || n.kind === 'group') && n.path !== form.root && !isMeta(form, n.path));
  const fromNodes = comparable(from); const toNodes = comparable(to);
  const fromByPath = new Map(fromNodes.map((n) => [n.path, n]));
  const pairs = new Map(); // to path -> from node
  for (const n of toNodes) if (fromByPath.has(n.path)) pairs.set(n.path, fromByPath.get(n.path));

  // Moved: a column whose name is used once in each version.
  const unique = (nodes) => {
    const counts = new Map();
    for (const n of nodes) if (COLUMNS.has(n.kind)) counts.set(n.name, (counts.get(n.name) ?? 0) + 1);
    return counts;
  };
  const fromCounts = unique(fromNodes); const toCounts = unique(toNodes);
  const matchedFrom = new Set([...pairs.values()].map((n) => n.path));
  const unmatchedFrom = new Map(fromNodes
    .filter((n) => !matchedFrom.has(n.path) && COLUMNS.has(n.kind) && fromCounts.get(n.name) === 1)
    .map((n) => [n.name, n]));
  const moved = new Set();
  for (const n of toNodes) {
    if (pairs.has(n.path) || !COLUMNS.has(n.kind) || toCounts.get(n.name) !== 1) continue; // eslint-disable-line no-continue
    const old = unmatchedFrom.get(n.name);
    if (old != null) { pairs.set(n.path, old); matchedFrom.add(old.path); moved.add(n.path); }
  }

  const changes = [];
  let unchanged = 0;
  for (const n of toNodes) {
    const old = pairs.get(n.path);
    const found = [];
    const add = (code, detail) => found.push({ effect: EFFECT_OF[code], code, path: n.path, fromPath: old?.path ?? null, detail });
    if (old == null) {
      if (COLUMNS.has(n.kind)) add('added', { kind: KIND_WORDS[n.kind] });
    } else {
      if (moved.has(n.path)) add('moved', { from: old.path, to: n.path });
      compareNodes(from, to, old, n, add);
      if (found.length === 0 && COLUMNS.has(n.kind)) unchanged += 1;
    }
    found.sort((a, b) => EFFECTS.indexOf(a.effect) - EFFECTS.indexOf(b.effect));
    changes.push(...found);
  }
  for (const n of fromNodes)
    if (!matchedFrom.has(n.path) && COLUMNS.has(n.kind))
      changes.push({ effect: 'continuity', code: 'removed', path: n.path, fromPath: n.path, detail: { kind: KIND_WORDS[n.kind] } });

  const summary = Object.fromEntries(EFFECTS.map((e) => [e, 0]));
  for (const c of changes) summary[c.effect] += 1;
  summary.unchanged = unchanged;
  return { changesVersion: CHANGES_VERSION, summary, changes: changes.slice(0, LIMITS.changes), truncated: changes.length > LIMITS.changes };
};

const compare = (fromXml, toXml) => compareForms(readForm(fromXml), readForm(toXml));

module.exports = { CHANGES_VERSION, LIMITS, EFFECTS, EFFECT_OF, normalise, compare, compareForms };
