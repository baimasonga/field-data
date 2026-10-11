// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
//
// Asset status across a project (K3): one predicate's current fact for each
// asset, summarised so that only knowledge still current counts by value.
//
// Contract: docs/field-intelligence/K3-asset-status-projection.md

const MAX_ASSETS = 1000;
const CURRENT = new Set(['fresh', 'review-due']);
const STATUSES = ['fresh', 'review-due', 'expired', 'unknown', 'source-unverified', 'not-yet-valid', 'none'];

// assets: [{ fact: null | { value, freshness: { status } } }]
const summarize = (assets) => {
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  const values = new Map();
  for (const { fact } of assets) {
    const status = fact == null ? 'none' : fact.freshness.status;
    byStatus[status] += 1;
    if (CURRENT.has(status)) values.set(fact.value, (values.get(fact.value) ?? 0) + 1);
  }
  const byValue = [...values.entries()].map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value)));
  return { byValue, byStatus };
};

// K6: the same summary for each area, an area being the value of another
// predicate (for example `district`). An asset's area is its current fact for
// that predicate when the fact is known; it is used whatever its freshness, and
// `areaNotCurrent` counts the assets whose area fact is no longer fresh or due
// for review. Assets with no known area are grouped under area null, last.
// assets: [{ fact, area: null | { value, state, freshness: { status } } }]
const areaOf = ({ area }) => (area != null && area.state === 'known' && area.value != null && area.value !== '' ? area.value : null);
const summarizeByArea = (assets) => {
  const groups = new Map();
  for (const asset of assets) {
    const key = areaOf(asset);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(asset);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a == null) - (b == null) || String(a ?? '').localeCompare(String(b ?? '')))
    .map(([area, members]) => ({
      area, assets: members.length,
      areaNotCurrent: area == null ? 0 : members.filter((m) => !CURRENT.has(m.area.freshness.status)).length,
      ...summarize(members)
    }));
};

module.exports = { MAX_ASSETS, STATUSES, summarize, summarizeByArea, areaOf };
