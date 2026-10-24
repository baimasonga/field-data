// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { createHash } = require('crypto');
const { samplingWeights } = require('./sampling-weights');
const validateOutcomes = (body, sampleId) => {
  const invalid = reason => ({ error: { field: 'outcomes', reason } });
  if (body == null || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['sampleId', 'definition', 'source', 'outcomes', 'assumeRandomResponse'].includes(k))) return invalid('use the outcome template fields only');
  if (body.sampleId !== sampleId) return invalid('the outcome file must identify this sample');
  if (['definition', 'source'].some(k => typeof body[k] !== 'string' || !body[k].trim() || body[k].length > 1000)) return invalid('provide an outcome definition and review source, each at most 1000 characters');
  if (body.assumeRandomResponse !== undefined && typeof body.assumeRandomResponse !== 'boolean') return invalid('the response assumption must be an explicit boolean');
  if (!Array.isArray(body.outcomes) || body.outcomes.length > 500) return invalid('use at most 500 selected-record outcomes');
  const seen = new Set();
  for (const row of body.outcomes) {
    if (row == null || typeof row !== 'object' || Object.keys(row).some(k => !['instanceId', 'value'].includes(k)) || typeof row.instanceId !== 'string' || row.instanceId.length > 1000 ||
      ![0, 1, null].includes(row.value) || seen.has(row.instanceId)) return invalid('each selected instance ID must occur at most once, with value 0, 1 or null for unknown');
    seen.add(row.instanceId);
  }
  return { input: { sampleId, definition: body.definition.normalize('NFC').trim(), source: body.source.normalize('NFC').trim(),
    assumeRandomResponse: body.assumeRandomResponse === true, outcomes: body.outcomes.map(row => ({ instanceId: row.instanceId, value: row.value })).sort((a, b) => (a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0)) } };
};
const calibratedEstimate = (sample, selected, input) => {
  const weights = samplingWeights(sample.eligible, selected, sample.settings, sample.seed);
  const method = 'recorded-frame-poststratified-binary-v1';
  const base = { method, scope: 'recorded-eligible-submissions', sampleId: sample.id, seed: sample.seed,
    definition: input.definition, source: input.source, input, calibrationTargetSource: 'retained-stratum-eligible-counts', groupField: sample.settings.groupField ?? null,
    inputDigest: createHash('sha256').update(JSON.stringify(input)).digest('hex') };
  if (!weights.available) return { ...base, available: false, reason: weights.reason };
  const byId = new Map(weights.items.map(item => [item.instanceId, item]));
  if (input.outcomes.some(row => !byId.has(row.instanceId))) return { error: { field: 'outcomes', reason: 'outcomes may only name records selected in this draw' } };
  const values = new Map(input.outcomes.map(row => [row.instanceId, row.value]));
  const keyOf = row => JSON.stringify([row.submitterId, ...(sample.settings.groupField ? [row.groupValue] : [])]);
  const strata = new Map(weights.strata.map(row => [keyOf(row), { ...row, reviewed: 0, positive: 0 }]));
  for (const item of weights.items) {
    const value = values.get(item.instanceId);
    if (value === 0 || value === 1) { const row = strata.get(keyOf(item)); row.reviewed += 1; row.positive += value; }
  }
  const cells = [...strata.values()].map(row => ({ ...row, calibrationTarget: row.eligible,
    calibratedWeight: row.reviewed ? row.eligible / row.reviewed : null, responseAdjustment: row.reviewed ? row.sampled / row.reviewed : null }));
  const reviewed = cells.reduce((sum, row) => sum + row.reviewed, 0);
  const diagnostics = { eligible: weights.eligible, sampled: weights.sampled, reviewed, missing: weights.sampled - reviewed, strata: cells,
    outcomes: weights.items.map(item => ({ instanceId: item.instanceId, value: values.get(item.instanceId) ?? null })) };
  if (weights.eligible === 0) return { ...base, ...diagnostics, available: false, reason: 'There are no recorded eligible submissions to estimate.' };
  if (cells.some(row => row.reviewed === 0)) return { ...base, ...diagnostics, available: false, reason: 'Every recorded stratum needs at least one reviewed outcome. Empty strata cannot be calibrated.' };
  if (reviewed < weights.sampled && !input.assumeRandomResponse) return { ...base, ...diagnostics, available: false,
    reason: 'Some selected outcomes are unknown. Explicitly acknowledge random response within each stratum before estimating.', requiresResponseAssumption: true };
  const total = cells.reduce((sum, row) => sum + ((row.eligible * row.positive) / row.reviewed), 0);
  const proportion = total / weights.eligible;
  // Weighted Hoeffding concentration for independent stratum SRS (without replacement).
  // Census cells have no selection uncertainty; use no plug-in zero variance for small cells.
  const rangeSquares = cells.reduce((sum, row) => sum + (row.reviewed === row.eligible ? 0 : ((row.eligible / weights.eligible) ** 2) / row.reviewed), 0);
  const radius = Math.sqrt((Math.log(40) * rangeSquares) / 2);
  return { ...base, ...diagnostics, available: true, estimatedPositiveTotal: total, estimatedProportion: proportion,
    responseAssumption: reviewed < weights.sampled ? 'random-within-each-stratum' : 'not-required-all-selected-reviewed',
    interval: { method: 'conservative-stratified-hoeffding', confidence: 0.95, lower: Math.max(0, proportion - radius), upper: Math.min(1, proportion + radius), radius } };
};
module.exports = { validateOutcomes, calibratedEstimate };
