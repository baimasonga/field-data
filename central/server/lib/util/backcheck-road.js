// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
// Operator-controlled OSRM endpoint: never send coordinates to a public default.
const roadEstimate = async (start, stops, { baseUrl = process.env.FIELD_DATA_OSRM_URL, fetcher = fetch } = {}) => {
  if (!baseUrl) return { status: 'disabled' };
  let base;
  try {
    base = new URL(baseUrl);
    if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error();
  } catch { return { status: 'misconfigured' }; }
  if (stops.length > 100) return { status: 'tooManyStops' };
  if (stops.length === 0) return { status: 'ok', distanceKm: 0, travelMinutes: 0, legs: [], maxSnapMeters: 0 };
  const points = [start, ...stops.map(s => s.location), start];
  const coordinates = points.map(p => `${p.longitude},${p.latitude}`).join(';');
  const url = new URL(`${base.pathname.replace(/\/$/, '')}/route/v1/driving/${coordinates}`, base);
  url.search = 'overview=false&steps=false&alternatives=false';
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
    if (data?.code === 'NoRoute' || data?.code === 'NoSegment') return { status: 'unreachable' };
    const route = data?.routes?.[0];
    const finite = x => typeof x === 'number' && Number.isFinite(x) && x >= 0;
    if (data?.code !== 'Ok' || !finite(route?.distance) || !finite(route?.duration)
      || !Array.isArray(route.legs) || route.legs.length !== points.length - 1
      || !route.legs.every(l => finite(l.distance) && finite(l.duration))
      || !Array.isArray(data.waypoints) || data.waypoints.length !== points.length
      || !data.waypoints.every(w => finite(w.distance))) return { status: 'invalidResponse' };
    const round = x => Math.round(x * 100) / 100;
    return { status: 'ok', distanceKm: round(route.distance / 1000), travelMinutes: round(route.duration / 60),
      legs: route.legs.map(l => ({ distanceKm: round(l.distance / 1000), travelMinutes: round(l.duration / 60) })),
      maxSnapMeters: Math.max(...data.waypoints.map(w => w.distance)) };
  } catch { return { status: controller.signal.aborted ? 'timeout' : 'unavailable' }; } finally { clearTimeout(timer); }
};
module.exports = { roadEstimate };
