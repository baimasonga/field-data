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
module.exports = { compareAnswers, MAX_BYTES };
