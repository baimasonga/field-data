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

module.exports = { MAX_ASSETS, STATUSES, summarize };
