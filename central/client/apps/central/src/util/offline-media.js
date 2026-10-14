// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
/* eslint-disable no-await-in-loop, no-control-regex */
import { checkedLocation } from './capture-location';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
export const MEDIA_LIMIT = 20 * 1024 * 1024;
export const ARCHIVE_LIMIT = 40 * 1024 * 1024;
const lifetime = 24 * 3600000;
const schema = 'offline-media@2';
const schemas = ['offline-media@1', schema];
export const challengeContext = row => {
  const names = ['challengeId', 'challengeNonce', 'challengeIssuedAt', 'challengeExpiresAt'];
  if (names.every(key => row[key] == null) && row.captureLocation == null) return {};
  const iso = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.challengeId ?? '') || !/^[0-9a-f]{64}$/.test(row.challengeNonce ?? '') ||
    !iso(row.challengeIssuedAt) || !iso(row.challengeExpiresAt) || Date.parse(row.challengeExpiresAt) <= Date.parse(row.challengeIssuedAt) || Date.parse(row.challengeExpiresAt) - Date.parse(row.challengeIssuedAt) > 20 * 60000 ||
    !['image/jpeg', 'image/png'].includes(row.contentType ?? row.file?.type) || (row.size ?? row.file?.size) > 5 * 1024 * 1024) throw new Error('Invalid capture challenge metadata');
  return { ...Object.fromEntries(names.map(key => [key, row[key]])), ...(row.captureLocation == null ? {} : { captureLocation: checkedLocation(row.captureLocation) }) };
};
const fields = (value, keys) => value != null && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;
const encode = value => {
  const bytes = new Uint8Array(value); let result = '';
  for (let i = 0; i < bytes.length; i += 32768) result += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(result);
};
const decode = (value, max) => {
  if (typeof value !== 'string' || value.length > Math.ceil(max / 3) * 4 || value.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(value)) throw new Error('Invalid encoding');
  const raw = atob(value);
  if (raw.length > max) throw new Error('Archive exceeds its limit');
  return Uint8Array.from(raw, c => c.charCodeAt(0));
};
const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
const derive = async (passphrase, salt) => {
  if (!text(passphrase, 128) || passphrase.length < 12) throw new Error('Use a passphrase of 12 to 128 characters');
  const material = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
};
export const validateMedia = async (data, now = Date.now(), origin = window.location.origin) => {
  if (!fields(data, ['schemaVersion', 'origin', 'createdAt', 'expiresAt', 'items']) || !schemas.includes(data.schemaVersion) || data.origin !== origin ||
    !Number.isSafeInteger(data.createdAt) || !Number.isSafeInteger(data.expiresAt) || data.createdAt > now + 300000 ||
    data.expiresAt <= data.createdAt || data.expiresAt - data.createdAt > lifetime || data.expiresAt <= now ||
    !Array.isArray(data.items) || !data.items.length || data.items.length > 10) throw new Error('Invalid or expired media package');
  let total = 0; const targets = new Set(); const items = [];
  for (const row of data.items) {
    const capture = data.schemaVersion === schema ? challengeContext(row) : {};
    if (!fields(row, ['xmlFormId', 'instanceId', 'name', 'contentType', 'priority', 'size', 'sha256', 'bytes', ...Object.keys(capture)]) ||
      !text(row.xmlFormId, 1000) || !text(row.instanceId, 1000) || !text(row.name, 255) || /[/\\\u0000-\u001f\u007f]/.test(row.name) ||
      !text(row.contentType, 200) || !/^(?:(?:image|audio|video)\/[a-zA-Z0-9.+-]+|application\/octet-stream)$/.test(row.contentType) ||
      ![1, 2, 3].includes(row.priority) || !Number.isSafeInteger(row.size) || row.size < 1 || row.size > MEDIA_LIMIT ||
      typeof row.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(row.sha256)) throw new Error('Invalid media manifest');
    total += row.size;
    const target = JSON.stringify([row.xmlFormId, row.instanceId, row.name]);
    if (total > MEDIA_LIMIT || targets.has(target)) throw new Error('Duplicate target or package exceeds 20 MB');
    targets.add(target);
    const bytes = decode(row.bytes, row.size);
    if (bytes.length !== row.size || await hash(bytes) !== row.sha256) throw new Error('Media integrity check failed');
    items.push({
      xmlFormId: row.xmlFormId, instanceId: row.instanceId, priority: row.priority, ...capture,
      file: new File([bytes], row.name, { type: row.contentType })
    });
  }
  return { items, expiresAt: data.expiresAt };
};
export const encryptMedia = async (rows, passphrase, now = Date.now(), origin = window.location.origin) => {
  if (!Array.isArray(rows) || !rows.length || rows.length > 10 || rows.reduce((n, row) => n + row.file.size, 0) > MEDIA_LIMIT) throw new Error('Choose up to 10 files and 20 MB in total');
  const items = [];
  for (const row of rows) {
    const bytes = await row.file.arrayBuffer();
    items.push({
      xmlFormId: row.xmlFormId, instanceId: row.instanceId, name: row.file.name, size: row.file.size,
      contentType: row.file.type || 'application/octet-stream', priority: row.priority, sha256: await hash(bytes), bytes: encode(bytes), ...challengeContext(row)
    });
  }
  const data = { schemaVersion: schema, origin, createdAt: now, expiresAt: now + lifetime, items };
  await validateMedia(data, now, origin);
  const salt = crypto.getRandomValues(new Uint8Array(16)); const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derive(passphrase, salt);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(`${schema}:${origin}`) }, key, encoder.encode(JSON.stringify(data)));
  return { schemaVersion: schema, salt: encode(salt), iv: encode(iv), ciphertext: encode(ciphertext) };
};
export const decryptMedia = async (record, passphrase, now = Date.now(), origin = window.location.origin) => {
  if (!fields(record, ['schemaVersion', 'salt', 'iv', 'ciphertext']) || !schemas.includes(record.schemaVersion)) throw new Error('Unknown media package format');
  const salt = decode(record.salt, 16); const iv = decode(record.iv, 12);
  if (salt.length !== 16 || iv.length !== 12) throw new Error('Invalid encryption parameters');
  const key = await derive(passphrase, salt);
  const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(`${record.schemaVersion}:${origin}`) }, key, decode(record.ciphertext, 30 * 1024 * 1024));
  const data = JSON.parse(decoder.decode(bytes));
  if (data.schemaVersion !== record.schemaVersion) throw new Error('Package version mismatch');
  return validateMedia(data, now, origin);
};
export const storedMedia = async (operation, value = null, isCurrent = () => true) => {
  const db = await new Promise((resolve, reject) => {
    const open = indexedDB.open('field-data-media', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('packages');
    open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new Error('Storage blocked'));
  });
  try {
    if (!isCurrent()) throw new Error('Cancelled');
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('packages', operation === 'read' ? 'readonly' : 'readwrite');
      const store = tx.objectStore('packages');
      const request = operation === 'read' ? store.get('current') : operation === 'write' ? store.put(value, 'current') : store.delete('current');
      tx.oncomplete = () => resolve(request.result ?? null);
      tx.onabort = () => reject(tx.error || new Error('Storage aborted')); tx.onerror = () => reject(tx.error || new Error('Storage failed'));
    });
  } finally { db.close(); }
};
