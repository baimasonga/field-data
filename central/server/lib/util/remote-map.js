// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const https = require('node:https');
const { resolveWebhookUrl } = require('./safe-webhook-url');
const { encryptSecret, decryptSecret } = require('./field-data-secret');
const { invalid } = require('./analysis-data');
const normalizeRemote = async body => {
  const title = String(body.title || '').trim(); const { sourceType } = body;
  if (!title || title.length > 255 || !['wms', 'tiles'].includes(sourceType)) throw invalid('layer', null, 'Supply a title and WMS or tile source.');
  const template = String(body.url || '');
  if (template.length > 2000) throw invalid('url', null, 'URL exceeds 2000 characters.');
  let resolved;
  try { resolved = await resolveWebhookUrl(template.replaceAll('{z}', '0').replaceAll('{x}', '0').replaceAll('{y}', '0')); } catch { throw invalid('url', null, 'Use a reachable public HTTPS map provider; private and reserved addresses are blocked.'); }
  if (resolved.url.protocol !== 'https:' || resolved.url.hash || [...resolved.url.searchParams.keys()].some(k => /token|secret|password|key|signature/i.test(k))) throw invalid('url', null, 'Use a public HTTPS URL; put credentials in the authorization field.');
  if (sourceType === 'tiles' && !['{z}', '{x}', '{y}'].every(key => template.includes(key))) throw invalid('url', null, 'Tile URLs need {z}, {x}, and {y}.');
  const layers = String(body.layers || '');
  if (sourceType === 'wms' && !/^[A-Za-z0-9_.:, -]{1,500}$/.test(layers)) throw invalid('layers', null, 'Supply WMS layer names.');
  const attribution = String(body.attribution || '').trim(); if (!attribution || attribution.length > 500) throw invalid('attribution', null, 'Supply the map provider attribution.');
  const authorization = String(body.authorization || '');
  if (authorization && (!/^(Bearer|Basic) [A-Za-z0-9._~+/=:-]+$/.test(authorization) || authorization.length > 4000)) throw invalid('authorization', null, 'Use a Bearer or Basic authorization header.');
  return { title, definition: { version: 1, sourceType, visible: true, attribution, layers }, remoteConfig: encryptSecret(JSON.stringify({ url: template, authorization })) };
};
const remoteTile = async (row, query) => {
  const { url: template, authorization } = JSON.parse(decryptSecret(row.remoteConfig));
  const z = Number(query.z); const x = Number(query.x); const y = Number(query.y);
  if (![z, x, y].every(Number.isSafeInteger) || z < 0 || z > 20 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) throw invalid('tile', null, 'Invalid tile coordinates.');
  const url = new URL(template.replaceAll('{z}', String(z)).replaceAll('{x}', String(x)).replaceAll('{y}', String(y)));
  if (row.definition.sourceType === 'wms') {
    const size = 40075016.68557849 / 2 ** z; const west = -20037508.342789244 + x * size; const north = 20037508.342789244 - y * size;
    Object.entries({ SERVICE: 'WMS', REQUEST: 'GetMap', VERSION: '1.1.1', LAYERS: row.definition.layers, STYLES: '', SRS: 'EPSG:3857', BBOX: [west, north - size, west + size, north].join(','), WIDTH: '256', HEIGHT: '256', FORMAT: 'image/png', TRANSPARENT: 'TRUE' }).forEach(([key, value]) => url.searchParams.set(key, value));
  }
  const resolved = await resolveWebhookUrl(url.toString());
  return new Promise((resolve, reject) => {
    const request = https.get(resolved.url, { headers: { 'User-Agent': 'FieldData/1.0 remote map', ...(authorization ? { Authorization: authorization } : {}) }, lookup: (_, options, callback) => (options.all ? callback(null, [{ address: resolved.address, family: resolved.family }]) : callback(null, resolved.address, resolved.family)) }, response => {
      const type = String(response.headers['content-type'] || '').split(';')[0];
      if (response.statusCode !== 200 || !['image/png', 'image/jpeg', 'image/webp'].includes(type)) { response.destroy(); reject(new Error('Map provider did not return a supported image.')); return; }
      const chunks = []; let size = 0;
      response.on('data', chunk => { size += chunk.length; if (size > 2097152) response.destroy(new Error('Tile exceeds 2 MB.')); else chunks.push(chunk); });
      response.on('error', reject); response.on('end', () => resolve({ buffer: Buffer.concat(chunks), type }));
    });
    const timer = setTimeout(() => request.destroy(new Error('Map provider timed out.')), 10000);
    request.on('close', () => clearTimeout(timer)); request.on('error', reject);
  });
};
module.exports = { normalizeRemote, remoteTile };
