// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const radians = degrees => (degrees * Math.PI) / 180;
const distanceKm = (a, b) => {
  const h = Math.sin(radians(b.latitude - a.latitude) / 2) ** 2
    + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(radians(b.longitude - a.longitude) / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
};
// A deterministic nearest-next-stop heuristic, returning to the depot. Not a
// road route or a claim of optimality; exact distances are rounded only at output.
const itinerary = (start, visits) => {
  const remaining = [...visits]; const stops = []; let previous = start; let total = 0;
  while (remaining.length) {
    const origin = previous;
    remaining.sort((a, b) => distanceKm(origin, a.location) - distanceKm(origin, b.location) || a.id.localeCompare(b.id));
    const next = remaining.shift(); const leg = distanceKm(previous, next.location);
    total += leg; stops.push({ ...next, order: stops.length + 1, legKm: Math.round(leg * 100) / 100 }); previous = next.location;
  }
  const back = stops.length ? distanceKm(previous, start) : 0;
  return { stops, distanceKm: Math.round((total + back) * 100) / 100, returnKm: Math.round(back * 100) / 100 };
};
const orderedItinerary = (start, visits) => {
  let previous = start; let total = 0;
  const stops = visits.map((visit, i) => {
    const leg = distanceKm(previous, visit.location); total += leg; previous = visit.location;
    return { ...visit, order: i + 1, legKm: Math.round(leg * 100) / 100 };
  });
  const back = stops.length ? distanceKm(previous, start) : 0;
  return { stops, distanceKm: Math.round((total + back) * 100) / 100, returnKm: Math.round(back * 100) / 100 };
};
module.exports = { distanceKm, itinerary, orderedItinerary };
