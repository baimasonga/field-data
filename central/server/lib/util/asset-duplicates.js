// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
//
// Suggested duplicate assets (K5): pairs of assets that may be the same
// physical thing, each with its reasons. Deterministic rules, no score; a
// person decides.
//
// Contract: docs/field-intelligence/K5-duplicate-assets.md

const MAX_ASSETS = 2000;
const MAX_PAIRS = 200;
const SIMILAR = 0.6;
// Strongest first.
const REASONS = ['external-id', 'same-source', 'same-name', 'similar-name'];

// Letters and digits only, lower case, accents removed: "Kissy Water-Point" and "kissy waterpoint" are the same.
const normalize = (value) => String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/[^\p{L}\p{N}]/gu, '');

const trigrams = (text) => {
  const grams = new Set();
  for (let i = 0; i + 3 <= text.length; i += 1) grams.add(text.slice(i, i + 3));
  return grams;
};
// Shared three-letter fragments over all fragments of either.
const similarity = (a, b) => {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared += 1;
  return shared / (a.size + b.size - shared);
};

const keyOf = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

// assets: [{ id, name, assetType, externalId }]; sameSource: [[idA, idB]]
// for assets with an observation citing the same claim version;
// dismissed: Set of pair keys. Returns { pairs, total }.
const findPairs = (assets, sameSource = [], dismissed = new Set()) => {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const reasons = new Map();
  const add = (a, b, reason) => {
    if (a === b || !byId.has(a) || !byId.has(b)) return;
    const key = keyOf(a, b);
    if (dismissed.has(key)) return;
    if (!reasons.has(key)) reasons.set(key, new Set());
    reasons.get(key).add(reason);
  };
  const groups = (keyFn) => {
    const map = new Map();
    for (const asset of assets) {
      const key = keyFn(asset);
      if (key == null) continue; // eslint-disable-line no-continue
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(asset);
    }
    return [...map.values()].filter((group) => group.length > 1);
  };
  const eachPair = (group, fn) => {
    for (let i = 0; i < group.length; i += 1) for (let j = i + 1; j < group.length; j += 1) fn(group[i], group[j]);
  };

  for (const group of groups((a) => normalize(a.externalId) || null)) eachPair(group, (a, b) => add(a.id, b.id, 'external-id'));
  for (const [a, b] of sameSource) add(a, b, 'same-source');
  const typed = groups((a) => normalize(a.assetType) || null);
  for (const group of typed) {
    const named = group.map((asset) => ({ asset, name: normalize(asset.name) })).filter((n) => n.name !== '')
      .map((n) => ({ ...n, digits: n.name.replace(/\D/g, '') }));
    const grams = named.map((n) => trigrams(n.name));
    for (let i = 0; i < named.length; i += 1) {
      for (let j = i + 1; j < named.length; j += 1) {
        if (named[i].name === named[j].name) add(named[i].asset.id, named[j].asset.id, 'same-name');
        // Numbered assets are different things: "Water point 1" is not "Water point 2".
        else if (named[i].digits === named[j].digits) {
          // A pair this similar cannot differ much in size: skip the rest cheaply.
          const [small, large] = [grams[i].size, grams[j].size].sort((x, y) => x - y);
          if (large > 0 && small / large >= SIMILAR && similarity(grams[i], grams[j]) >= SIMILAR)
            add(named[i].asset.id, named[j].asset.id, 'similar-name');
        }
      }
    }
  }

  const strongest = (set) => Math.min(...[...set].map((r) => REASONS.indexOf(r)));
  const pairs = [...reasons.entries()].map(([key, set]) => {
    const [a, b] = key.split('|').map((id) => byId.get(id))
      .sort((x, y) => x.name.localeCompare(y.name) || x.id.localeCompare(y.id));
    return { a, b, reasons: REASONS.filter((r) => set.has(r)), rank: strongest(set) };
  }).sort((x, y) => x.rank - y.rank || x.a.name.localeCompare(y.a.name) || x.b.name.localeCompare(y.b.name)
    || x.a.id.localeCompare(y.a.id) || x.b.id.localeCompare(y.b.id));
  return { pairs: pairs.slice(0, MAX_PAIRS).map(({ rank, ...p }) => p), total: pairs.length };
};

module.exports = { MAX_ASSETS, MAX_PAIRS, SIMILAR, REASONS, normalize, trigrams, similarity, keyOf, findPairs };
