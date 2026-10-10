// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
//
// Satellite imagery availability (G1b): which Sentinel-2 scenes cover a place
// around a date, from an open STAC catalogue. Nothing here downloads or
// interprets imagery, and nothing exact about a respondent leaves the server:
// a lookup sends the centre of a 0.05° grid cell and whole days.
//
// Contract: docs/field-intelligence/G1b-imagery-availability.md

const CELL_DEGREES = 0.05;
const WINDOW_DAYS = 30;
const COLLECTION = 'sentinel-2-l2a';
const CLEAR = 30; // cloud cover (%) under which a scene counts as usable in the summary
const DAY_MS = 24 * 60 * 60 * 1000;

// The grid cell holding a point, as its centre, rounded so the same cell
// always gives the same text (and cache key).
const cellOf = (lat, lon) => {
  const centre = (v) => Number(((Math.floor(v / CELL_DEGREES) + 0.5) * CELL_DEGREES).toFixed(3));
  return { lat: centre(lat), lon: centre(lon), key: `${centre(lat).toFixed(3)},${centre(lon).toFixed(3)}` };
};

// The whole days from `days` before to `days` after a moment (UTC).
const windowAround = (at, days = WINDOW_DAYS) => {
  const day = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
  const from = new Date(day - days * DAY_MS);
  const to = new Date(day + (days + 1) * DAY_MS - 1000);
  return { from: from.toISOString().replace('.000', ''), to: to.toISOString().replace('.000', ''), day: new Date(day).toISOString().slice(0, 10) };
};

// The STAC item search for a cell and window: only the fields needed.
const searchBody = (cell, window) => ({
  collections: [COLLECTION],
  intersects: { type: 'Point', coordinates: [cell.lon, cell.lat] },
  datetime: `${window.from}/${window.to}`,
  limit: 100,
  fields: { include: ['id', 'properties.datetime', 'properties.eo:cloud_cover', 'collection'], exclude: ['assets', 'links', 'geometry', 'bbox'] }
});

// Scenes from a search answer, each { id, at, cloud }, oldest first. Items
// without a usable date are dropped; an unknown cloud cover stays null.
const scenesOf = (answer) => {
  const features = Array.isArray(answer?.features) ? answer.features : [];
  return features
    .map((f) => ({ id: String(f?.id ?? ''), at: new Date(f?.properties?.datetime), cloud: Number.isFinite(f?.properties?.['eo:cloud_cover']) ? Math.round(f.properties['eo:cloud_cover'] * 10) / 10 : null }))
    .filter((s) => s.id !== '' && Number.isFinite(s.at.getTime()))
    .sort((a, b) => a.at - b.at);
};

// What a reviewer needs for one visit: how many scenes, the one nearest the
// visit, the clearest one, and how many are under the clear threshold.
const summarize = (scenes, visit) => {
  const brief = (s) => (s == null ? null : { id: s.id, date: s.at.toISOString().slice(0, 10), cloud: s.cloud, daysFromVisit: Math.round((s.at - visit) / DAY_MS) });
  const nearest = scenes.reduce((best, s) => (best == null || Math.abs(s.at - visit) < Math.abs(best.at - visit) ? s : best), null);
  const known = scenes.filter((s) => s.cloud != null);
  const clearest = known.reduce((best, s) => (best == null || s.cloud < best.cloud || (s.cloud === best.cloud && Math.abs(s.at - visit) < Math.abs(best.at - visit)) ? s : best), null);
  return {
    scenes: scenes.length,
    clear: known.filter((s) => s.cloud < CLEAR).length,
    nearest: brief(nearest),
    clearest: brief(clearest)
  };
};

// One catalogue request with a timeout. `fetchImpl` is injectable for tests.
// Resolves { ok: true, scenes } or { ok: false, reason }; never throws.
const lookup = async (catalogueUrl, cell, window, { fetchImpl = fetch, timeoutMs = 15000 } = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${catalogueUrl.replace(/\/+$/, '')}/search`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/geo+json' },
      body: JSON.stringify(searchBody(cell, window)), signal: controller.signal
    });
    if (!response.ok) return { ok: false, reason: `catalogue answered ${response.status}` };
    const answer = await response.json();
    if (!Array.isArray(answer?.features)) return { ok: false, reason: 'catalogue answer was not a search result' };
    return { ok: true, scenes: scenesOf(answer), matched: Number.isFinite(answer.numberMatched) ? answer.numberMatched : null };
  } catch (error) {
    return { ok: false, reason: error.name === 'AbortError' ? 'catalogue did not answer in time' : 'catalogue could not be reached' };
  } finally {
    clearTimeout(timer);
  }
};

module.exports = { CELL_DEGREES, WINDOW_DAYS, COLLECTION, CLEAR, cellOf, windowAround, searchBody, scenesOf, summarize, lookup };
