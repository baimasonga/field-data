// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { selectFacts } = require('./asset-freshness');
const { parseGeopoint, haversineMetres } = require('./fieldwork-integrity');
const reading = (history, predicate, at) => {
  const fact = selectFacts(history.filter(row => row.predicate === predicate), at, at)[0];
  if (!fact) return { status: 'missing', citation: null, point: null };
  const citation = { observationId: fact.id, claimVersionId: fact.claimVersionId, sourceUrl: fact.sourceUrl,
    validFrom: fact.validFrom, recordedAt: fact.recordedAt, freshness: fact.freshness.status };
  if (fact.integrityStatus !== 'verified') return { status: 'source-unverified', citation, point: null };
  if (fact.state !== 'known') return { status: fact.state, citation, point: null };
  if (fact.freshness.status !== 'fresh') return { status: fact.freshness.status, citation, point: null };
  const parts = typeof fact.value === 'string' ? fact.value.trim().split(/\s+/) : [];
  const point = parts.length >= 2 && parts.length <= 4 && parts.every(part => /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(part) && Number.isFinite(Number(part))) ? parseGeopoint(fact.value) : null;
  if (!point || (parts.length === 4 && (Number(parts[3]) < 0 || Number(parts[3]) > 100000))) return { status: 'invalid-geopoint', citation, point: null };
  return { status: 'usable', citation, point };
};
const compare = (a, b, predicate, at = new Date()) => {
  const left = reading(a, predicate, at); const right = reading(b, predicate, at);
  const distanceMetres = left.point && right.point ? haversineMetres(left.point, right.point) : null;
  const uncertainty = left.point?.accuracy != null && right.point?.accuracy != null ? left.point.accuracy + right.point.accuracy : null;
  return { method: 'asset-recorded-location@1', checkedAt: at.toISOString(), predicate, a: left, b: right, distanceMetres,
    reportedAccuracyRangeMetres: distanceMetres != null && uncertainty != null ? { minimum: Math.max(0, distanceMetres - uncertainty), maximum: distanceMetres + uncertainty } : null };
};
module.exports = { reading, compare };
