// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { validateAreas } = require('./sampling-areas');
const { insidePolygon, distanceToBoundaryM } = require('./location-evidence');
const geometryFor = geometry => {
  const result = validateAreas([{ value: 'Image footprint', geometry }]);
  if (result.error) throw new Error('Use a valid bounded WGS84 Polygon or MultiPolygon without antimeridian crossings.');
  return result.areas[0].geometry;
};
const coverage = (geometry, location) => {
  if (!location) return { relation: 'unavailable', boundaryDistanceM: null, accuracyRelation: 'unknown' };
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const point = [location.longitude, location.latitude];
  const distance = distanceToBoundaryM(point, polygons);
  const relation = distance <= 0.001 ? 'boundary' : polygons.some(rings => insidePolygon(point, rings)) ? 'inside' : 'outside';
  const known = Number.isFinite(location.accuracy) && location.accuracy >= 0;
  return { relation, boundaryDistanceM: Math.round(distance * 100) / 100,
    accuracyRelation: !known ? 'unknown' : distance <= location.accuracy + 0.001 ? 'crosses-boundary' : relation === 'inside' ? 'contained' : 'outside' };
};
module.exports = { geometryFor, coverage };
