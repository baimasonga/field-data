// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { projectAreaFrom, insidePolygon, distanceToBoundaryM } = require('./location-evidence');
const AREA_LIMITS = { areas: 20, vertices: 2000, bytes: 65536, work: 10000000 };
const OUTSIDE = 'Outside areas'; const OVERLAP = 'Overlapping areas';
const areaLabels = areas => [...areas.map(area => area.value), OUTSIDE, OVERLAP];
const polygonsOf = geometry => (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates);
const areaVertexCount = areas => areas.reduce((sum, area) => sum + polygonsOf(area.geometry).reduce((n, rings) => n + rings.reduce((m, ring) => m + ring.length, 0), 0), 0);
const cross = (a, b, c) => ((b[0] - a[0]) * (c[1] - a[1])) - ((b[1] - a[1]) * (c[0] - a[0]));
const onSegment = (a, b, p) => cross(a, b, p) === 0 && p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]) && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);
const intersects = (a, b, c, d) => {
  const x = cross(a, b, c); const y = cross(a, b, d); const z = cross(c, d, a); const w = cross(c, d, b);
  return (Math.sign(x) * Math.sign(y) < 0 && Math.sign(z) * Math.sign(w) < 0) ||
    (x === 0 && onSegment(a, b, c)) || (y === 0 && onSegment(a, b, d)) || (z === 0 && onSegment(c, d, a)) || (w === 0 && onSegment(c, d, b));
};
const ringsIntersect = (a, b) => a.slice(1).some((p, i) => b.slice(1).some((q, j) => intersects(a[i], p, b[j], q)));
const validateAreas = input => {
  try {
    const fail = reason => { throw new Error(reason); };
    if (!Array.isArray(input) || input.length > AREA_LIMITS.areas || Buffer.byteLength(JSON.stringify(input)) > AREA_LIMITS.bytes)
      fail('use at most 20 named areas within 64 KiB');
    const seen = new Set(); let vertices = 0;
    const areas = input.map(area => {
      if (area == null || Object.keys(area).some(k => !['value', 'geometry'].includes(k)) || typeof area.value !== 'string' || area.value.length > 200)
        fail('each area needs a name of at most 200 characters and a Polygon or MultiPolygon');
      const value = area.value.normalize('NFC').trim();
      if (!value || value.length > 200 || seen.has(value) || [OUTSIDE, OVERLAP, 'Missing answer'].includes(value)) fail('area names must be distinct and cannot use Outside areas, Overlapping areas or Missing answer');
      seen.add(value);
      const g = area.geometry;
      if (g == null || Object.keys(g).some(k => !['type', 'coordinates'].includes(k)) || !['Polygon', 'MultiPolygon'].includes(g.type) || !Array.isArray(g.coordinates))
        fail('use WGS84 Polygon or MultiPolygon geometry');
      const polygons = polygonsOf(g);
      if (!polygons.length) fail('areas cannot be empty');
      for (const rings of polygons) {
        if (!Array.isArray(rings) || !rings.length) fail('polygons require closed rings');
        for (const ring of rings) {
          if (!Array.isArray(ring) || ring.length < 4) fail('rings require at least four positions');
          for (const p of ring) {
            vertices += 1;
            if (vertices > AREA_LIMITS.vertices || !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90)
              fail('use valid longitude/latitude pairs and at most 2000 vertices');
          }
          if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1] ||
            ring.slice(1).reduce((sum, p, i) => sum + (ring[i][0] * p[1]) - (p[0] * ring[i][1]), 0) === 0)
            fail('rings must be closed and enclose a nonzero area');
        }
        const valid = projectAreaFrom({ features: [{ geometry: { type: 'Polygon', coordinates: rings } }] });
        if (!valid.usable) fail('self-intersecting or antimeridian-crossing polygons are unsupported');
        for (let i = 1; i < rings.length; i += 1) {
          if (!insidePolygon(rings[i][0], [rings[0]]) || ringsIntersect(rings[0], rings[i])) fail('holes must lie strictly inside their outer ring');
          for (let j = 1; j < i; j += 1)
            if (ringsIntersect(rings[i], rings[j]) || insidePolygon(rings[i][0], [rings[j]]) || insidePolygon(rings[j][0], [rings[i]])) fail('holes must not intersect or contain one another');
        }
      }
      return { value, geometry: { type: g.type, coordinates: g.coordinates } };
    });
    areas.sort((a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
    return { areas };
  } catch (error) { return { error: { field: 'groupAreas', reason: error.message } }; }
};
const polygonGroup = (raw, areas) => {
  if (raw === null) return { value: null };
  const parts = raw.split(/\s+/);
  const numbers = parts.map(Number);
  if (parts.length < 2 || parts.length > 4 || parts.some(p => !/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(p)) ||
    !numbers.every(Number.isFinite) || Math.abs(numbers[0]) > 90 || Math.abs(numbers[1]) > 180 || (numbers[0] === 0 && numbers[1] === 0) || numbers[3] < 0)
    return { error: 'locations must be valid geopoints; null-island (0,0) readings are unavailable' };
  const point = [numbers[1], numbers[0]];
  const matches = areas.filter(area => polygonsOf(area.geometry).some(rings => insidePolygon(point, rings) || distanceToBoundaryM(point, [rings]) === 0));
  return { value: matches.length === 0 ? OUTSIDE : matches.length > 1 ? OVERLAP : matches[0].value };
};
module.exports = { AREA_LIMITS, OUTSIDE, OVERLAP, validateAreas, polygonGroup, areaLabels, areaVertexCount };
