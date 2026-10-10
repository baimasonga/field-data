// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
//
// An XPath 1.0 evaluator for interview simulation (S2), over trees from
// xpath-reader. It evaluates against a flat model: one value per question
// path, repeats as a single entry. What it does not support it reports by
// throwing Unsupported, never by guessing.
//
// Values are JavaScript strings, numbers and booleans, and node-sets
// ({ nodes: [path] }). Conversions and comparisons follow XPath 1.0, with
// JavaRosa's rule that dates compare and add as days since 1970-01-01.
//
// Contract: docs/field-intelligence/S2-survey-simulation.md

class Unsupported extends Error {
  constructor(what) { super(what); this.what = what; }
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;
const NUMBER = /^\s*-?(\d+(\.\d*)?|\.\d+)\s*$/;

const isSet = (x) => x != null && typeof x === 'object' && Array.isArray(x.nodes);
const parentOf = (path) => path.slice(0, path.lastIndexOf('/'));

// `env.value(path)` is the string value of a node; `env.exists(path)` whether
// the form has it.
const toStr = (x, env) => {
  if (isSet(x)) return x.nodes.length === 0 ? '' : env.value(x.nodes[0]);
  if (typeof x === 'boolean') return x ? 'true' : 'false';
  if (typeof x === 'number') {
    if (Number.isNaN(x)) return 'NaN';
    if (!Number.isFinite(x)) return x > 0 ? 'Infinity' : '-Infinity';
    return Number.isInteger(x) ? String(x) : String(Number(x.toPrecision(15)));
  }
  return x;
};
// Dates and date-times as days since 1970-01-01, as JavaRosa compares them.
const dayNumber = (s) => {
  if (DATE.test(s)) return Date.parse(`${s}T00:00:00Z`) / DAY_MS;
  if (DATE_TIME.test(s)) return Date.parse(s) / DAY_MS;
  return NaN;
};
const toNum = (x, env) => {
  if (typeof x === 'number') return x;
  if (typeof x === 'boolean') return x ? 1 : 0;
  const s = toStr(x, env);
  if (NUMBER.test(s)) return Number(s);
  return dayNumber(s.trim());
};
const toBool = (x) => {
  if (isSet(x)) return x.nodes.length > 0;
  if (typeof x === 'boolean') return x;
  if (typeof x === 'number') return x !== 0 && !Number.isNaN(x);
  return x.length > 0;
};
const dateOf = (days) => new Date(Math.round(days * DAY_MS));
const isoDate = (d) => d.toISOString().slice(0, 10);

const compare = (op, a, b, env) => {
  // A node-set compares through its (single) node's value; an empty one with nothing.
  if (isSet(a) || isSet(b)) {
    if (typeof a === 'boolean' || typeof b === 'boolean') return compare(op, toBool(a, env), toBool(b, env), env);
    if ((isSet(a) && a.nodes.length === 0) || (isSet(b) && b.nodes.length === 0)) return false;
    return compare(op, isSet(a) ? toStr(a, env) : a, isSet(b) ? toStr(b, env) : b, env);
  }
  if (op === '=' || op === '!=') {
    let equal;
    if (typeof a === 'boolean' || typeof b === 'boolean') equal = toBool(a, env) === toBool(b, env);
    else if (typeof a === 'number' || typeof b === 'number') equal = toNum(a, env) === toNum(b, env);
    else equal = a === b;
    return op === '=' ? equal : !equal;
  }
  const x = toNum(a, env); const y = toNum(b, env);
  if (op === '<') return x < y;
  if (op === '<=') return x <= y;
  if (op === '>') return x > y;
  return x >= y;
};

const ARITH = {
  '+': (x, y) => x + y, '-': (x, y) => x - y, '*': (x, y) => x * y,
  div: (x, y) => x / y,
  mod: (x, y) => x % y
};

// format-date's patterns, in UTC (the simulated clock has no time zone).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const formatDate = (days, pattern) => {
  if (Number.isNaN(days)) return '';
  const d = dateOf(days);
  const two = (n) => String(n).padStart(2, '0');
  const parts = {
    Y: String(d.getUTCFullYear()), y: two(d.getUTCFullYear() % 100), m: two(d.getUTCMonth() + 1), n: String(d.getUTCMonth() + 1),
    b: MONTHS[d.getUTCMonth()], d: two(d.getUTCDate()), e: String(d.getUTCDate()), a: DAYS[d.getUTCDay()],
    H: two(d.getUTCHours()), h: String(d.getUTCHours()), M: two(d.getUTCMinutes()), S: two(d.getUTCSeconds()),
    3: String(d.getUTCMilliseconds()).padStart(3, '0')
  };
  return pattern.replace(/%(.)/g, (whole, c) => parts[c] ?? whole);
};

const roundTo = (x, digits = 0) => {
  const f = 10 ** digits;
  // XPath round: halves round up, toward positive infinity.
  return Math.floor(x * f + 0.5) / f;
};

let evaluate; // recursive, defined below

const resolveSteps = (start, steps, env) => {
  let path = start;
  for (const s of steps) {
    if (s.predicates.length > 0) throw new Unsupported('a condition in a path ([...])');
    if (s.axis === 'self' && s.test === 'node()') continue; // eslint-disable-line no-continue
    if (s.axis === 'parent' && s.test === 'node()') { path = parentOf(path); continue; } // eslint-disable-line no-continue
    if (s.axis !== 'child' || s.test === '*' || s.test.endsWith(')')) throw new Unsupported(`the ${s.axis} axis or a wildcard`);
    path = `${path}/${s.test}`;
  }
  return env.exists(path) ? { nodes: [path] } : { nodes: [] };
};

const values = (args, env) => args.flatMap((a) => {
  const v = evaluate(a, env);
  return isSet(v) ? v.nodes.map((n) => env.value(n)) : [toStr(v, env)];
});
const words = (s) => s.split(/\s+/).filter((w) => w !== '');

const FUNCTIONS = {
  true: () => true,
  false: () => false,
  not: ([a], env) => !toBool(evaluate(a, env), env),
  boolean: ([a], env) => toBool(evaluate(a, env), env),
  'boolean-from-string': ([a], env) => ['true', '1'].includes(toStr(evaluate(a, env), env)),
  number: ([a], env) => toNum(a == null ? { nodes: [env.context] } : evaluate(a, env), env),
  string: ([a], env) => toStr(a == null ? { nodes: [env.context] } : evaluate(a, env), env),
  int: ([a], env) => Math.trunc(toNum(evaluate(a, env), env)),
  round: ([a, d], env) => roundTo(toNum(evaluate(a, env), env), d == null ? 0 : toNum(evaluate(d, env), env)),
  floor: ([a], env) => Math.floor(toNum(evaluate(a, env), env)),
  ceiling: ([a], env) => Math.ceil(toNum(evaluate(a, env), env)),
  abs: ([a], env) => Math.abs(toNum(evaluate(a, env), env)),
  pow: ([a, b], env) => toNum(evaluate(a, env), env) ** toNum(evaluate(b, env), env),
  sqrt: ([a], env) => Math.sqrt(toNum(evaluate(a, env), env)),
  min: (args, env) => { const v = values(args, env).map((s) => toNum(s, env)); return v.length === 0 ? NaN : Math.min(...v); },
  max: (args, env) => { const v = values(args, env).map((s) => toNum(s, env)); return v.length === 0 ? NaN : Math.max(...v); },
  sum: (args, env) => values(args, env).reduce((t, s) => t + toNum(s, env), 0),
  count: ([a], env) => { const v = evaluate(a, env); if (!isSet(v)) throw new Unsupported('count() of a value'); return v.nodes.length; },
  concat: (args, env) => args.map((a) => toStr(evaluate(a, env), env)).join(''),
  join: ([sep, ...rest], env) => values(rest, env).join(toStr(evaluate(sep, env), env)),
  contains: ([a, b], env) => toStr(evaluate(a, env), env).includes(toStr(evaluate(b, env), env)),
  'starts-with': ([a, b], env) => toStr(evaluate(a, env), env).startsWith(toStr(evaluate(b, env), env)),
  'ends-with': ([a, b], env) => toStr(evaluate(a, env), env).endsWith(toStr(evaluate(b, env), env)),
  'string-length': ([a], env) => [...toStr(a == null ? { nodes: [env.context] } : evaluate(a, env), env)].length,
  'normalize-space': ([a], env) => words(toStr(a == null ? { nodes: [env.context] } : evaluate(a, env), env)).join(' '),
  translate: ([a, b, c], env) => {
    const from = [...toStr(evaluate(b, env), env)]; const to = [...toStr(evaluate(c, env), env)];
    return [...toStr(evaluate(a, env), env)].map((ch) => { const i = from.indexOf(ch); return i < 0 ? ch : (to[i] ?? ''); }).join('');
  },
  'substring-before': ([a, b], env) => { const s = toStr(evaluate(a, env), env); const i = s.indexOf(toStr(evaluate(b, env), env)); return i < 0 ? '' : s.slice(0, i); },
  'substring-after': ([a, b], env) => { const s = toStr(evaluate(a, env), env); const t = toStr(evaluate(b, env), env); const i = s.indexOf(t); return i < 0 ? '' : s.slice(i + t.length); },
  // ODK's substr: 0-based start, optional exclusive end.
  substr: ([a, b, c], env) => {
    const s = [...toStr(evaluate(a, env), env)];
    const start = Math.max(0, Math.trunc(toNum(evaluate(b, env), env)));
    const end = c == null ? s.length : Math.trunc(toNum(evaluate(c, env), env));
    return s.slice(start, end).join('');
  },
  // XPath's substring: 1-based start and length.
  substring: ([a, b, c], env) => {
    const s = [...toStr(evaluate(a, env), env)];
    const start = roundTo(toNum(evaluate(b, env), env));
    const end = c == null ? Infinity : start + roundTo(toNum(evaluate(c, env), env));
    return s.filter((_, i) => i + 1 >= start && i + 1 < end).join('');
  },
  selected: ([a, b], env) => words(toStr(evaluate(a, env), env)).includes(toStr(evaluate(b, env), env).trim()),
  'count-selected': ([a], env) => words(toStr(evaluate(a, env), env)).length,
  'selected-at': ([a, b], env) => words(toStr(evaluate(a, env), env))[Math.trunc(toNum(evaluate(b, env), env))] ?? '',
  'choice-name': ([a], env) => toStr(evaluate(a, env), env),
  if: ([c, a, b], env) => (toBool(evaluate(c, env), env) ? evaluate(a, env) : evaluate(b, env)),
  coalesce: ([a, b], env) => { const v = toStr(evaluate(a, env), env); return v !== '' ? v : toStr(evaluate(b, env), env); },
  once: ([a], env) => evaluate(a, env),
  regex: ([a, b], env) => {
    let re;
    try { re = new RegExp(toStr(evaluate(b, env), env)); } catch { throw new Unsupported('a regular expression this simulator cannot read'); }
    return re.test(toStr(evaluate(a, env), env));
  },
  today: (_, env) => isoDate(env.now),
  now: (_, env) => env.now.toISOString(),
  date: ([a], env) => {
    const v = evaluate(a, env);
    const n = toNum(v, env);
    return Number.isNaN(n) ? '' : isoDate(dateOf(n));
  },
  'decimal-date-time': ([a], env) => toNum(evaluate(a, env), env),
  'decimal-date': ([a], env) => toNum(evaluate(a, env), env),
  'format-date': ([a, f], env) => formatDate(toNum(evaluate(a, env), env), f == null ? '%Y-%m-%d' : toStr(evaluate(f, env), env)),
  'format-date-time': ([a, f], env) => formatDate(toNum(evaluate(a, env), env), f == null ? '%Y-%m-%dT%H:%M:%S' : toStr(evaluate(f, env), env)),
  position: () => 1,
  random: (_, env) => env.random(),
  uuid: (_, env) => `uuid:sim-${Math.floor(env.random() * 1e12).toString(16)}`,
  current: (_, env) => ({ nodes: [env.context] })
};
// Functions that differ from the above only by namespace.
const ALIASES = { 'jr:choice-name': 'choice-name', 'jr:selected': 'selected' };

evaluate = (node, env) => {
  switch (node.type) {
    case 'literal': return node.value;
    case 'number': return node.value;
    case 'neg': return -toNum(evaluate(node.operand, env), env);
    case 'or': return toBool(evaluate(node.left, env), env) || toBool(evaluate(node.right, env), env);
    case 'and': return toBool(evaluate(node.left, env), env) && toBool(evaluate(node.right, env), env);
    case 'cmp': return compare(node.op, evaluate(node.left, env), evaluate(node.right, env), env);
    case 'arith': return ARITH[node.op](toNum(evaluate(node.left, env), env), toNum(evaluate(node.right, env), env));
    case 'call': {
      const fn = FUNCTIONS[ALIASES[node.name] ?? node.name];
      if (fn == null) throw new Unsupported(`the function ${node.name}()`);
      return fn(node.args, env);
    }
    case 'path': {
      if (node.filter != null) {
        const { expr, predicates } = node.filter;
        if (predicates.length > 0 || expr.type !== 'call' || expr.name !== 'current' || expr.args.length > 0)
          throw new Unsupported(expr.type === 'call' && expr.name === 'instance' ? 'secondary instances (instance(...))' : 'a filtered path');
        return resolveSteps(env.context, node.steps, env);
      }
      return resolveSteps(node.absolute ? '' : env.context, node.steps, env);
    }
    case 'union': throw new Unsupported('a union of paths (|)');
    case 'var': throw new Unsupported('a variable ($...)');
    default: throw new Unsupported(`an expression of type ${node.type}`);
  }
};

module.exports = { Unsupported, evaluate, toStr, toNum, toBool, dayNumber };
