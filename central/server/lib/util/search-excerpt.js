// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
//
// Cited search (K2): which field of a record matched a query, and a short
// excerpt around the match.
//
// Contract: docs/field-intelligence/K2-cited-search.md

const EXCERPT = 160;

const excerptOf = (text, query, size = EXCERPT) => {
  const s = String(text).replace(/\s+/g, ' ').trim();
  const readableQuery = query.replace(/\s+/g, ' ').trim();
  const at = s.toLowerCase().indexOf(readableQuery.toLowerCase());
  if (at < 0) return null;
  if (s.length <= size) return s;
  const start = Math.max(0, Math.min(at - Math.floor((size - readableQuery.length) / 2), s.length - size));
  return `${start > 0 ? '…' : ''}${s.slice(start, start + size).trim()}${start + size < s.length ? '…' : ''}`;
};

// Prefer an exact field value, then a prefix, then a substring. Field declaration
// order breaks ties. Keep literal matching separate from readable excerpts.
const matchOf = (fields, query) => {
  const needle = query.toLowerCase();
  let best = null;
  let bestRank = 3;
  for (const [field, value] of Object.entries(fields)) {
    if (value == null) continue; // eslint-disable-line no-continue
    const text = String(value).toLowerCase();
    const at = text.indexOf(needle);
    if (at < 0) continue; // eslint-disable-line no-continue
    const rank = text === needle ? 0 : at === 0 ? 1 : 2;
    if (rank < bestRank) {
      best = { field, excerpt: excerptOf(value, query) };
      bestRank = rank;
    }
  }
  return best;
};

// A query as a LIKE pattern, with LIKE's own characters taken literally.
const likePattern = (query) => `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

module.exports = { EXCERPT, excerptOf, matchOf, likePattern };
