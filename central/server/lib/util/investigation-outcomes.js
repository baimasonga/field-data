// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
//
// Investigation outcomes (F7): docs/field-intelligence/F7-investigation-outcomes.md
//
// Counts over a project's investigations. Pure: the route reads the rows and
// this adds them up. Counts and medians only, no rates or scores.

const DISPOSITIONS = ['confirmed-issue', 'data-error', 'benign-pattern', 'insufficient-evidence', 'policy-exception', 'duplicate'];
const FAMILIES = ['travel', 'location', 'contradiction', 'identity', 'similarity', 'other'];
const MAX_COLLECTORS = 200;
const DAY = 24 * 60 * 60 * 1000;

const zero = () => Object.fromEntries(DISPOSITIONS.map((d) => [d, 0]));
const monthOf = (date) => date.toISOString().slice(0, 7);

// The 12 months up to and including the one `now` is in, oldest first.
const lastMonths = (now) => {
  const months = [];
  for (let back = 11; back >= 0; back -= 1)
    months.push(monthOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1))));
  return months;
};

const median = (values) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

// investigations: [{ id, status, disposition, openedAt, closedAt, reopened }]
//   closedAt is the latest closure (null when never closed).
// findings: [{ findingId, investigationId, family, readable, collectors: [actorId|null] }]
//   one row per finding in a closed investigation.
// names: Map actorId -> displayName
const outcomes = ({ investigations, findings, names, now = new Date() }) => {
  const status = { open: 0, closed: 0, reopened: 0 };
  const dispositions = zero();
  const days = [];
  const months = new Map(lastMonths(now).map((m) => [m, zero()]));
  const closed = new Map();
  for (const v of investigations) {
    status[v.status] += 1;
    if (v.reopened) status.reopened += 1;
    if (v.status !== 'closed') continue; // eslint-disable-line no-continue
    closed.set(v.id, v);
    dispositions[v.disposition] += 1;
    days.push(Math.floor((v.closedAt - v.openedAt) / DAY));
    const month = months.get(monthOf(v.closedAt));
    if (month != null) month[v.disposition] += 1;
  }

  // A finding in several closed investigations counts once, under the one
  // closed most recently.
  const latest = new Map();
  for (const f of findings) {
    const v = closed.get(f.investigationId);
    if (v == null) continue; // eslint-disable-line no-continue
    const seen = latest.get(f.findingId);
    if (seen == null || closed.get(seen.investigationId).closedAt < v.closedAt
      || (+closed.get(seen.investigationId).closedAt === +v.closedAt && seen.investigationId < v.id)) latest.set(f.findingId, f);
  }
  const families = new Map();
  let hiddenFindings = 0;
  for (const f of latest.values()) {
    if (!f.readable) { hiddenFindings += 1; continue; } // eslint-disable-line no-continue
    const family = FAMILIES.includes(f.family) ? f.family : 'other';
    if (!families.has(family)) families.set(family, { family, ...zero(), total: 0 });
    const row = families.get(family);
    row[closed.get(f.investigationId).disposition] += 1;
    row.total += 1;
  }

  // Each collector: the distinct closed investigations their submissions are in.
  const byCollector = new Map();
  for (const f of findings) {
    const v = closed.get(f.investigationId);
    if (v == null || !f.readable) continue; // eslint-disable-line no-continue
    for (const actorId of new Set(f.collectors)) {
      const key = actorId ?? 'unknown';
      if (!byCollector.has(key)) byCollector.set(key, new Map());
      byCollector.get(key).set(v.id, v.disposition);
    }
  }
  const collectors = [...byCollector.entries()].map(([key, investigationsOf]) => {
    const row = { actorId: key === 'unknown' ? null : key, displayName: key === 'unknown' ? null : (names.get(key) ?? null), ...zero(), total: 0 };
    for (const disposition of investigationsOf.values()) { row[disposition] += 1; row.total += 1; }
    return row;
  }).sort((a, b) => b.total - a.total || (a.actorId == null) - (b.actorId == null)
    || String(a.displayName ?? '').localeCompare(String(b.displayName ?? '')) || (a.actorId ?? 0) - (b.actorId ?? 0));

  return {
    status, dispositions,
    timeToClose: days.length === 0 ? null : { median: median(days), longest: Math.max(...days) },
    months: [...months.entries()].map(([month, counts]) => ({ month, ...counts })),
    families: FAMILIES.filter((f) => families.has(f)).map((f) => families.get(f)),
    collectors: collectors.slice(0, MAX_COLLECTORS),
    collectorsOmitted: Math.max(0, collectors.length - MAX_COLLECTORS),
    hiddenFindings,
    generatedAt: now.toISOString()
  };
};

module.exports = { outcomes, lastMonths, median, DISPOSITIONS, FAMILIES, MAX_COLLECTORS };
