// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
//
// Reproducible interview simulation (S2): runs a form's own logic over many
// seeded, simulated interviews and reports which questions were shown, which
// were never reached, which constraints no simulated answer met, and how long
// interviews were. Evidence, not proof: the survey doctor (S1) proves.
//
// Contract: docs/field-intelligence/S2-survey-simulation.md

const { createHash, randomBytes } = require('crypto');
const { parse } = require('./xpath-reader');
const { evaluate, toStr, toBool, Unsupported } = require('./xpath-eval');
const { readForm, allowed, referencesOf } = require('./survey-doctor');

const SIMULATOR_VERSION = 1;
const LIMITS = { runs: 1000, defaultRuns: 200, visits: 2000000, tries: 20 };
const BLANK_RATE = 0.1;
const NOW = new Date('2026-01-01T00:00:00Z');
const SEED_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const NOT_ANSWERED = new Set(['trigger']);

const newSeed = () => randomBytes(8).toString('hex');

// sfc32, seeded from a hash of the seed text: the same seed, the same sequence.
const generator = (seed) => {
  const h = createHash('sha256').update(String(seed)).digest();
  let a = h.readUInt32LE(0); let b = h.readUInt32LE(4); let c = h.readUInt32LE(8); let d = h.readUInt32LE(12);
  return () => {
    /* eslint-disable no-bitwise */
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
    /* eslint-enable no-bitwise */
  };
};

const STRINGS = ['Simulated', 'A', '1', '12345', 'abc123', 'someone@example.org', '+23276123456', 'AB-1234', '0', 'yes', '3'];

// A number inside one of the intervals a constraint allows (from S1's
// reading of it), or null when there is none to aim at.
const aimed = (ranges, integer, random) => {
  if (ranges == null || ranges.length === 0) return null;
  const r = ranges[Math.floor(random() * ranges.length)];
  let lo = r.lo === -Infinity ? (r.hi === Infinity ? 0 : r.hi - 100) : r.lo;
  let hi = r.hi === Infinity ? lo + 100 : r.hi;
  if (integer) {
    lo = r.loOpen && Number.isInteger(lo) ? lo + 1 : Math.ceil(lo);
    hi = r.hiOpen && Number.isInteger(hi) ? hi - 1 : Math.floor(hi);
    return lo > hi ? null : lo + Math.floor(random() * (hi - lo + 1));
  }
  const v = Math.round((lo + random() * (hi - lo)) * 100) / 100;
  return (v === r.lo && r.loOpen) || (v === r.hi && r.hiOpen) ? (lo + hi) / 2 : v;
};

// The answer a simulated respondent gives on the `attempt`th try. Numbers
// alternate between the constraint's own ranges and widening blind ranges.
const candidate = (node, attempt, random, { ranges = null, peers = [], literals = [], targets = [] } = {}) => {
  const int = (lo, hi) => lo + Math.floor(random() * (hi - lo + 1));
  const pick = (list) => list[Math.floor(random() * list.length)];
  if (node.control === 'select1' || node.control === 'select' || node.control === 'rank') {
    const items = node.choices?.kind === 'external' ? [] : (node.choices?.items ?? []).map((i) => i.value).filter((v) => v !== '');
    if (items.length === 0) return 'simulated';
    if (node.control === 'select1') return pick(items);
    // A random number of choices, then which ones.
    const rest = [...items]; const chosen = [];
    for (let k = 1 + Math.floor(random() * items.length); k > 0; k -= 1)
      chosen.push(...rest.splice(Math.floor(random() * rest.length), 1));
    return items.filter((i) => chosen.includes(i)).join(' ');
  }
  if (node.control === 'range') return String(int(0, 10));
  if (node.control === 'upload') return 'simulated.jpg';
  const type = (node.binds.type ?? 'string').replace(/^[^:]+:/, '');
  // Some tries repeat an earlier answer of the same type, as constraints often
  // compare with one (an end date not before the start date).
  if (peers.length > 0 && attempt % 4 === 3) return pick(peers);
  if ((type === 'int' || type === 'decimal') && (attempt === 1 || attempt === 5)) return attempt === 1 ? '0' : '1';
  const span = attempt < 5 ? [0, 10] : attempt < 10 ? [0, 100] : attempt < 15 ? [-1000, 1000] : [0, 100000];
  // Half the time, a value the form compares this question with.
  if (targets.length > 0 && random() < 0.5) return pick(targets);
  if (['int', 'decimal', 'string'].includes(type) && attempt % 2 === 0) {
    const v = aimed(ranges, type !== 'decimal', random);
    if (v != null) return String(v);
  }
  switch (type) {
    case 'int': return String(int(...span));
    case 'decimal': return String(Math.round((span[0] + random() * (span[1] - span[0])) * 100) / 100);
    case 'date': case 'dateTime': {
      const back = attempt < 10 ? int(0, 365) : attempt < 15 ? int(0, 3650) : -int(1, 365);
      const day = new Date(NOW.getTime() - back * DAY_MS).toISOString().slice(0, 10);
      return type === 'date' ? day : `${day}T10:00:00.000Z`;
    }
    case 'time': return `${String(int(6, 20)).padStart(2, '0')}:${String(int(0, 59)).padStart(2, '0')}:00.000`;
    case 'geopoint': return `8.4801 -13.2344 0 ${pick([0, 3, 5, 12, 25])}`;
    case 'geotrace': return '8.48 -13.23 0 5;8.49 -13.24 0 5';
    case 'geoshape': return '8.48 -13.23 0 5;8.49 -13.24 0 5;8.48 -13.25 0 5;8.48 -13.23 0 5';
    case 'binary': return 'simulated.jpg';
    case 'barcode': return 'SIM-0001';
    case 'boolean': return attempt % 2 === 0 ? 'true' : 'false';
    default:
      // A varied first answer (text questions are sometimes compared as numbers),
      // then each of the others in turn, then numbers of growing length.
      if (attempt === 0 || (attempt % 4 === 1 && literals.length > 0)) return pick(attempt === 0 ? [...STRINGS, ...literals] : literals);
      return attempt < STRINGS.length ? STRINGS[attempt] : String(int(0, 10 ** (1 + (attempt % 11))));
  }
};

// Ranges to aim numbers at: S1's reading of the constraint, or, when part of
// an 'and' cannot be read, of the parts that can. Only a guide for choosing
// answers; the constraint itself still decides.
const hint = (tree) => {
  const exact = allowed(tree);
  if (exact != null || tree.type !== 'and') return exact;
  return hint(tree.left) ?? hint(tree.right);
};

const typeOf = (node) => (['select1', 'select', 'rank'].includes(node.control) ? `select:${node.path}` : (node.binds.type ?? 'string').replace(/^[^:]+:/, ''));

const median = (sorted) => (sorted.length === 0 ? null
  : sorted.length % 2 === 1 ? sorted[(sorted.length - 1) / 2]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2);

const simulate = (xml, { runs: asked = LIMITS.defaultRuns, seed = newSeed() } = {}) => {
  const form = readForm(xml);
  const nodes = [...form.nodes.values()];
  const questions = nodes.filter((n) => n.kind === 'question').sort((a, b) => a.asked - b.asked);
  const runs = Math.max(1, Math.min(asked, Math.floor(LIMITS.visits / Math.max(1, questions.length))));

  // Each bind expression parsed once. One that cannot be read or evaluated is
  // reported once and then treated as described in the contract.
  const notSimulated = new Map();
  const report = (path, attr, expression, reason) => {
    const key = `${path}\u0000${attr}`;
    if (!notSimulated.has(key)) notSimulated.set(key, { path, attribute: attr, expression, reason });
  };
  const trees = new Map();
  const treeOf = (node, attr) => {
    const key = `${node.path}\u0000${attr}`;
    if (!trees.has(key)) {
      try { trees.set(key, parse(node.binds[attr])); } catch (error) {
        report(node.path, attr, node.binds[attr], `it could not be read (${error.message})`);
        trees.set(key, null);
      }
    }
    return trees.get(key);
  };

  // Text the form's own expressions compare answers with ('y', 'other'):
  // simulated text answers sometimes use it.
  const literals = new Set();
  const collect = (n) => {
    if (n == null || typeof n !== 'object') return;
    if (n.type === 'literal' && n.value.length > 0 && n.value.length <= 50) literals.add(n.value);
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) v.forEach(collect); else if (v != null && typeof v === 'object') collect(v);
    }
  };
  // Per question, the values expressions compare it with (`../month = '4'`,
  // `selected(/data/x, 'a')`, `/data/age > 17`): answers sometimes use them.
  const targets = new Map();
  const target = (side, value, context) => {
    const refs = referencesOf(side, context);
    if (refs.length !== 1 || !form.nodes.has(refs[0])) return;
    if (!targets.has(refs[0])) targets.set(refs[0], new Set());
    targets.get(refs[0]).add(value);
  };
  const constant = (n) => (n?.type === 'literal' ? n.value : n?.type === 'number' ? n.value
    : n?.type === 'neg' && n.operand.type === 'number' ? -n.operand.value : null);
  const compared = (n, context) => {
    if (n == null || typeof n !== 'object') return;
    if (n.type === 'cmp') {
      for (const [side, other] of [[n.left, n.right], [n.right, n.left]]) {
        const value = constant(other);
        if (side.type === 'path' && value != null) {
          if (typeof value === 'number') [value - 1, value, value + 1].forEach((v) => target(side, String(v), context));
          else target(side, value, context);
        }
      }
    }
    if (n.type === 'call' && ['selected', 'jr:selected'].includes(n.name) && n.args.length === 2 && n.args[1].type === 'literal')
      target(n.args[0], n.args[1].value, context);
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) v.forEach((x) => compared(x, context)); else if (v != null && typeof v === 'object') compared(v, context);
    }
  };
  for (const node of nodes)
    for (const attr of ['relevant', 'constraint', 'calculate', 'required'])
      if (node.binds[attr] != null) { const tree = treeOf(node, attr); collect(tree); compared(tree, node.path); }
  // Choice questions draw from their own lists.
  for (const [path, set] of targets) {
    const node = form.nodes.get(path);
    if (['select1', 'select', 'rank'].includes(node.control)) targets.delete(path);
    else targets.set(path, [...set].sort());
  }
  const literalList = [...literals].sort();

  const stats = new Map(questions.map((q) => [q.path, { shown: 0, answered: 0, constraintNeverMet: 0 }]));
  const lengths = [];
  const random = generator(`${seed}`);

  for (let run = 0; run < runs; run += 1) {
    const answers = new Map();
    const peers = new Map();
    let memo = new Map();
    const computing = new Set();
    const env = (context) => ({
      context, now: NOW, random,
      exists: (path) => form.nodes.has(path),
      value: (path) => valueOf(path) // eslint-disable-line no-use-before-define
    });
    // Evaluate a bind; `fallback` when it is absent or cannot be evaluated.
    const run1 = (node, attr, fallback) => {
      if (node.binds[attr] == null) return fallback;
      const tree = treeOf(node, attr);
      if (tree == null) return fallback;
      try { return evaluate(tree, env(node.path)); } catch (error) {
        if (!(error instanceof Unsupported)) throw error;
        report(node.path, attr, node.binds[attr], `it uses ${error.what}, which the simulator does not evaluate`);
        return fallback;
      }
    };
    const relevant = (path) => {
      const key = `r${path}`;
      if (memo.has(key)) return memo.get(key);
      const node = form.nodes.get(path);
      let result = true;
      if (node != null) {
        const parent = path.slice(0, path.lastIndexOf('/'));
        result = (parent === '' || !form.nodes.has(parent) || relevant(parent)) && toBool(run1(node, 'relevant', true), env(path));
      }
      memo.set(key, result);
      return result;
    };
    const valueOf = (path) => {
      const node = form.nodes.get(path);
      if (node == null) return '';
      if (answers.has(path)) return answers.get(path);
      if (node.binds.calculate == null) return node.defaultValue ?? '';
      const key = `v${path}`;
      if (memo.has(key)) return memo.get(key);
      // A calculation that depends on itself is blank here; S1 reports the cycle.
      if (computing.has(path)) return '';
      computing.add(path);
      const value = relevant(path) ? toStr(run1(node, 'calculate', ''), env(path)) : '';
      computing.delete(path);
      memo.set(key, value);
      return value;
    };

    let shown = 0;
    for (const q of questions) {
      if (!relevant(q.path)) continue; // eslint-disable-line no-continue
      shown += 1;
      const s = stats.get(q.path);
      s.shown += 1;
      const readonly = q.binds.calculate != null || toBool(run1(q, 'readonly', false), env(q.path));
      if (readonly || NOT_ANSWERED.has(q.control)) continue; // eslint-disable-line no-continue
      const required = toBool(run1(q, 'required', false), env(q.path));
      if (!required && random() < BLANK_RATE) continue; // eslint-disable-line no-continue
      let met = false;
      const constraint = q.binds.constraint == null ? null : treeOf(q, 'constraint');
      const ranges = constraint == null ? null : hint(constraint);
      for (let attempt = 0; attempt < LIMITS.tries && !met; attempt += 1) {
        answers.set(q.path, candidate(q, attempt, random, { ranges, peers: peers.get(typeOf(q)) ?? [], literals: literalList, targets: targets.get(q.path) ?? [] }));
        memo = new Map();
        met = toBool(run1(q, 'constraint', true), env(q.path));
      }
      if (met) {
        s.answered += 1;
        const value = answers.get(q.path);
        if (value !== '') { if (!peers.has(typeOf(q))) peers.set(typeOf(q), []); peers.get(typeOf(q)).push(value); }
      } else {
        s.constraintNeverMet += 1;
        answers.set(q.path, '');
        memo = new Map();
      }
    }
    lengths.push(shown);
  }

  const sorted = [...lengths].sort((a, b) => a - b);
  const labelOf = (q) => {
    if (q.label?.text) return q.label.text;
    const id = q.label?.itextId;
    const first = id == null ? null : [...(form.texts.get(id)?.values() ?? [])].find((t) => t.label !== '' && t.label !== '-');
    return first?.label ?? null;
  };
  const perQuestion = questions.map((q) => ({ path: q.path, label: labelOf(q), control: q.control, ...stats.get(q.path) }));
  const body = {
    simulatorVersion: SIMULATOR_VERSION,
    seed: String(seed),
    runs,
    runsAsked: asked,
    reducedForBudget: runs < asked,
    simulatedToday: NOW.toISOString().slice(0, 10),
    questions: perQuestion,
    neverShown: perQuestion.filter((q) => q.shown === 0).map((q) => q.path),
    constraintNeverMet: perQuestion.filter((q) => q.constraintNeverMet > 0).map((q) => ({ path: q.path, interviews: q.constraintNeverMet })),
    length: { min: sorted[0] ?? 0, median: median(sorted) ?? 0, max: sorted.at(-1) ?? 0 },
    notSimulated: [...notSimulated.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.attribute < b.attribute ? -1 : 1))
  };
  return { ...body, reportHash: createHash('sha256').update(JSON.stringify(body)).digest('hex') };
};

module.exports = { SIMULATOR_VERSION, LIMITS, SEED_PATTERN, NOW, newSeed, generator, candidate, simulate };
