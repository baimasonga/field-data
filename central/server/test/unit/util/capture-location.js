// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const assert = require('node:assert/strict');
const { checkedLocation } = require('../../../lib/util/capture-location');
const reading = patch => ({ source: 'browser-geolocation', latitude: 0, longitude: 0, accuracy: 0,
  sampledAt: '2026-10-14T11:00:00.000Z', capturedAt: '2026-10-14T11:01:00.000Z', ...patch });
describe('capture location structure (client assertions, not presence proof)', () => {
  it('accepts zero values, coordinate boundaries and exactly sixty seconds, with canonical field ordering', () => {
    const sample = reading({ latitude: -90, longitude: 180, accuracy: 100000 });
    assert.deepEqual(checkedLocation(Object.fromEntries(Object.entries(sample).reverse())), sample);
    assert.deepEqual(checkedLocation(reading()), reading());
  });
  it('rejects nonfinite values, invalid timestamps, reversed times, oversize accuracy and extra sensor data', () => {
    for (const patch of [{ latitude: NaN }, { longitude: Infinity }, { accuracy: Infinity }, { latitude: 90.1 }, { longitude: 180.1 },
      { accuracy: 100001 }, { sampledAt: '2026-02-30T11:00:00.000Z' }, { capturedAt: '2026-10-14T11:01:00.001Z' },
      { capturedAt: '2026-10-14T10:59:59.999Z' }, { altitude: 123 }, { capturedAt: 123 }]) assert.throws(() => checkedLocation(reading(patch)), error => error.problemCode === 400.65);
  });
});
