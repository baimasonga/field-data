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
  if (data.schemaVersion !== 'offline-assignments@1' || data.audience !== origin || !uuid(data.id) ||
    !Number.isSafeInteger(data.actorId) || data.actorId <= 0 ||
    !Number.isSafeInteger(data.projectId) || data.projectId <= 0 ||
    !text(data.appUser?.name, 2000) || !text(data.appUser?.projectName, 2000) ||
    typeof data.complete !== 'boolean' || !Array.isArray(data.items) || data.items.length > 50 ||
    data.items.some(item => !uuid(item.id) || !text(item.question, 2000) ||
      !text(item.xmlFormId, 1000) || (item.formName != null && !text(item.formName, 2000)) ||
      !['requested', 'linked', 'cancelled'].includes(item.status) || typeof item.actionable !== 'boolean'))
    throw new Error('Invalid snapshot');
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
