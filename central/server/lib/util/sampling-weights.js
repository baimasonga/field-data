// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { draw, SEED_PATTERN, LIMITS, validateSettings } = require('./backcheck-sample');
const method = 'stratum-expansion-v1';
const scope = 'recorded-eligible-submissions';
// Use retained membership, never live source answers or the item's nullable actor FK.
const samplingWeights = (eligible, selected, settings, seed) => {
  const unavailable = () => ({ available: false, method, scope, reason: 'The recorded eligibility and selected membership do not reproduce this draw. Weights are unavailable.' });
  if (!Array.isArray(eligible) || !Array.isArray(selected) || eligible.length > LIMITS.maxEligible || selected.length > LIMITS.maxSample ||
    !SEED_PATTERN.test(seed) || !Number.isInteger(settings?.rate) || settings.rate < 1 || settings.rate > 100 ||
    !Number.isInteger(settings?.minPerCollector) || settings.minPerCollector < 0 || settings.minPerCollector > LIMITS.maxMinimum) return unavailable();
  const design = Object.fromEntries(['rate', 'minPerCollector', 'receivedFrom', 'receivedTo', 'groupField', 'groupRates', 'groupBreaks', 'groupAreas']
    .filter(key => settings[key] !== undefined).map(key => [key, settings[key]]));
  if (validateSettings(design).error) return unavailable();
  const byId = new Map(); const strata = new Map();
  const keyOf = e => JSON.stringify([e.submitterId ?? null, ...(settings.groupField ? [e.groupValue ?? null] : [])]);
  for (const e of eligible) {
    if (e == null || typeof e.instanceId !== 'string' || byId.has(e.instanceId) ||
      (e.submitterId != null && !Number.isInteger(e.submitterId)) || (settings.groupField && e.groupValue != null && typeof e.groupValue !== 'string')) return unavailable();
    byId.set(e.instanceId, e);
    const key = keyOf(e);
    if (!strata.has(key)) strata.set(key, { submitterId: e.submitterId ?? null, ...(settings.groupField ? { groupValue: e.groupValue ?? null } : {}), eligible: 0, sampled: 0 });
    strata.get(key).eligible += 1;
  }
  let expected;
  try { expected = new Set(draw(eligible, settings, seed).chosen.map(e => e.instanceId)); } catch { return unavailable(); }
  const seen = new Set();
  for (const item of selected) {
    if (!expected.has(item?.instanceId) || seen.has(item.instanceId)) return unavailable();
    seen.add(item.instanceId); strata.get(keyOf(byId.get(item.instanceId))).sampled += 1;
  }
  if (seen.size !== expected.size || [...strata.values()].some(s => s.sampled === 0)) return unavailable();
  const values = [...strata.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, s]) => ({ ...s,
    inclusionProbability: s.sampled / s.eligible, designWeight: s.eligible / s.sampled }));
  const weights = new Map(values.map(s => [keyOf(s), s]));
  return { available: true, method, scope, eligible: eligible.length, sampled: selected.length, strata: values,
    items: [...seen].sort().map(instanceId => ({ instanceId, ...weights.get(keyOf(byId.get(instanceId))) })) };
};
module.exports = { samplingWeights };
