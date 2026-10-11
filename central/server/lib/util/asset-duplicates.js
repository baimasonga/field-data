// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
//
// Suggested duplicate assets (K5): pairs of assets that may be the same
// physical thing, each with its reasons. Deterministic rules, no score; a
// person decides.
//
// Contract: docs/field-intelligence/K5-duplicate-assets.md

const MAX_ASSETS = 2000;
const MAX_PAIRS = 200;
// Bounds on the work for one request: pairs held, and name comparisons made.
// Reasons are looked for strongest first, so what is held when a bound is
// reached is the strongest found; the result then says it is capped.
const MAX_CANDIDATES = 2000;
const MAX_COMPARISONS = 500000;
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
// dismissed: Set of pair keys. Returns { pairs, total, capped }.
const findPairs = (assets, sameSource = [], dismissed = new Set()) => {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const reasons = new Map();
  const bounds = { capped: false, comparisons: 0 };
  // Returns false once no more pairs can be held.
  const add = (a, b, reason) => {
    if (a === b || !byId.has(a) || !byId.has(b)) return true;
    const key = keyOf(a, b);
    if (dismissed.has(key)) return true;
    if (!reasons.has(key)) {
      if (reasons.size >= MAX_CANDIDATES) { bounds.capped = true; return false; }
      reasons.set(key, new Set());
    }
    reasons.get(key).add(reason);
    return true;
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
  // Each pair of a group, until a bound is reached.
  const eachPair = (group, fn) => {
    for (let i = 0; i < group.length; i += 1)
      for (let j = i + 1; j < group.length; j += 1) if (!fn(group[i], group[j])) return false;
    return true;
  };
  const scan = () => {
    for (const group of groups((a) => normalize(a.externalId) || null))
      if (!eachPair(group, (a, b) => add(a.id, b.id, 'external-id'))) return;
    for (const [a, b] of sameSource) if (!add(a, b, 'same-source')) return;
    for (const group of groups((a) => normalize(a.assetType) || null)) {
      // Any numerals, not only ASCII ones: "Water point ١" is not "Water point ٢".
      const named = group.map((asset) => ({ asset, name: normalize(asset.name) })).filter((n) => n.name !== '')
        .map((n) => ({ ...n, grams: trigrams(n.name), numbers: n.name.replace(/[^\p{N}]/gu, '') }));
      const keep = eachPair(named, (x, y) => {
        if (x.name === y.name) return add(x.asset.id, y.asset.id, 'same-name');
        // Numbered assets are different things: "Water point 1" is not "Water point 2".
        if (x.numbers !== y.numbers) return true;
        // A pair this similar cannot differ much in size: skip the rest cheaply.
        const [small, large] = [x.grams.size, y.grams.size].sort((m, n) => m - n);
        if (large === 0 || small / large < SIMILAR) return true;
        bounds.comparisons += 1;
        if (bounds.comparisons > MAX_COMPARISONS) { bounds.capped = true; return false; }
        return similarity(x.grams, y.grams) < SIMILAR || add(x.asset.id, y.asset.id, 'similar-name');
      });
      if (!keep) return;
    }
  };
  scan();

  const strongest = (set) => Math.min(...[...set].map((r) => REASONS.indexOf(r)));
  const pairs = [...reasons.entries()].map(([key, set]) => {
    const [a, b] = key.split('|').map((id) => byId.get(id))
      .sort((x, y) => x.name.localeCompare(y.name) || x.id.localeCompare(y.id));
    return { a, b, reasons: REASONS.filter((r) => set.has(r)), rank: strongest(set) };
  }).sort((x, y) => x.rank - y.rank || x.a.name.localeCompare(y.a.name) || x.b.name.localeCompare(y.b.name)
    || x.a.id.localeCompare(y.a.id) || x.b.id.localeCompare(y.b.id));
  return { pairs: pairs.slice(0, MAX_PAIRS).map(({ rank, ...p }) => p), total: pairs.length, capped: bounds.capped };
};

module.exports = { MAX_ASSETS, MAX_PAIRS, MAX_CANDIDATES, MAX_COMPARISONS, SIMILAR, REASONS, normalize, trigrams, similarity, keyOf, findPairs };
