// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
//
// Random backcheck sample (O3): a share of every collector's submissions,
// chosen by a seeded hash so the draw can be recomputed and checked by anyone
// holding the seed and the eligible list. Nothing here reads answers.
//
// Contract: docs/field-intelligence/O3-backcheck-sample.md

const { createHash, randomBytes } = require('crypto');

const LIMITS = { maxSample: 500, maxEligible: 50000, maxMinimum: 20 };
const SEED_PATTERN = /^[0-9a-f]{32}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const newSeed = () => randomBytes(16).toString('hex');

// The draw order of a submission: lowest first.
const drawKey = (seed, instanceId) => createHash('sha256').update(`${seed}:${instanceId}`).digest('hex');

// Settings from a request body, or { field, reason } describing the first problem.
const validateSettings = (body) => {
  const allowed = ['requestId', 'rate', 'minPerCollector', 'receivedFrom', 'receivedTo'];
  const unknown = Object.keys(body ?? {}).find((k) => !allowed.includes(k));
  if (body == null || typeof body !== 'object' || Array.isArray(body)) return { error: { field: 'body', reason: 'must be an object' } };
  if (unknown != null) return { error: { field: unknown, reason: 'is not a setting' } };
  const { rate, minPerCollector = 1, receivedFrom = null, receivedTo = null } = body;
  if (!Number.isInteger(rate) || rate < 1 || rate > 100) return { error: { field: 'rate', reason: 'must be a whole percentage from 1 to 100' } };
  if (!Number.isInteger(minPerCollector) || minPerCollector < 0 || minPerCollector > LIMITS.maxMinimum)
    return { error: { field: 'minPerCollector', reason: `must be a whole number from 0 to ${LIMITS.maxMinimum}` } };
  for (const [field, value] of [['receivedFrom', receivedFrom], ['receivedTo', receivedTo]])
    if (value != null && (typeof value !== 'string' || !DATE_PATTERN.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))
      || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value))
      return { error: { field, reason: 'must be a date (YYYY-MM-DD)' } };
  if (receivedFrom != null && receivedTo != null && receivedFrom > receivedTo)
    return { error: { field: 'receivedTo', reason: 'must not be before receivedFrom' } };
  return { settings: { rate, minPerCollector, receivedFrom, receivedTo } };
};

// How many of a stratum of n are taken.
const takeFrom = (n, { rate, minPerCollector }) => Math.min(n, Math.max(minPerCollector, Math.ceil((rate * n) / 100)));

// The sample. `eligible` is [{ instanceId, submitterId }]; the result lists
// the chosen ones with their stratum rank, ordered by stratum then rank, and
// the per-stratum counts. Input order does not matter.
const draw = (eligible, settings, seed) => {
  const strata = new Map();
  for (const e of eligible) {
    const key = e.submitterId ?? null;
    if (!strata.has(key)) strata.set(key, []);
    strata.get(key).push({ ...e, key: drawKey(seed, e.instanceId) });
  }
  const chosen = [];
  const counts = [];
  const order = [...strata.keys()].sort((a, b) => (a == null ? 1 : b == null ? -1 : a - b));
  for (const submitterId of order) {
    const members = strata.get(submitterId)
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.instanceId < b.instanceId ? -1 : 1));
    const take = takeFrom(members.length, settings);
    members.slice(0, take).forEach((m, i) => chosen.push({ instanceId: m.instanceId, submitterId, rank: i + 1 }));
    counts.push({ submitterId, eligible: members.length, sampled: take });
  }
  return { chosen, counts };
};

module.exports = { LIMITS, SEED_PATTERN, newSeed, drawKey, validateSettings, takeFrom, draw };

// O6 scheduled samples (docs/field-intelligence/O6-scheduled-backcheck-samples.md).
// Periods are UTC days, or weeks starting on Monday.
const DAY = 24 * 60 * 60 * 1000;
const FREQUENCIES = ['daily', 'weekly'];
const periodLength = (frequency) => (frequency === 'weekly' ? 7 * DAY : DAY);
// The start of the period that `at` falls in.
const boundaryAtOrBefore = (at, frequency) => {
  const day = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
  return new Date(frequency === 'weekly' ? day - ((at.getUTCDay() + 6) % 7) * DAY : day);
};
const nextBoundaryAfter = (at, frequency) => new Date(boundaryAtOrBefore(at, frequency).getTime() + periodLength(frequency));

// The run due at `now` for a schedule whose current period started at
// `periodStart`: up to the latest boundary, covering every period missed.
const dueRun = ({ periodStart, frequency }, now) => {
  const start = new Date(periodStart);
  const end = boundaryAtOrBefore(now, frequency);
  if (end <= start) return null;
  const periods = Math.round((end - boundaryAtOrBefore(start, frequency)) / periodLength(frequency));
  return { periodStart: start, periodEnd: end, periods };
};

// One request ID per schedule and period, so a period is drawn at most once.
const runRequestId = (scheduleId, periodStart) => {
  const hex = createHash('sha256').update(`backcheck-schedule:${scheduleId}:${new Date(periodStart).toISOString()}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${'89ab'[parseInt(hex[16], 16) % 4]}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

// A schedule's settings from a request body, or { field, reason }.
const validateSchedule = (body) => {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) return { error: { field: 'body', reason: 'must be an object' } };
  const unknown = Object.keys(body).find((k) => !['rate', 'minPerCollector', 'frequency', 'enabled'].includes(k));
  if (unknown != null) return { error: { field: unknown, reason: 'is not a setting' } };
  const { settings, error } = validateSettings({ rate: body.rate, minPerCollector: body.minPerCollector ?? 1 });
  if (error != null) return { error };
  if (!FREQUENCIES.includes(body.frequency)) return { error: { field: 'frequency', reason: 'must be daily or weekly' } };
  if (typeof body.enabled !== 'boolean') return { error: { field: 'enabled', reason: 'must be true or false' } };
  return { schedule: { rate: settings.rate, minPerCollector: settings.minPerCollector, frequency: body.frequency, enabled: body.enabled } };
};

Object.assign(module.exports, { FREQUENCIES, periodLength, boundaryAtOrBefore, nextBoundaryAfter, dueRun, runRequestId, validateSchedule });
