// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
// Provider URLs contain only the destination, never field keys or task metadata.
const stopNavigation = (itinerary, stop, now = new Date()) => {
  const { latitude, longitude, accuracy } = stop.location ?? {};
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || (latitude === 0 && longitude === 0)) return null;
  const google = new URL('https://www.google.com/maps/dir/');
  google.search = new URLSearchParams({ api: '1', destination: `${latitude},${longitude}` }).toString();
  const osm = new URL('https://www.openstreetmap.org/');
  osm.search = new URLSearchParams({ mlat: String(latitude), mlon: String(longitude) }).toString();
  osm.hash = `map=16/${latitude}/${longitude}`;
  return { itineraryId: itinerary.id, stopId: stop.id, kind: stop.kind, checkedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60000).toISOString(),
    location: { latitude, longitude, accuracy: Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null },
    targets: [{ id: 'google-maps', label: 'Directions in Google Maps', url: google.toString() },
      { id: 'openstreetmap', label: 'View location on OpenStreetMap', url: osm.toString() }] };
};
module.exports = { stopNavigation };
