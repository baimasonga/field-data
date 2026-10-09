// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const DAY = 86400000;
const timestamp = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(value)
    || !Number.isFinite(Date.parse(value))) return false;
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return year >= 1900 && month >= 1 && month <= 12 && day >= 1
    && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
};
const freshness = (observation, at = new Date()) => {
  const valid = new Date(observation.validFrom).valueOf();
  const now = new Date(at).valueOf();
  const due = valid + observation.validityDays * DAY;
  const expiry = due + observation.graceDays * DAY;
  const status = observation.integrityStatus === 'unverified' ? 'source-unverified'
    : now < valid ? 'not-yet-valid' : observation.state !== 'known' ? 'unknown'
      : now < due ? 'fresh' : now < expiry ? 'review-due' : 'expired';
  return { status, dueAt: new Date(due).toISOString(), expiresAt: new Date(expiry).toISOString(),
    policyVersion: 'asset-age@1', limitations: 'Supervisor-defined age policy; no confidence or verification of field conditions.' };
};
const selectFacts = (history, at, knownAt) => {
  const result = new Map();
  for (const row of history) {
    if (new Date(row.validFrom) > at || new Date(row.recordedAt) > knownAt) continue;
    const prior = result.get(row.predicate);
    if (prior == null || new Date(row.validFrom) > new Date(prior.validFrom)
      || (new Date(row.validFrom).valueOf() === new Date(prior.validFrom).valueOf()
        && row.sequence > prior.sequence)) result.set(row.predicate, row);
  }
  return [...result.values()].map(row => ({ ...row, freshness: freshness(row, at) }));
};
module.exports = { timestamp, freshness, selectFacts };
