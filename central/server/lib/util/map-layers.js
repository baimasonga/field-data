// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { invalid } = require('./analysis-data');
const MAX_BYTES = 2 * 1024 * 1024;
const color = v => /^#[0-9a-f]{6}$/i.test(v);
const normalizeLayer = (input) => {
  const data = input?.data;
  if (Buffer.byteLength(JSON.stringify(data) || '') > MAX_BYTES) throw invalid('data', null, 'GeoJSON exceeds 2 MB.');
  if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features) || data.features.length > 5000)
    throw invalid('data', null, 'Use a FeatureCollection with at most 5000 features.');
  if (data.crs != null) throw invalid('crs', null, 'Use WGS84 longitude/latitude without a CRS declaration.');
  let vertices = 0; const extent = [Infinity, Infinity, -Infinity, -Infinity];
  const position = (p) => {
    vertices += 1;
    if (vertices > 50000 || !Array.isArray(p) || p.length < 2 || p.length > 3 || !p.every(Number.isFinite)
      || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90) throw invalid('coordinates', null, 'Invalid WGS84 coordinates or more than 50000 vertices.');
    extent[0] = Math.min(extent[0], p[0]); extent[1] = Math.min(extent[1], p[1]); extent[2] = Math.max(extent[2], p[0]); extent[3] = Math.max(extent[3], p[1]);
  };
  const line = points => { if (!Array.isArray(points) || points.length < 2) throw invalid('geometry', null, 'A line requires at least two points.'); points.forEach(position); };
  const polygon = rings => { if (!Array.isArray(rings) || !rings.length) throw invalid('geometry', null, 'A polygon requires rings.'); rings.forEach(r => { line(r); if (r.length < 4 || r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1]) throw invalid('geometry', null, 'Polygon rings must be closed.'); }); };
  const geometry = g => {
    if (!g || !Array.isArray(g.coordinates)) throw invalid('geometry', null, 'Geometry is required.');
    const types = { Point: position, MultiPoint: p => p.forEach(position), LineString: line, MultiLineString: p => p.forEach(line), Polygon: polygon, MultiPolygon: p => p.forEach(polygon) };
    if (!types[g.type]) throw invalid('geometry', null, 'Unsupported geometry type.');
    types[g.type](g.coordinates);
  };
  const fields = new Set();
  const features = data.features.map((f) => {
    if (f?.type !== 'Feature') throw invalid('feature', null, 'Use GeoJSON features.');
    geometry(f.geometry);
    const properties = {};
    for (const [k, v] of Object.entries(f.properties || {})) {
      if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(k) || ['__proto__', 'constructor', 'prototype'].includes(k)
        || !(v == null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length <= 500)))
        throw invalid('properties', null, 'Properties must have safe names and scalar values of at most 500 characters.');
      fields.add(k); properties[k] = v;
    }
    return { type: 'Feature', geometry: { type: f.geometry.type, coordinates: f.geometry.coordinates }, properties };
  });
  const style = input.style || { mode: 'single', color: '#137d92' };
  if (!['single', 'categorical', 'numeric'].includes(style.mode) || !color(style.color || '#137d92') || !color(style.missingColor || '#777777')) throw invalid('style', null, 'Use supported styling and six-digit hex colors.');
  if (style.mode !== 'single' && !fields.has(style.property)) throw invalid('style.property', style.property, 'Choose an uploaded property.');
  let bins = [];
  if (style.mode === 'numeric') {
    bins = style.bins;
    if (!Array.isArray(bins) || bins.length < 1 || bins.length > 12 || bins.some((b, i) => !Number.isFinite(b.max) || !color(b.color) || (i > 0 && bins[i - 1].max >= b.max))) throw invalid('bins', null, 'Use 1–12 fixed, increasing numeric upper bounds and colors.');
  }
  const categories = style.categories || [];
  if (style.mode === 'categorical' && (!Array.isArray(categories) || categories.length > 30 || categories.some(c => typeof c.value !== 'string' || c.value.length > 500 || !color(c.color)))) throw invalid('categories', null, 'Use at most 30 named categories with colors.');
  const title = String(input.title || '').trim();
  if (!title || title.length > 255) throw invalid('title', null, 'Use a title of 1–255 characters.');
  return { data: { type: 'FeatureCollection', features }, definition: { version: 1, sourceType: 'geojson-upload', extent: vertices ? extent : null, crs: 'WGS84', visible: input.visible !== false, attribution: String(input.attribution || '').slice(0, 500), style: { mode: style.mode, property: style.property || null, color: style.color || '#137d92', missingColor: style.missingColor || '#777777', bins, categories, units: String(style.units || '').slice(0, 50) } }, title };
};
module.exports = { normalizeLayer, MAX_BYTES };
