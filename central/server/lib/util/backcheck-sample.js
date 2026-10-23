// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
//
// Random backcheck sample (O3): a share of every collector's submissions,
// chosen by a seeded hash so the draw can be recomputed and checked by anyone
// holding the seed and the eligible list. Optional field groups are supplied by the authorized sampling route.
//
// Contract: docs/field-intelligence/O3-backcheck-sample.md

const { createHash, randomBytes } = require('crypto');

const LIMITS = { maxSample: 500, maxEligible: 50000, maxMinimum: 20, maxGroups: 100, maxGroupValue: 200 };
const SEED_PATTERN = /^[0-9a-f]{32}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const newSeed = () => randomBytes(16).toString('hex');

// The draw order of a submission: lowest first.
const drawKey = (seed, instanceId) => createHash('sha256').update(`${seed}:${instanceId}`).digest('hex');

// Settings from a request body, or { field, reason } describing the first problem.
const validateSettings = (body) => {
  const allowed = ['requestId', 'rate', 'minPerCollector', 'receivedFrom', 'receivedTo', 'groupField'];
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
  if (body.groupField !== undefined && (typeof body.groupField !== 'string' || body.groupField.length > 500 ||
    !/^\/(?:[A-Za-z_][A-Za-z0-9_.-]*\/)*[A-Za-z_][A-Za-z0-9_.-]*$/.test(body.groupField)))
    return { error: { field: 'groupField', reason: 'must name a supported question path' } };
  return { settings: { rate, minPerCollector, receivedFrom, receivedTo, ...(body.groupField === undefined ? {} : { groupField: body.groupField }) } };
};

// How many of a stratum of n are taken.
const takeFrom = (n, { rate, minPerCollector }) => Math.min(n, Math.max(minPerCollector, Math.ceil((rate * n) / 100)));

// The sample. `eligible` is [{ instanceId, submitterId }]; the result lists
// the chosen ones with their stratum rank, ordered by stratum then rank, and
// the per-stratum counts. Input order does not matter.
const draw = (eligible, settings, seed) => {
  const strata = new Map();
  for (const e of eligible) {
    const key = settings.groupField ? JSON.stringify([e.submitterId ?? null, e.groupValue ?? null]) : e.submitterId ?? null;
    if (!strata.has(key)) strata.set(key, []);
    strata.get(key).push({ ...e, key: drawKey(seed, e.instanceId) });
  }
  const chosen = [];
  const counts = [];
  const order = [...strata.keys()].sort((a, b) => (settings.groupField ? (a < b ? -1 : a > b ? 1 : 0) : a == null ? 1 : b == null ? -1 : a - b));
  for (const stratum of order) {
    const [submitterId, groupValue] = settings.groupField ? JSON.parse(stratum) : [stratum];
    const group = settings.groupField ? { groupValue } : {};
    const members = strata.get(stratum)
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.instanceId < b.instanceId ? -1 : 1));
    const take = takeFrom(members.length, settings);
    members.slice(0, take).forEach((m, i) => chosen.push({ instanceId: m.instanceId, submitterId, ...group, rank: i + 1 }));
    counts.push({ submitterId, ...group, eligible: members.length, sampled: take });
  }
  return { chosen, counts };
};

const groupFields = fields => {
  const repeats = fields.filter(f => f.type === 'repeat').map(f => f.path);
  return fields.filter(f => ['string', 'int', 'decimal', 'date', 'barcode'].includes(f.type) && !f.binary && !f.selectMultiple &&
    /^\/(?:[A-Za-z_][A-Za-z0-9_.-]*\/)*[A-Za-z_][A-Za-z0-9_.-]*$/.test(f.path) && !f.path.startsWith('/meta/') &&
    !repeats.some(path => f.path.startsWith(`${path}/`))).map(f => ({ path: f.path, type: f.type }));
};

module.exports = { LIMITS, SEED_PATTERN, newSeed, drawKey, validateSettings, takeFrom, draw, groupFields };

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
  const unknown = Object.keys(body).find((k) => !['rate', 'minPerCollector', 'frequency', 'enabled', 'groupField'].includes(k));
  if (unknown != null) return { error: { field: unknown, reason: 'is not a setting' } };
  const { settings, error } = validateSettings({ rate: body.rate, minPerCollector: body.minPerCollector ?? 1, ...(body.groupField == null ? {} : { groupField: body.groupField }) });
  if (error != null) return { error };
  if (!FREQUENCIES.includes(body.frequency)) return { error: { field: 'frequency', reason: 'must be daily or weekly' } };
  if (typeof body.enabled !== 'boolean') return { error: { field: 'enabled', reason: 'must be true or false' } };
  return { schedule: { rate: settings.rate, minPerCollector: settings.minPerCollector, frequency: body.frequency, enabled: body.enabled, ...(settings.groupField ? { groupField: settings.groupField } : {}) } };
};

Object.assign(module.exports, { FREQUENCIES, periodLength, boundaryAtOrBefore, nextBoundaryAfter, dueRun, runRequestId, validateSchedule });
