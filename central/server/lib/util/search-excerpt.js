// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
//
// Cited search (K2): which field of a record matched a query, and a short
// excerpt around the match.
//
// Contract: docs/field-intelligence/K2-cited-search.md

const EXCERPT = 160;

const excerptOf = (text, query, size = EXCERPT) => {
  const s = String(text).replace(/\s+/g, ' ').trim();
  const at = s.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return null;
  if (s.length <= size) return s;
  const start = Math.max(0, Math.min(at - Math.floor((size - query.length) / 2), s.length - size));
  return `${start > 0 ? '…' : ''}${s.slice(start, start + size).trim()}${start + size < s.length ? '…' : ''}`;
};

// The first of `fields` ({ name: value }) whose value contains the query.
const matchOf = (fields, query) => {
  for (const [field, value] of Object.entries(fields)) {
    if (value == null) continue; // eslint-disable-line no-continue
    const excerpt = excerptOf(value, query);
    if (excerpt != null) return { field, excerpt };
  }
  return null;
};

// A query as a LIKE pattern, with LIKE's own characters taken literally.
const likePattern = (query) => `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

module.exports = { EXCERPT, excerptOf, matchOf, likePattern };
