// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

const { SaxesParser } = require('saxes');

const MAX_BYTES = 2 * 1024 * 1024;
const unavailable = (reason) => Object.assign(new Error('Comparison unavailable.'), { reason });
const answers = (xml) => {
  if (typeof xml !== 'string' || Buffer.byteLength(xml, 'utf8') > MAX_BYTES)
    throw unavailable('size-limit');
  const result = new Map();
  const stack = [];
  let nodes = 0;
  let answerBytes = 0;
  const parser = new SaxesParser({ xmlns: true });
  parser.on('doctype', () => { throw unavailable('unsupported-xml'); });
  parser.on('opentag', (tag) => {
    nodes += 1;
    if (nodes > 20000 || stack.length >= 64) throw unavailable('size-limit');
    const parent = stack.at(-1);
    const name = tag.uri === '' ? tag.local : `{${encodeURIComponent(tag.uri)}}${tag.local}`;
    const index = (parent?.counts.get(name) ?? 0) + 1;
    if (parent != null) { parent.counts.set(name, index); parent.hasChildren = true; }
    const path = parent == null ? '' : `${parent.path}/${name}[${index}]`;
    if (Buffer.byteLength(path, 'utf8') > 8192) throw unavailable('size-limit');
    stack.push({ path,
      skip: parent?.skip === true || (stack.length === 1 && tag.local === 'meta'),
      text: '', counts: new Map(), hasChildren: false });
  });
  const text = (value) => { if (stack.length > 0) stack.at(-1).text += value; };
  parser.on('text', text);
  parser.on('cdata', text);
  parser.on('closetag', () => {
    const node = stack.pop();
    if (node.skip) return;
    if (node.path === '') {
      if (node.text.trim() !== '') throw unavailable('unsupported-xml');
      return;
    }
    if (node.hasChildren) {
      if (node.text.trim() !== '') throw unavailable('unsupported-xml');
      return;
    }
    if (result.size >= 5000) throw unavailable('size-limit');
    answerBytes += Buffer.byteLength(node.path, 'utf8') + Buffer.byteLength(node.text, 'utf8');
    if (answerBytes > MAX_BYTES) throw unavailable('size-limit');
    result.set(node.path, node.text);
  });
  try { parser.write(xml).close(); } catch (error) {
    throw error.reason != null ? error : unavailable('unsupported-xml');
  }
  return result;
};

const compareAnswers = (originalXml, backcheckXml) => {
  const original = answers(originalXml);
  const backcheck = answers(backcheckXml);
  const paths = [...new Set([...original.keys(), ...backcheck.keys()])].sort();
  if (paths.length > 5000) throw unavailable('size-limit');
  const summary = { same: 0, changed: 0, missingOriginal: 0, missingBackcheck: 0 };
  const rows = paths.map((path) => {
    const left = original.get(path) ?? null;
    const right = backcheck.get(path) ?? null;
    const status = left === null ? 'missingOriginal' : right === null ? 'missingBackcheck'
      : left === right ? 'same' : 'changed';
    summary[status] += 1;
    return { path, original: left, backcheck: right, status };
  });
  if (Buffer.byteLength(JSON.stringify(rows), 'utf8') > MAX_BYTES) throw unavailable('size-limit');
  return { summary, rows };
};
// Mappings use literal answer paths, never executable XPath or transformations.
const validPath = (path) => {
  if (typeof path !== 'string' || Buffer.byteLength(path) > 8192) return false;
  const segments = path.split('/').slice(1);
  if (!path.startsWith('/') || segments.length === 0 || segments.length > 63) return false;
  return segments.every((segment, index) => {
    const match = /^(?:\{([^{}]+)\})?([\p{L}_][\p{L}\p{N}\p{M}_.-]*)\[([1-9]\d*)\]$/u.exec(segment);
    if (match == null || !Number.isSafeInteger(Number(match[3]))) return false;
    if (index === 0 && match[2] === 'meta') return false;
    if (match[1] == null) return true;
    try { return encodeURIComponent(decodeURIComponent(match[1])) === match[1]; } catch { return false; }
  });
};
const validatePairs = (pairs, original, backcheck) => {
  if (!Array.isArray(pairs) || pairs.length > 100 || Buffer.byteLength(JSON.stringify(pairs)) > 65536)
    return false;
  const left = new Set();
  const right = new Set();
  for (const pair of pairs) {
    if (pair == null || typeof pair !== 'object' || Array.isArray(pair)
      || Object.keys(pair).some(key => !['originalPath', 'backcheckPath', 'label'].includes(key))
      || (!original.has(pair.originalPath) && !validPath(pair.originalPath))
      || (!backcheck.has(pair.backcheckPath) && !validPath(pair.backcheckPath))
      || typeof pair.label !== 'string' || pair.label.length > 100
      || left.has(pair.originalPath) || right.has(pair.backcheckPath)
      || (!original.has(pair.originalPath) && !backcheck.has(pair.backcheckPath))) return false;
    left.add(pair.originalPath);
    right.add(pair.backcheckPath);
  }
  return true;
};
const compareMappedAnswers = (originalXml, backcheckXml, pairs) => {
  const original = answers(originalXml);
  const backcheck = answers(backcheckXml);
  const summary = { same: 0, changed: 0, missingOriginal: 0, missingBackcheck: 0,
    unmappedOriginal: 0, unmappedBackcheck: 0 };
  const left = new Set(pairs.map(pair => pair.originalPath));
  const right = new Set(pairs.map(pair => pair.backcheckPath));
  const rows = pairs.map(pair => {
    const a = original.get(pair.originalPath) ?? null;
    const b = backcheck.get(pair.backcheckPath) ?? null;
    const status = a === null ? 'missingOriginal' : b === null ? 'missingBackcheck'
      : a === b ? 'same' : 'changed';
    summary[status] += 1;
    return { ...pair, path: `mapped:${pair.originalPath}`, original: a, backcheck: b, status };
  });
  for (const [kind, values, used] of [['original', original, left], ['backcheck', backcheck, right]]) {
    for (const [path, value] of values) {
      if (used.has(path)) continue;
      const status = kind === 'original' ? 'unmappedOriginal' : 'unmappedBackcheck';
      summary[status] += 1;
      rows.push({ path: `${kind}:${path}`, originalPath: kind === 'original' ? path : null,
        backcheckPath: kind === 'backcheck' ? path : null,
        original: kind === 'original' ? value : null, backcheck: kind === 'backcheck' ? value : null, status });
    }
  }
  if (rows.length > 5000 || Buffer.byteLength(JSON.stringify(rows)) > MAX_BYTES)
    throw unavailable('size-limit');
  return { summary, rows };
};
module.exports = { answers, compareAnswers, compareMappedAnswers, validatePairs, MAX_BYTES };
