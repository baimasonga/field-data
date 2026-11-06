// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { sql } = require('slonik');
const { UUID_PATTERN } = require('./claim-versioning');
const geo = require('./geo-assessments');
const footprints = require('./imagery-footprints');
const imagery = require('./imagery');
const Problem = require('./problem');
const METHOD = 'sentinel2-red-nir-scl-change@1';
const invalid = () => Problem.user.geoAssessmentInvalid();
const enabled = () => process.env.FIELD_DATA_GEOSPATIAL_ENABLED !== 'false';
const checked = body => {
  if (!geo.exact(body, ['requestId', 'sourceFingerprint', 'mode', 'beforeId', 'beforeFingerprint', 'afterId', 'afterFingerprint', 'allowExternalProcessing']) ||
    !UUID_PATTERN.test(body.requestId ?? '') || !geo.validHash(body.sourceFingerprint) || !['footprint', 'change'].includes(body.mode) || body.allowExternalProcessing !== true ||
    typeof body.beforeId !== 'string' || !body.beforeId.length || body.beforeId.length > 300 || !geo.validHash(body.beforeFingerprint) ||
    (body.mode === 'footprint' ? body.afterId !== null || body.afterFingerprint !== null : typeof body.afterId !== 'string' || !body.afterId.length || body.afterId.length > 300 || !geo.validHash(body.afterFingerprint))) throw invalid();
  return { requestId: body.requestId, sourceFingerprint: body.sourceFingerprint, mode: body.mode, beforeId: body.beforeId,
    beforeFingerprint: body.beforeFingerprint, afterId: body.afterId, afterFingerprint: body.afterFingerprint, allowExternalProcessing: true };
};
const checkedReview = body => {
  if (!geo.exact(body, ['requestId', 'revision', 'candidateId', 'action', 'reason', 'reviewedImages']) || !UUID_PATTERN.test(body.requestId ?? '') ||
    !Number.isInteger(body.revision) || body.revision < 0 || body.revision >= 50 || !Number.isInteger(body.candidateId) || body.candidateId < 1 || body.candidateId > 20 ||
    !['approve', 'reject', 'unclear'].includes(body.action) || typeof body.reason !== 'string' || body.reason.trim().length < 10 || body.reason.length > 2000 || body.reviewedImages !== true) throw invalid();
  return { requestId: body.requestId, revision: body.revision, candidateId: body.candidateId, action: body.action, reason: body.reason.trim(), reviewedImages: true };
};
const jsonFrom = async (url, options = {}, limit = 524288, timeout = 20000) => {
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(timeout) });
  if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error('provider-or-analysis-unavailable'); }
  const chunks = []; let bytes = 0;
  for await (const chunk of response.body) { bytes += chunk.length; if (bytes > limit) { await response.body.cancel().catch(() => {}); throw new Error('oversized-provider-output'); } chunks.push(Buffer.from(chunk)); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};
const asset = (raw, name) => {
  try {
    const url = new URL(raw?.href);
    if (url.protocol !== 'https:' || url.host !== 'sentinel-cogs.s3.us-west-2.amazonaws.com' || url.username || url.password || url.search || url.hash ||
      !url.pathname.startsWith('/sentinel-s2-l2a-cogs/') || !/^[A-Za-z0-9_./-]+\.tif$/.test(url.pathname) || url.pathname.includes('..')) return null;
    const band = raw['raster:bands']?.[0]; const scale = name === 'scl' ? 1 : band?.scale; const offset = name === 'scl' ? 0 : band?.offset;
    if (typeof scale !== 'number' || !Number.isFinite(scale) || typeof offset !== 'number' || !Number.isFinite(offset) ||
      (name !== 'scl' && (!(scale > 0 && scale <= 0.01) || Math.abs(offset) > 1))) return null;
    return { url: url.href, scale, offset };
  } catch { return null; }
};
const providerScene = async (selected, source, catalogue) => {
  const url = `${catalogue}/collections/${imagery.COLLECTION}/items/${encodeURIComponent(selected.id)}`;
  const raw = await jsonFrom(url, {}, 524288, 15000); const at = raw?.properties?.datetime;
  const cloud = Number.isFinite(raw?.properties?.['eo:cloud_cover']) ? Math.round(raw.properties['eo:cloud_cover'] * 10) / 10 : null;
  const identity = geo.scene({ id: raw?.id, at, cloud }, catalogue);
  if (raw?.type !== 'Feature' || raw.collection !== imagery.COLLECTION || !identity || identity.fingerprint !== selected.fingerprint || Date.parse(at) > Date.now()) throw new Error('provider-scene-changed-or-invalid');
  const geometry = footprints.geometryFor(raw.geometry);
  const assets = Object.fromEntries(['red', 'nir', 'scl'].map(name => [name, asset(raw.assets?.[name], name)]));
  const metadata = { id: identity.id, at: identity.at, cloud, catalogue, collection: imagery.COLLECTION, geometry, assets,
    sunElevation: typeof raw.properties['view:sun_elevation'] === 'number' ? raw.properties['view:sun_elevation'] : null };
  return { ...metadata, fingerprint: geo.hash(metadata), metadataUrl: url, fetchedAt: new Date().toISOString(), coverage: footprints.coverage(geometry, source.location) };
};
const validRaster = result => result?.method === METHOD && ['withheld', 'analysed'].includes(result.status) &&
  (result.status === 'withheld' ? typeof result.reason === 'string' && result.reason.length <= 100 :
    result.grid?.width === 32 && result.grid?.height === 32 && result.grid?.resolutionM === 10 && typeof result.grid.crs === 'string' &&
    Array.isArray(result.candidates) && result.candidates.length <= 20 && result.candidates.every((item, i) => item.id === i + 1 &&
      ['vegetation-loss', 'vegetation-gain', 'surface-reflectance-change'].includes(item.kind) && Number.isInteger(item.pixels) && item.pixels >= 4 && item.pixels <= 1024 &&
      item.areaM2 === item.pixels * 100 && Array.isArray(item.cells) && item.cells.length === item.pixels && item.cells.every(cell => Number.isInteger(cell) && cell >= 0 && cell < 1024) &&
      !!footprints.geometryFor(item.geometry)) && [result.before, result.after].every(scene => geo.validHash(scene?.sampleSha256) &&
        typeof scene.previewPng === 'string' && scene.previewPng.length < 65536 && /^[A-Za-z0-9+/=]+$/.test(scene.previewPng) &&
        ['red', 'nir'].every(name => Array.isArray(scene.pixels?.[name]) && scene.pixels[name].length === 1024 && scene.pixels[name].every(value => value === null || Number.isFinite(value)))));
const raster = async (source, before, after) => {
  if (Object.values(before.assets).some(value => !value) || Object.values(after.assets).some(value => !value)) return { status: 'withheld', reason: 'unsupported-or-uncalibrated-assets', method: METHOD };
  const result = await jsonFrom('http://127.0.0.1:5001/api/v1/geo/analyse', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ location: source.location, before: { assets: before.assets }, after: { assets: after.assets } }) }, 524288, 85000);
  if (!validRaster(result)) throw new Error('invalid-raster-result'); return result;
};
const history = (db, submissionId) => db.any(sql`SELECT a.* FROM field_data_geo_analyses a JOIN submission_defs sd ON sd.id=a."submissionDefId"
  WHERE sd."submissionId"=${submissionId} ORDER BY a."createdAt" DESC,a.id DESC LIMIT 20`);
const reviewsFor = (db, id) => db.any(sql`SELECT * FROM field_data_geo_candidate_reviews WHERE "analysisId"=${id} ORDER BY sequence DESC LIMIT 50`);
const present = (row, source, catalogue, reviews = []) => ({ id: row.id, requestId: row.requestId, source: row.source, sourceFingerprint: row.sourceFingerprint,
  mode: row.mode, actorName: row.actorName, createdAt: row.createdAt, completedAt: row.completedAt, result: row.result, failure: row.failure,
  status: row.status === 'pending' && Date.now() - Date.parse(row.createdAt) > 180000 ? 'expired' : row.status,
  sourceCurrent: row.sourceFingerprint === source.fingerprint && row.catalogue === catalogue,
  revision: reviews[0]?.sequence ?? 0, reviews: reviews.map(({ requestHash, ...review }) => review) });
module.exports = { METHOD, enabled, checked, checkedReview, jsonFrom, providerScene, raster, validRaster, history, reviewsFor, present };
