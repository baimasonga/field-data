import L from 'leaflet';

// Identify the application to OSM without disclosing project paths or queries.
// Do not proxy, prefetch, or automatically retry rejected tile requests.
export const addBasemap = (map, onUnavailable, options = {}) => {
  const layer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    ...options,
    referrerPolicy: 'strict-origin',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  });
  let failed = false;
  layer.on('tileerror', () => {
    if (failed) return;
    failed = true;
    layer.remove();
    onUnavailable();
  });
  return layer.addTo(map);
};

export const hasLocation = row => Number.isFinite(row.lat) && Number.isFinite(row.lng) &&
  Math.abs(row.lat) <= 90 && Math.abs(row.lng) <= 180;
