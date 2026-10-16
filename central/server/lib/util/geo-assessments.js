// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { createHash } = require('node:crypto');
const { UUID_PATTERN } = require('./claim-versioning');
const Problem = require('./problem');
const imagery = require('./imagery');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const exact = (body, keys) => body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === keys.length && keys.every(key => Object.hasOwn(body, key));
const validHash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const text = (value, min = 10, max = 2000) => typeof value === 'string' && value.trim().length >= min && value.length <= max;
const safeUrl = value => {
  if (typeof value !== 'string' || value.length > 2048 || value !== value.trim() || [...value].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) return null;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
};
const config = () => {
  const raw = process.env.FIELD_DATA_STAC_URL || 'https://earth-search.aws.element84.com/v1';
  const url = safeUrl(raw); const parsed = url && new URL(url);
  return { enabled: process.env.FIELD_DATA_IMAGERY_ENABLED === 'true', catalogue: parsed && !parsed.search && !parsed.hash ? url.replace(/\/+$/, '') : null };
};
const checked = body => {
  const invalid = () => { throw Problem.user.geoAssessmentInvalid(); };
  if (!exact(body, ['requestId', 'revision', 'sourceFingerprint', 'outcome', 'claim', 'reason', 'limitations', 'citation', 'reviewedImage']) ||
      !UUID_PATTERN.test(body.requestId ?? '') || !Number.isInteger(body.revision) || body.revision < 0 || body.revision > 50 || !validHash(body.sourceFingerprint) ||
      !['supports', 'conflicts', 'unclear', 'unavailable'].includes(body.outcome) || !text(body.claim) || !text(body.reason) || !text(body.limitations) || typeof body.reviewedImage !== 'boolean') return invalid();
  let citation = null;
  if (body.citation != null) {
    const c = body.citation;
    if (c.kind === 'reference' && exact(c, ['kind', 'title', 'url', 'date'])) {
      if (!text(c.title, 1, 300) || !safeUrl(c.url) || typeof c.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(c.date) ||
          !Number.isFinite(Date.parse(c.date)) || new Date(c.date).toISOString().slice(0, 10) !== c.date || c.date < '1900-01-01' || c.date > new Date().toISOString().slice(0, 10)) return invalid();
      citation = { kind: 'reference', title: c.title.trim(), url: safeUrl(c.url), date: c.date };
    } else if (c.kind === 'catalogue' && exact(c, ['kind', 'sceneId', 'sceneFingerprint', 'url'])) {
      if (!text(c.sceneId, 1, 300) || !validHash(c.sceneFingerprint) || (c.url !== null && !safeUrl(c.url))) return invalid();
      citation = { kind: 'catalogue', sceneId: c.sceneId, sceneFingerprint: c.sceneFingerprint, url: c.url === null ? null : safeUrl(c.url) };
    } else return invalid();
  }
  if (body.citation === undefined || (body.outcome === 'unavailable' && (citation !== null || body.reviewedImage)) ||
      (['supports', 'conflicts'].includes(body.outcome) && (!body.reviewedImage || !citation?.url)) ||
      (body.reviewedImage && !citation?.url) || (citation?.url && !body.reviewedImage)) return invalid();
  return { requestId: body.requestId, revision: body.revision, sourceFingerprint: body.sourceFingerprint,
    outcome: body.outcome, claim: body.claim.trim(), reason: body.reason.trim(), limitations: body.limitations.trim(), citation, reviewedImage: body.reviewedImage };
};
const scene = (raw, catalogue) => {
  if (!raw || !text(raw.id, 1, 300) || typeof raw.at !== 'string' || !Number.isFinite(Date.parse(raw.at)) ||
      (raw.cloud !== null && (typeof raw.cloud !== 'number' || !Number.isFinite(raw.cloud) || raw.cloud < 0 || raw.cloud > 100))) return null;
  const result = { catalogue, collection: imagery.COLLECTION, id: raw.id, at: new Date(raw.at).toISOString(), cloud: raw.cloud };
  return { ...result, fingerprint: hash(result), metadataUrl: `${catalogue}/collections/${imagery.COLLECTION}/items/${encodeURIComponent(raw.id)}` };
};
const catalogue = (row, source, setup) => {
  const base = { enabled: setup.enabled, url: setup.catalogue, collection: imagery.COLLECTION, cellDegrees: imagery.CELL_DEGREES, windowDays: imagery.WINDOW_DAYS,
    status: source.encrypted ? 'encrypted' : !source.location ? 'no-location' : !setup.catalogue ? 'not-configured' : !row ? 'not-checked' : 'complete',
    checkedAt: row?.fetchedAt ?? null, stale: row != null && Date.now() - Date.parse(row.fetchedAt) > 7 * 86400000, scenes: [], omitted: 0 };
  if (base.status !== 'complete') return base;
  if (!Array.isArray(row.scenes) || row.scenes.length > 1000 || !imagery.complete(row.scenes.length, row.matched)) return { ...base, status: 'incomplete' };
  const scenes = row.scenes.map(raw => scene(raw, setup.catalogue));
  if (scenes.some(item => item == null) || new Set(scenes.map(item => item.id)).size !== scenes.length) return { ...base, status: 'invalid-cache' };
  const window = imagery.windowAround(new Date(source.visitAt));
  if (scenes.some(item => Date.parse(item.at) < Date.parse(window.from) || Date.parse(item.at) > Date.parse(window.to) || Date.parse(item.at) > Date.now())) return { ...base, status: 'invalid-cache' };
  scenes.sort((a, b) => Math.abs(Date.parse(a.at) - Date.parse(source.visitAt)) - Math.abs(Date.parse(b.at) - Date.parse(source.visitAt)) || a.id.localeCompare(b.id));
  return { ...base, scenes, omitted: Math.max(0, scenes.length - 50) };
};
const present = (row, source, cache, latest) => {
  const sourceCurrent = row.sourceFingerprint === source.fingerprint;
  const citationStatus = row.citation?.kind === 'catalogue' ? cache.status === 'complete' && cache.scenes.some(s => s.id === row.citation.sceneId && s.fingerprint === row.citation.sceneFingerprint)
    ? 'catalogue-current' : 'catalogue-changed' : row.citation ? 'reviewer-reference' : 'none';
  const bindingCurrent = sourceCurrent && citationStatus !== 'catalogue-changed';
  return { id: row.id, sequence: row.sequence, source: row.source, sourceFingerprint: row.sourceFingerprint,
    actorId: row.actorId, actorName: row.actorName, outcome: row.outcome, claim: row.claim, reason: row.reason, limitations: row.limitations,
    citation: row.citation, reviewedImage: row.reviewedImage, reviewedAt: row.reviewedAt, sourceCurrent, citationStatus, bindingCurrent,
    state: !bindingCurrent ? 'outdated' : row.sequence === latest ? 'current' : 'superseded' };
};
module.exports = { hash, exact, validHash, safeUrl, config, checked, scene, catalogue, present };
