// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
//
// A small XPath 1.0 reader for the survey doctor (S1). It parses expressions as
// written in an XForm into a tree; it does not evaluate them against data. The
// grammar follows XPath 1.0, including the rule that decides whether `*`,
// `and`, `or`, `div` and `mod` are operators or names.

const OPERATOR_NAMES = new Set(['and', 'or', 'div', 'mod']);
const NODE_TYPES = new Set(['node', 'text', 'comment', 'processing-instruction']);
const NAME = /^[A-Za-z_][A-Za-z0-9_.-]*(?::[A-Za-z_][A-Za-z0-9_.-]*)?/;

class XPathSyntaxError extends Error {}

const tokenize = (input) => {
  const tokens = [];
  let i = 0;
  // Whether the previous token lets `*` and operator names act as operators.
  const operatorContext = () => {
    const prev = tokens.at(-1);
    if (prev == null) return false;
    if (prev.type === 'op' || prev.type === 'axis') return false;
    return !['@', '(', '[', ',', '/', '//', '|', '+', '-', '=', '!=', '<', '<=', '>', '>='].includes(prev.value);
  };
  while (i < input.length) {
    const c = input[i];
    if (/\s/.test(c)) { i += 1; continue; } // eslint-disable-line no-continue
    if (c === '"' || c === "'") {
      const end = input.indexOf(c, i + 1);
      if (end < 0) throw new XPathSyntaxError('unterminated string');
      tokens.push({ type: 'literal', value: input.slice(i + 1, end) });
      i = end + 1;
    } else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(input[i + 1] ?? ''))) {
      const match = /^(\d+(\.\d*)?|\.\d+)/.exec(input.slice(i));
      tokens.push({ type: 'number', value: Number(match[0]) });
      i += match[0].length;
    } else if (input.startsWith('..', i)) { tokens.push({ type: 'punct', value: '..' }); i += 2; } else if (c === '.') { tokens.push({ type: 'punct', value: '.' }); i += 1; } else if (input.startsWith('//', i)) { tokens.push({ type: 'punct', value: '//' }); i += 2; } else if (input.startsWith('!=', i) || input.startsWith('<=', i) || input.startsWith('>=', i)) {
      tokens.push({ type: 'punct', value: input.slice(i, i + 2) }); i += 2;
    } else if (input.startsWith('::', i)) { tokens.push({ type: 'punct', value: '::' }); i += 2; } else if ('/()[],@|+-=<>$'.includes(c)) { tokens.push({ type: 'punct', value: c }); i += 1; } else if (c === '*') {
      tokens.push(operatorContext() ? { type: 'op', value: '*' } : { type: 'name', value: '*' });
      i += 1;
    } else {
      const match = NAME.exec(input.slice(i));
      if (match == null) throw new XPathSyntaxError(`unexpected character ${c}`);
      let value = match[0];
      // A name with ':*' is a namespace wildcard.
      if (input[i + value.length] === ':' && input[i + value.length + 1] === '*') value += ':*';
      i += value.length;
      if (OPERATOR_NAMES.has(value) && operatorContext()) tokens.push({ type: 'op', value });
      else if (input.startsWith('::', i)) tokens.push({ type: 'axis', value });
      else tokens.push({ type: 'name', value });
    }
  }
  return tokens;
};

const parse = (input) => {
  const tokens = tokenize(String(input));
  let pos = 0;
  const peek = (offset = 0) => tokens[pos + offset];
  const is = (value, offset = 0) => {
    const t = peek(offset);
    return t != null && (t.type === 'punct' || t.type === 'op') && t.value === value;
  };
  const expect = (value) => {
    if (!is(value)) throw new XPathSyntaxError(`expected ${value}`);
    pos += 1;
  };

  const binary = (next, ops, type) => () => {
    let left = next();
    while (peek() != null && ops.some((op) => is(op))) {
      const op = peek().value; pos += 1;
      left = { type, op, left, right: next() };
    }
    return left;
  };

  let expr; // defined below; the grammar is recursive.

  const predicates = () => {
    const list = [];
    while (is('[')) { pos += 1; list.push(expr()); expect(']'); }
    return list;
  };

  const step = () => {
    if (is('.')) { pos += 1; return { axis: 'self', test: 'node()', predicates: [] }; }
    if (is('..')) { pos += 1; return { axis: 'parent', test: 'node()', predicates: [] }; }
    let axis = 'child';
    if (is('@')) { pos += 1; axis = 'attribute'; } else if (peek()?.type === 'axis') { axis = peek().value; pos += 1; expect('::'); }
    const t = peek();
    if (t == null || t.type !== 'name') throw new XPathSyntaxError('expected a step');
    pos += 1;
    let test = t.value;
    if (NODE_TYPES.has(test) && is('(')) { pos += 1; expect(')'); test = `${test}()`; }
    return { axis, test, predicates: predicates() };
  };

  const relativePath = (steps) => {
    steps.push(step());
    while (is('/') || is('//')) {
      if (is('//')) steps.push({ axis: 'descendant-or-self', test: 'node()', predicates: [] });
      pos += 1;
      steps.push(step());
    }
    return steps;
  };

  const startsStep = () => {
    const t = peek();
    if (t == null) return false;
    if (t.type === 'axis' || (t.type === 'name' && !is('(', 1)) || is('.') || is('..') || is('@')) return true;
    return t.type === 'name' && NODE_TYPES.has(t.value);
  };

  const primary = () => {
    const t = peek();
    if (t == null) throw new XPathSyntaxError('unexpected end');
    if (t.type === 'literal') { pos += 1; return { type: 'literal', value: t.value }; }
    if (t.type === 'number') { pos += 1; return { type: 'number', value: t.value }; }
    if (is('$')) {
      pos += 1;
      const name = peek(); if (name?.type !== 'name') throw new XPathSyntaxError('expected a variable name');
      pos += 1; return { type: 'var', name: name.value };
    }
    if (is('(')) { pos += 1; const inner = expr(); expect(')'); return inner; }
    if (t.type === 'name' && is('(', 1)) {
      pos += 2;
      const args = [];
      if (!is(')')) {
        args.push(expr());
        while (is(',')) { pos += 1; args.push(expr()); }
      }
      expect(')');
      return { type: 'call', name: t.value, args };
    }
    throw new XPathSyntaxError('expected a value');
  };

  const pathExpr = () => {
    if (is('/')) {
      pos += 1;
      return { type: 'path', absolute: true, filter: null, steps: startsStep() ? relativePath([]) : [] };
    }
    if (is('//')) {
      pos += 1;
      return { type: 'path', absolute: true, filter: null, steps: relativePath([{ axis: 'descendant-or-self', test: 'node()', predicates: [] }]) };
    }
    if (startsStep()) return { type: 'path', absolute: false, filter: null, steps: relativePath([]) };
    const base = primary();
    const preds = predicates();
    if (is('/') || is('//')) {
      const steps = [];
      if (is('//')) steps.push({ axis: 'descendant-or-self', test: 'node()', predicates: [] });
      pos += 1;
      return { type: 'path', absolute: false, filter: { expr: base, predicates: preds }, steps: relativePath(steps) };
    }
    return preds.length > 0 ? { type: 'path', absolute: false, filter: { expr: base, predicates: preds }, steps: [] } : base;
  };

  const union = binary(pathExpr, ['|'], 'union');
  const unary = () => {
    if (is('-')) { pos += 1; return { type: 'neg', operand: unary() }; }
    return union();
  };
  const multiplicative = binary(unary, ['*', 'div', 'mod'], 'arith');
  const additive = binary(multiplicative, ['+', '-'], 'arith');
  const relational = binary(additive, ['<', '<=', '>', '>='], 'cmp');
  const equality = binary(relational, ['=', '!='], 'cmp');
  const and = binary(equality, ['and'], 'and');
  const or = binary(and, ['or'], 'or');
  expr = or;

  const tree = expr();
  if (pos !== tokens.length) throw new XPathSyntaxError('unexpected text after the expression');
  return tree;
};

module.exports = { parse, tokenize, XPathSyntaxError };
