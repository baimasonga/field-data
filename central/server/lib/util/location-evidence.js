// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
//
// Location evidence (G1): what a submission's location answer rests on, and
// three deterministic checks a reviewer can inspect. The same principles as
// the travel rule in fieldwork-integrity.js apply: nothing here decides, gaps
// are named rather than filled, and there is no score.
//
// Contract: docs/field-intelligence/G1-location-evidence.md

const crypto = require('node:crypto');
const { parseGeopoint } = require('./fieldwork-integrity');

const EARTH_RADIUS_M = 6371008.8;

const LOCATION_ACCURACY = {
  rule: 'location-accuracy',
  version: 1,
  // The same limit the travel rule uses for a usable reading.
  maxAccuracyM: 100
};

const OUTSIDE_PROJECT_AREA = {
  rule: 'outside-project-area',
  version: 1,
  // Used in place of the reading's own accuracy when it reported none.
  defaultToleranceM: 100
};

const REPEATED_LOCATION = {
  rule: 'repeated-location',
  version: 1,
  // Fewer reported decimals than this (about 1 m at the equator for 5) is too
  // coarse for an exact repeat to mean anything.
  minDecimals: 5
};

const G1_RULES = [LOCATION_ACCURACY.rule, OUTSIDE_PROJECT_AREA.rule, REPEATED_LOCATION.rule];

////////////////////////////////////////////////////////////////////////////////
// COMPONENTS

// What the answer itself says, before any check. `0 0` is named separately
// from an unreadable value because it has a common, specific cause: a device
// with no fix.
const readLocation = (raw) => {
  if (raw == null || String(raw).trim() === '') return { present: 'no', location: null };
  const location = parseGeopoint(String(raw));
  if (location != null) return { present: 'yes', location };
  const parts = String(raw).trim().split(/\s+/).map(Number);
  if (parts.length >= 2 && parts[0] === 0 && parts[1] === 0) return { present: 'null-island', location: null };
  return { present: 'unparseable', location: null };
};

const accuracyBand = (accuracy) => {
  if (accuracy == null) return 'unknown';
  if (accuracy <= 10) return '≤10';
  if (accuracy <= 30) return '≤30';
  if (accuracy <= 100) return '≤100';
  return '>100';
};

// The latitude and longitude exactly as the device wrote them, and the fewest
// decimal places either carries. Repeats are judged on these strings, not on
// the parsed numbers, because "8.4657" and "8.465700" are different readings.
const reportedCoordinates = (raw) => {
  const [lat, lon] = String(raw ?? '').trim().split(/\s+/);
  const decimals = (text) => (/\.(\d+)$/.exec(text ?? '') ?? [null, ''])[1].length;
  return { key: `${lat} ${lon}`, decimals: Math.min(decimals(lat), decimals(lon)) };
};

////////////////////////////////////////////////////////////////////////////////
// PROJECT AREA GEOMETRY

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

// Segments of a ring that cross each other, other than neighbours sharing a
// vertex. A uniform grid keeps this close to linear for real boundaries.
const ringSelfIntersects = (ring) => {
  const n = ring.length - 1; // closed: last point repeats the first
  if (n < 3) return true;
  const segs = [];
  for (let i = 0; i < n; i += 1) segs.push([ring[i], ring[i + 1]]);
  const xs = ring.map((p) => p[0]); const ys = ring.map((p) => p[1]);
  const minX = Math.min(...xs); const minY = Math.min(...ys);
  const size = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY) / Math.max(1, Math.ceil(Math.sqrt(n))) || 1;
  const cells = new Map();
  segs.forEach(([a, b], index) => {
    const x0 = Math.floor((Math.min(a[0], b[0]) - minX) / size); const x1 = Math.floor((Math.max(a[0], b[0]) - minX) / size);
    const y0 = Math.floor((Math.min(a[1], b[1]) - minY) / size); const y1 = Math.floor((Math.max(a[1], b[1]) - minY) / size);
    for (let x = x0; x <= x1; x += 1) for (let y = y0; y <= y1; y += 1) {
      const key = `${x},${y}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(index);
    }
  });
  const orient = (p, q, r) => Math.sign(((q[1] - p[1]) * (r[0] - q[0])) - ((q[0] - p[0]) * (r[1] - q[1])));
  const onSegment = (p, q, r) => Math.min(p[0], r[0]) <= q[0] && q[0] <= Math.max(p[0], r[0])
    && Math.min(p[1], r[1]) <= q[1] && q[1] <= Math.max(p[1], r[1]);
  const cross = ([p1, q1], [p2, q2]) => {
    const o1 = orient(p1, q1, p2); const o2 = orient(p1, q1, q2); const o3 = orient(p2, q2, p1); const o4 = orient(p2, q2, q1);
    if (o1 !== o2 && o3 !== o4) return true;
    return (o1 === 0 && onSegment(p1, p2, q1)) || (o2 === 0 && onSegment(p1, q2, q1))
      || (o3 === 0 && onSegment(p2, p1, q2)) || (o4 === 0 && onSegment(p2, q1, q2));
  };
  const seen = new Set();
  for (const list of cells.values()) {
    for (let i = 0; i < list.length; i += 1) for (let j = i + 1; j < list.length; j += 1) {
      const a = Math.min(list[i], list[j]); const b = Math.max(list[i], list[j]);
      const pair = `${a}:${b}`;
      if (!seen.has(pair)) {
        seen.add(pair);
        const adjacent = b === a + 1 || (a === 0 && b === n - 1);
        if (!adjacent && cross(segs[a], segs[b])) return true;
      }
    }
  }
  return false;
};

// A project area from an uploaded GeoJSON FeatureCollection, or the reason it
// cannot serve as one. Only polygons count; points and lines in the same layer
// are ignored, since they bound nothing.
const projectAreaFrom = (featureCollection) => {
  const polygons = [];
  for (const feature of featureCollection?.features ?? []) {
    const g = feature?.geometry;
    if (g?.type === 'Polygon') polygons.push(g.coordinates);
    else if (g?.type === 'MultiPolygon') polygons.push(...g.coordinates);
  }
  if (polygons.length === 0) return { usable: false, reason: 'no-polygon' };
  for (const rings of polygons) {
    for (const ring of rings) {
      const lons = ring.map((p) => p[0]);
      // A ring spanning more than half the globe in longitude almost certainly
      // crosses the antimeridian, where planar containment gives wrong answers.
      if (Math.max(...lons) - Math.min(...lons) > 180) return { usable: false, reason: 'antimeridian' };
    }
  }
  for (const rings of polygons)
    for (const ring of rings)
      if (ringSelfIntersects(ring)) return { usable: false, reason: 'self-intersecting' };
  return { usable: true, polygons, hash: sha256(JSON.stringify(polygons)) };
};

// Even-odd ray casting over every ring of one polygon, so holes are honoured.
const insidePolygon = (point, rings) => {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
      if (((yi > point[1]) !== (yj > point[1]))
        && (point[0] < (((xj - xi) * (point[1] - yi)) / (yj - yi)) + xi)) inside = !inside;
    }
  }
  return inside;
};

// Shortest distance from the point to any edge, in metres, on a local
// equirectangular projection centred on the point. Adequate at project scale;
// the evidence says so.
const distanceToBoundaryM = (point, polygons) => {
  const lat0 = (point[1] * Math.PI) / 180;
  const project = ([lon, lat]) => [
    ((lon - point[0]) * Math.PI * EARTH_RADIUS_M * Math.cos(lat0)) / 180,
    ((lat - point[1]) * Math.PI * EARTH_RADIUS_M) / 180
  ];
  let best = Infinity;
  for (const rings of polygons) for (const ring of rings) {
    for (let i = 1; i < ring.length; i += 1) {
      const [ax, ay] = project(ring[i - 1]); const [bx, by] = project(ring[i]);
      const dx = bx - ax; const dy = by - ay; const len2 = (dx * dx) + (dy * dy);
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -((ax * dx) + (ay * dy)) / len2));
      best = Math.min(best, Math.hypot(ax + (t * dx), ay + (t * dy)));
    }
  }
  return best;
};

////////////////////////////////////////////////////////////////////////////////
// RULES
//
// Each takes rows of { instanceId, geopoint (raw string), submitterId,
// deviceId, receivedAt } and returns { findings, counts }. Only what a person
// should look at becomes a finding; everything else is counted, by reason.

const finding = (spec, instanceId, outcome, evidence, relatedInstanceId = null) => ({
  rule: spec.rule, ruleVersion: spec.version, instanceId, relatedInstanceId, outcome, evidence
});

const checkLocationAccuracy = (rows) => {
  const counts = { examined: rows.length, concern: 0, withinLimit: 0, accuracyNotReported: 0, noLocation: 0 };
  const findings = [];
  for (const row of rows) {
    const { location } = readLocation(row.geopoint);
    if (location == null) counts.noLocation += 1;
    else if (location.accuracy == null) counts.accuracyNotReported += 1;
    else if (location.accuracy <= LOCATION_ACCURACY.maxAccuracyM) counts.withinLimit += 1;
    else {
      counts.concern += 1;
      findings.push(finding(LOCATION_ACCURACY, row.instanceId, 'concern', {
        reportedAccuracyM: location.accuracy,
        thresholdM: LOCATION_ACCURACY.maxAccuracyM,
        field: row.geopointField ?? null,
        explanation: `The device reported this reading as accurate only to ${location.accuracy} m, worse than ${LOCATION_ACCURACY.maxAccuracyM} m. The position may be far from where the interview took place.`,
        alternatives: [
          'The reading was taken indoors, under heavy cover or before the device had a good fix.',
          'The device saved the location early instead of waiting for a better reading.'
        ],
        nextStep: 'Treat this location as approximate. Ask the collector whether the reading was taken on site.'
      }));
    }
  }
  return { findings, counts };
};

const checkOutsideProjectArea = (rows, area) => {
  const counts = { examined: rows.length, concern: 0, nearEdge: 0, inside: 0, noLocation: 0 };
  const findings = [];
  for (const row of rows) {
    const { location } = readLocation(row.geopoint);
    if (location == null) { counts.noLocation += 1; continue; }
    const point = [location.longitude, location.latitude];
    const distanceM = distanceToBoundaryM(point, area.polygons);
    const inside = distanceM === 0 || area.polygons.some((rings) => insidePolygon(point, rings));
    if (inside) { counts.inside += 1; continue; }
    const toleranceM = location.accuracy ?? OUTSIDE_PROJECT_AREA.defaultToleranceM;
    const evidence = {
      distanceOutsideM: Math.round(distanceM * 10) / 10,
      toleranceM,
      toleranceSource: location.accuracy == null ? 'default-no-accuracy-reported' : 'reported-accuracy',
      area: { layerId: area.layerId, layerRevision: area.layerRevision, geometrySha256: area.hash },
      field: row.geopointField ?? null,
      method: 'Point-in-polygon on longitude/latitude; distance on a local equirectangular projection. Adequate at project scale.'
    };
    if (distanceM <= toleranceM) {
      counts.nearEdge += 1;
      findings.push(finding(OUTSIDE_PROJECT_AREA, row.instanceId, 'inconclusive', {
        ...evidence,
        reason: 'near-edge',
        explanation: `The reading is ${evidence.distanceOutsideM} m outside the project area, within its ${toleranceM} m uncertainty. It may well be inside.`
      }));
    } else {
      counts.concern += 1;
      findings.push(finding(OUTSIDE_PROJECT_AREA, row.instanceId, 'concern', {
        ...evidence,
        explanation: `The reading is ${evidence.distanceOutsideM} m outside the project area, more than its ${toleranceM} m uncertainty.`,
        alternatives: [
          'The project area boundary is incomplete or out of date.',
          'The interview legitimately took place outside the area, for example with a respondent who had moved.',
          'The reading was worse than the accuracy the device reported.'
        ],
        nextStep: 'Check the boundary first, then ask the collector where the interview took place.'
      }));
    }
  }
  return { findings, counts };
};

const checkRepeatedLocation = (rows) => {
  const counts = { examined: rows.length, concern: 0, tooCoarse: 0, noLocation: 0 };
  const groups = new Map();
  for (const row of rows) {
    const { location } = readLocation(row.geopoint);
    if (location == null) { counts.noLocation += 1; continue; }
    const { key, decimals } = reportedCoordinates(row.geopoint);
    if (decimals < REPEATED_LOCATION.minDecimals) { counts.tooCoarse += 1; continue; }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const findings = [];
  for (const [key, group] of groups) {
    if (group.length >= 2) {
      // The earliest received is the reference; each later one is related to it,
      // so a group of n gives n - 1 findings rather than every pair.
      const ordered = [...group].sort((a, b) => (new Date(a.receivedAt) - new Date(b.receivedAt))
        || String(a.instanceId).localeCompare(String(b.instanceId)));
      const first = ordered[0];
      for (const row of ordered.slice(1)) {
        counts.concern += 1;
        findings.push(finding(REPEATED_LOCATION, row.instanceId, 'concern', {
          coordinates: key,
          groupSize: group.length,
          sameSubmitter: row.submitterId != null && row.submitterId === first.submitterId,
          sameDevice: row.deviceId != null && row.deviceId === first.deviceId,
          explanation: `This location is identical, to every digit reported, to ${group.length - 1} other submission(s) of this form. Separate readings almost never match exactly.`,
          alternatives: [
            'The device re-used a cached location instead of taking a new reading.',
            'The same place was legitimately visited again, for example a repeat interview or a shared compound.',
            'The value was copied or entered by hand.'
          ],
          nextStep: 'Compare the submissions and ask the collector how the location was recorded.'
        }, first.instanceId));
      }
    }
  }
  return { findings, counts };
};

////////////////////////////////////////////////////////////////////////////////
// PER-SUBMISSION READ-OUT

const locationComponents = (row, { areaStatus = 'not-checked', repeats = 0 } = {}) => {
  const { present, location } = readLocation(row.geopoint);
  return {
    present,
    field: row.geopointField ?? null,
    reportedAccuracyM: location?.accuracy ?? null,
    accuracyBand: location == null ? null : accuracyBand(location.accuracy),
    withinProjectArea: location == null ? 'not-checked' : areaStatus,
    repeatedExactly: repeats,
    captureTime: row.capturedAt != null ? 'device-audit-log' : 'unavailable'
  };
};

module.exports = {
  LOCATION_ACCURACY, OUTSIDE_PROJECT_AREA, REPEATED_LOCATION, G1_RULES,
  readLocation, accuracyBand, reportedCoordinates, projectAreaFrom, ringSelfIntersects,
  insidePolygon, distanceToBoundaryM,
  checkLocationAccuracy, checkOutsideProjectArea, checkRepeatedLocation, locationComponents
};
