// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const crypto = require('node:crypto');
const { invalid } = require('./analysis-data');
const licenses = new Set(['CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0']);
const normalizePublication = body => {
  const value = k => String(body[k] || '').trim();
  const title = value('title'); const description = value('description'); const attribution = value('attribution');
  if (!title || title.length > 255 || description.length > 2000 || !attribution || attribution.length > 500 || !licenses.has(body.license)) throw invalid('metadata', null, 'Supply a title, attribution and a supported Creative Commons license.');
  const { categories } = body;
  if (!Array.isArray(categories) || categories.length < 2 || categories.length > 25 || categories.some(c => typeof c !== 'string' || !c || c.length > 100) || new Set(categories).size !== categories.length) throw invalid('categories', null, 'Explicitly approve 2–25 categorical choice names.');
  const label = value('label'); if (!label || label.length > 255) throw invalid('label', null, 'Use an approved public field label.');
  return { metadata: { version: 1, title, description, attribution, license: body.license }, categories, label };
};
const suppressRelease = (rows, config) => {
  // Publish a complete approved distribution only when every cell meets k=5.
  // No total, answered count or Other bucket can reveal a suppressed cell.
  const counts = new Map(rows.map(r => [r.value, Number(r.count)]));
  if ([...counts.keys()].some(v => v != null && v !== '' && !config.categories.includes(v))) throw invalid('categories', null, 'Unapproved answer categories exist. Review the source before publishing.');
  if (config.categories.some(v => (counts.get(v) || 0) < 5)) return { version: 1, label: config.label, values: [], suppressed: true, disclosure: 'The complete distribution is withheld unless each approved category has at least five records.' };
  return { version: 1, label: config.label, values: config.categories.map(value => ({ value, count: counts.get(value) })), suppressed: false, disclosure: 'Each released category includes at least five records. No raw answers, missing-answer counts or locations are released.' };
};
const fingerprint = result => crypto.createHash('sha256').update(JSON.stringify(result)).digest('hex');
module.exports = { normalizePublication, suppressRelease, fingerprint };
