// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
// Operator-controlled OSRM endpoint: never send coordinates to a public default.
const estimate = async (start, stops, { baseUrl = process.env.FIELD_DATA_OSRM_URL, fetcher = fetch } = {}, optimize = false) => {
  if (!baseUrl) return { status: 'disabled' };
  let base;
  try {
    base = new URL(baseUrl);
    if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error();
  } catch { return { status: 'misconfigured' }; }
  if (stops.length > 98) return { status: 'tooManyStops' };
  if (stops.length === 0) return { status: 'ok', distanceKm: 0, travelMinutes: 0, legs: [], maxSnapMeters: 0, ...(optimize ? { order: [] } : {}) };
  const points = [start, ...stops.map(s => s.location), ...(optimize ? [] : [start])];
  const coordinates = points.map(p => `${p.longitude},${p.latitude}`).join(';');
  const url = new URL(`${base.pathname.replace(/\/$/, '')}/${optimize ? 'trip' : 'route'}/v1/driving/${coordinates}`, base);
  url.search = optimize ? 'overview=false&steps=false&roundtrip=true&source=first' : 'overview=false&steps=false&alternatives=false';
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetcher(url, { signal: controller.signal, redirect: 'error' });
    if (!response.ok) return { status: 'unavailable' };
    // Stream with a bound: a malicious/misconfigured service cannot exhaust memory.
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 262144) { controller.abort(); return { status: 'invalidResponse' }; }
      chunks.push(Buffer.from(chunk));
    }
    let data;
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return { status: 'invalidResponse' }; }
    if (['NoRoute', 'NoSegment', 'NoTrips'].includes(data?.code)) return { status: 'unreachable' };
    const routes = optimize ? data?.trips : data?.routes;
    const route = routes?.[0];
    const finite = x => typeof x === 'number' && Number.isFinite(x) && x >= 0;
    if (data?.code !== 'Ok' || !finite(route?.distance) || !finite(route?.duration)
      || !Array.isArray(route.legs) || route.legs.length !== points.length - (optimize ? 0 : 1)
      || !route.legs.every(l => finite(l.distance) && finite(l.duration))
      || !Array.isArray(data.waypoints) || data.waypoints.length !== points.length
      || !data.waypoints.every(w => finite(w.distance))) return { status: 'invalidResponse' };
    let order;
    if (optimize) {
      const indices = data.waypoints.map(w => w.waypoint_index);
      if (routes.length !== 1 || indices[0] !== 0 || new Set(indices).size !== points.length
        || !data.waypoints.every(w => w.trips_index === 0 && Number.isInteger(w.waypoint_index) && w.waypoint_index >= 0 && w.waypoint_index < points.length))
        return { status: 'invalidResponse' };
      order = stops.map((_, i) => i).sort((a, b) => indices[a + 1] - indices[b + 1]);
    }
    const round = x => Math.round(x * 100) / 100;
    return { status: 'ok', ...(optimize ? { order } : {}), distanceKm: round(route.distance / 1000), travelMinutes: round(route.duration / 60),
      legs: route.legs.map(l => ({ distanceKm: round(l.distance / 1000), travelMinutes: round(l.duration / 60) })),
      maxSnapMeters: Math.max(...data.waypoints.map(w => w.distance)) };
  } catch { return { status: controller.signal.aborted ? 'timeout' : 'unavailable' }; } finally { clearTimeout(timer); }
};
const roadEstimate = (start, stops, options) => estimate(start, stops, options);
const roadOrder = (start, stops, options) => estimate(start, stops, options, true);
module.exports = { roadEstimate, roadOrder };
