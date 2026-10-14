// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
export const checkedLocation = value => {
  const keys = ['source', 'latitude', 'longitude', 'accuracy', 'sampledAt', 'capturedAt'];
  const iso = text => typeof text === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(text) && Number.isFinite(Date.parse(text)) && new Date(text).toISOString() === text;
  if (!value || typeof value !== 'object' || Object.keys(value).length !== keys.length || Object.keys(value).some(k => !keys.includes(k)) ||
    value.source !== 'browser-geolocation' || !Number.isFinite(value.latitude) || Math.abs(value.latitude) > 90 ||
    !Number.isFinite(value.longitude) || Math.abs(value.longitude) > 180 || !Number.isFinite(value.accuracy) || value.accuracy < 0 || value.accuracy > 100000 ||
    !iso(value.sampledAt) || !iso(value.capturedAt) || Date.parse(value.capturedAt) < Date.parse(value.sampledAt) || Date.parse(value.capturedAt) - Date.parse(value.sampledAt) > 60000) throw new Error('Invalid capture location');
  return Object.fromEntries(keys.map(key => [key, value[key]]));
};
export const sameLocation = (a, b) => (a == null && b == null) || (a != null && b != null && JSON.stringify(checkedLocation(a)) === JSON.stringify(checkedLocation(b)));
