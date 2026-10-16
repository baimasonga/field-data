// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const geo = require('../../../lib/util/geo-assessments');
const setup = { enabled: false, catalogue: 'https://catalogue.example.test/v1' };
const source = { fingerprint: 'a'.repeat(64), location: { latitude: 8.48, longitude: -13.23 }, visitAt: '2026-09-20T10:30:00.000Z' };
const scene = { id: 'scene/one', at: '2026-09-18T12:00:00Z', cloud: null };
const body = () => ({ requestId: randomUUID(), revision: 0, sourceFingerprint: source.fingerprint, outcome: 'supports', claim: 'A structure exists at this reported location.', reason: 'The feature is visible in dated imagery.', limitations: 'The receipt time is not a verified visit time.', reviewedImage: true,
  citation: { kind: 'reference', title: 'Dated public imagery', url: 'https://images.example.test/scene', date: '2026-09-18' } });
describe('geospatial assessment contract', () => {
  it('canonicalizes normalized retries independently of JSON field order', () => {
    const original = body(); const reversed = Object.fromEntries(Object.entries(original).reverse()); reversed.citation = Object.fromEntries(Object.entries(original.citation).reverse());
    assert.equal(geo.hash(geo.checked(original)), geo.hash(geo.checked(reversed)));
    assert.equal(geo.checked({ ...original, reason: ` ${original.reason} ` }).reason, original.reason);
  });
  it('rejects unsafe references, impossible/future dates and unknown fields', () => {
    assert.equal(geo.safeUrl('https://secret@images.example.test/a'), null); assert.equal(geo.safeUrl('data:text/html,test'), null);
    for (const citation of [{ ...body().citation, date: '2026-02-30' }, { ...body().citation, date: '2999-01-01' }, { ...body().citation, extra: true }]) assert.throws(() => geo.checked({ ...body(), citation }));
  });
  it('requires image attestation for positive outcomes while allowing metadata-only uncertainty', () => {
    const citation = { kind: 'catalogue', sceneId: scene.id, sceneFingerprint: 'b'.repeat(64), url: null };
    assert.throws(() => geo.checked({ ...body(), citation, reviewedImage: false }));
    assert.equal(geo.checked({ ...body(), outcome: 'unclear', citation, reviewedImage: false }).reviewedImage, false);
    assert.equal(geo.checked({ ...body(), outcome: 'unavailable', citation: null, reviewedImage: false }).citation, null);
    assert.throws(() => geo.checked({ ...body(), outcome: 'unavailable' }));
  });
  it('retains unknown cloud, encoded references and completeness/staleness distinctions', () => {
    const cache = geo.catalogue({ scenes: [scene], matched: 1, fetchedAt: '2026-01-01T00:00:00Z' }, source, setup);
    assert.equal(cache.status, 'complete'); assert.equal(cache.stale, true); assert.equal(cache.scenes[0].cloud, null);
    assert.match(cache.scenes[0].metadataUrl, /scene%2Fone$/); assert.equal(cache.enabled, false);
    assert.equal(geo.catalogue({ scenes: [scene], matched: 2 }, source, setup).status, 'incomplete');
    assert.equal(geo.catalogue({ scenes: [{ ...scene, cloud: 101 }], matched: 1 }, source, setup).status, 'invalid-cache');
    assert.equal(geo.catalogue(null, { ...source, location: null }, setup).status, 'no-location');
    assert.equal(geo.catalogue({ scenes: [{ ...scene, at: '2025-01-01T00:00:00Z' }], matched: 1 }, source, setup).status, 'invalid-cache');
  });
  it('distinguishes current, superseded, changed catalogue and unmonitored external references', () => {
    const cache = geo.catalogue({ scenes: [scene], matched: 1 }, source, setup);
    const row = { id: randomUUID(), sequence: 1, sourceFingerprint: source.fingerprint, citation: { kind: 'catalogue', sceneId: scene.id, sceneFingerprint: cache.scenes[0].fingerprint } };
    assert.equal(geo.present(row, source, cache, 1).state, 'current'); assert.equal(geo.present(row, source, cache, 2).state, 'superseded');
    assert.equal(geo.present(row, source, { status: 'incomplete', scenes: [] }, 1).state, 'outdated');
    assert.equal(geo.present(row, { ...source, fingerprint: 'c'.repeat(64) }, cache, 1).sourceCurrent, false);
    assert.equal(geo.present({ ...row, citation: body().citation }, source, { status: 'not-checked', scenes: [] }, 1).citationStatus, 'reviewer-reference');
  });
  it('orders nearest candidates deterministically and reports omissions without truncating server history matching', () => {
    const scenes = Array.from({ length: 55 }, (_, i) => ({ id: `scene-${i}`, at: '2026-09-18T12:00:00Z', cloud: null }));
    const cache = geo.catalogue({ scenes, matched: 55 }, source, setup); assert.equal(cache.scenes.length, 55); assert.equal(cache.omitted, 5);
    assert.equal(geo.catalogue({ scenes: [scene, scene], matched: 2 }, source, setup).status, 'invalid-cache');
  });
});
