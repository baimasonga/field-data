// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const MAX_BYTES = 512 * 1024;
const encode = bytes => btoa(Array.from(new Uint8Array(bytes), byte => String.fromCharCode(byte)).join(''))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decode = (value, limit = MAX_BYTES) => {
  if (typeof value !== 'string' || value.length > Math.ceil((limit * 4) / 3) ||
    !/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error('Invalid encoding');
  const bytes = Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
  if (bytes.length > limit) throw new Error('Too large');
  return bytes;
};
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const text = (value, limit) => typeof value === 'string' && value.length <= limit;

export const validateTime = (data, now = Date.now()) => {
  const issued = Date.parse(data.issuedAt);
  const expiry = Date.parse(data.expiresAt);
  if (!Number.isFinite(issued) || !Number.isFinite(expiry) || expiry <= issued ||
    expiry - issued > 8 * 3600000 || issued > now + 5 * 60000 || expiry <= now)
    throw new Error('Expired or invalid clock');
};

export const verifySnapshot = async (bundle, origin = window.location.origin) => {
  if (bundle?.algorithm !== 'ES256' || bundle.publicKey?.kty !== 'EC' ||
    bundle.publicKey?.crv !== 'P-256' || bundle.publicKey.d != null ||
    !text(bundle.publicKey.x, 64) || !text(bundle.publicKey.y, 64) ||
    !/^[0-9a-f]{64}$/.test(bundle.keyId)) throw new Error('Invalid signing key');
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    bundle.publicKey,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify']
  );
  const fingerprint = await crypto.subtle.digest('SHA-256', await crypto.subtle.exportKey('spki', publicKey));
  const hex = Array.from(new Uint8Array(fingerprint), byte => byte.toString(16).padStart(2, '0')).join('');
  if (hex !== bundle.keyId) throw new Error('Signing key mismatch');
  const bytes = decode(bundle.payload);
  const signature = decode(bundle.signature, 64);
  if (signature.length !== 64 || !await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, signature, bytes))
    throw new Error('Invalid signature');
  const data = JSON.parse(decoder.decode(bytes));
  if (!['offline-assignments@1', 'offline-assignments@2', 'offline-assignments@3'].includes(data.schemaVersion) || data.audience !== origin || !uuid(data.id) ||
    !Number.isSafeInteger(data.actorId) || data.actorId <= 0 ||
    !Number.isSafeInteger(data.projectId) || data.projectId <= 0 ||
    !text(data.appUser?.name, 2000) || !text(data.appUser?.projectName, 2000) ||
    typeof data.complete !== 'boolean' || !Array.isArray(data.items) || data.items.length > 50 ||
    data.items.some(item => !uuid(item.id) || !text(item.question, 2000) ||
      !text(item.xmlFormId, 1000) || (item.formName != null && !text(item.formName, 2000)) ||
      !['requested', 'linked', 'cancelled'].includes(item.status) || typeof item.actionable !== 'boolean'))
    throw new Error('Invalid snapshot');
  if (['offline-assignments@2', 'offline-assignments@3'].includes(data.schemaVersion)) {
    const routes = data.itineraries;
    const location = value => value != null && typeof value.latitude === 'number' && Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90 &&
      typeof value.longitude === 'number' && Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180;
    if (routes == null || typeof routes.complete !== 'boolean' || !Number.isInteger(routes.omitted) || routes.omitted < 0 || routes.omitted > 30 ||
      routes.complete !== (routes.omitted === 0) || !Array.isArray(routes.items) || routes.items.length > 5 ||
      routes.items.some(route => !uuid(route.id) || !text(route.note, 2000) || typeof route.needsReview !== 'boolean' ||
        !text(route.method, 500) || !/^\d{4}-\d{2}-\d{2}$/.test(route.date ?? '') || !Number.isFinite(Date.parse(`${route.date}T00:00:00Z`)) ||
        new Date(`${route.date}T00:00:00Z`).toISOString().slice(0, 10) !== route.date || !location(route.start) ||
        !Number.isInteger(route.withheld) || route.withheld < 0 || route.withheld > 100 || !Array.isArray(route.stops) || route.stops.length > 100 ||
        route.stops.some((stop, i) => !uuid(stop.id) || !Number.isInteger(stop.order) || stop.order < 1 || stop.order > 100 ||
          (stop.kind != null && !['backcheck', 'reverification'].includes(stop.kind)) ||
          (stop.assetName != null && !text(stop.assetName, 2000)) || (stop.predicate != null && !text(stop.predicate, 200)) ||
          (i > 0 && stop.order <= route.stops[i - 1].order) || !text(stop.question, 2000) ||
          (stop.xmlFormId != null && !text(stop.xmlFormId, 1000)) || (stop.formName != null && !text(stop.formName, 2000)) ||
          (stop.formVersion != null && !text(stop.formVersion, 200)) ||
          (stop.dueAt != null && (typeof stop.dueAt !== 'string' || !Number.isFinite(Date.parse(stop.dueAt)))) || !location(stop.location) ||
          (stop.location.accuracy != null && (typeof stop.location.accuracy !== 'number' || !Number.isFinite(stop.location.accuracy))))) ||
      routes.items.reduce((n, route) => n + route.stops.length, 0) > 100 ||
      new Set(routes.items.map(route => route.date)).size !== routes.items.length)
      throw new Error('Invalid itinerary snapshot');
  }
  if (data.schemaVersion !== 'offline-assignments@3' && data.reverification !== undefined) throw new Error('Unexpected re-verification snapshot version');
  if (data.schemaVersion === 'offline-assignments@3') {
    const visits = data.reverification;
    const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
    const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
    const keys = ['id', 'assetName', 'externalId', 'assetType', 'predicate', 'instruction', 'xmlFormId', 'formName', 'visitBy', 'dispatchedAt', 'plannedVisitDate', 'actionable'];
    if (visits == null || typeof visits.complete !== 'boolean' || !Number.isSafeInteger(visits.omitted) || visits.omitted < 0 ||
      visits.complete !== (visits.omitted === 0) || !Array.isArray(visits.items) || visits.items.length > 50 ||
      visits.items.some(v => v == null || Object.keys(v).some(key => !keys.includes(key)) || !uuid(v.id) ||
        !text(v.assetName, 2000) || !text(v.externalId, 2000) || !text(v.assetType, 2000) || !text(v.predicate, 100) ||
        !text(v.instruction, 2000) || !text(v.xmlFormId, 1000) || (v.formName != null && !text(v.formName, 2000)) ||
        typeof v.actionable !== 'boolean' || !timestamp(v.dispatchedAt) || (v.visitBy != null && !timestamp(v.visitBy)) ||
        (v.plannedVisitDate != null && !date(v.plannedVisitDate))) || new Set(visits.items.map(v => v.id)).size !== visits.items.length)
      throw new Error('Invalid re-verification snapshot');
  }
  validateTime(data);
  return data;
};

const deriveKey = async (passphrase, salt) => {
  if (typeof passphrase !== 'string' || passphrase.length < 12 || passphrase.length > 128)
    throw new Error('Invalid passphrase');
  const material = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
};

export const encryptSnapshot = async (bundle, passphrase) => {
  const bytes = encoder.encode(JSON.stringify(bundle));
  if (bytes.length > MAX_BYTES) throw new Error('Too large');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const ciphertext = await crypto.subtle.encrypt({
    name: 'AES-GCM', iv,
    additionalData: encoder.encode(`offline-vault@1:${window.location.origin}`)
  }, key, bytes);
  return { schemaVersion: 'offline-vault@1', salt: encode(salt), iv: encode(iv), ciphertext: encode(ciphertext) };
};

export const decryptSnapshot = async (record, passphrase) => {
  if (record?.schemaVersion !== 'offline-vault@1') throw new Error('Unknown vault version');
  const salt = decode(record.salt, 16);
  const iv = decode(record.iv, 12);
  if (salt.length !== 16 || iv.length !== 12) throw new Error('Invalid encryption parameters');
  const key = await deriveKey(passphrase, salt);
  const bytes = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM', iv,
      additionalData: encoder.encode(`offline-vault@1:${window.location.origin}`)
    },
    key,
    decode(record.ciphertext, MAX_BYTES + 16)
  );
  return verifySnapshot(JSON.parse(decoder.decode(bytes)));
};

const database = () => new Promise((resolve, reject) => {
  const open = indexedDB.open('field-data-offline', 1);
  open.onupgradeneeded = () => open.result.createObjectStore('snapshots');
  open.onsuccess = () => resolve(open.result);
  open.onerror = () => reject(open.error);
  open.onblocked = () => reject(new Error('Storage blocked'));
});

export const storedSnapshot = async (operation, value = null, isCurrent = () => true) => {
  const db = await database();
  try {
    if (!isCurrent()) throw new Error('Cancelled');
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('snapshots', operation === 'read' ? 'readonly' : 'readwrite');
      const store = tx.objectStore('snapshots');
      const result = operation === 'read' ? store.get('current')
        : operation === 'write' ? store.put(value, 'current') : store.delete('current');
      tx.oncomplete = () => resolve(result.result ?? null);
      tx.onabort = () => reject(tx.error || new Error('Storage aborted'));
      tx.onerror = () => reject(tx.error || new Error('Storage failed'));
    });
  } finally { db.close(); }
};
