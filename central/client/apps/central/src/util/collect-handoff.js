// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
/* eslint-disable no-await-in-loop, no-control-regex, no-continue */
import { decode, derive, encode, hash, storedMedia } from './offline-media';
import { submissionIdentity, XML_LIMIT } from './offline-submissions';
import { fingerprint, verifyEnvelope } from './sensor-corroboration';

const schema = 'offline-collect-handoff@1'; const LIMIT = 20 * 1024 * 1024;
const canonical = value => JSON.stringify(value == null || typeof value !== 'object' ? value : Array.isArray(value) ? value.map(v => JSON.parse(canonical(v))) : Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(canonical(value[k]))])));
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const filename = name => typeof name === 'string' && name.length > 0 && name.length <= 255 && name.trim() === name && !/[/\\\u0000-\u001f\u007f]/.test(name) && !name.startsWith('.');
const blocked = name => /^(?:settings\.json|collect\.settings|metadata\.json|xml_submission_file)$/i.test(name) || /\.(?:db|sqlite\d?|save|bak)$/i.test(name);
const references = bytes => {
  const doc = new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml');
  const encrypted = Array.from(doc.documentElement.children).some(n => n.localName === 'encryptedXmlFile');
  const refs = new Set();
  if (encrypted) {
    for (const child of doc.documentElement.children) {
      if (child.localName === 'encryptedXmlFile') refs.add(child.textContent);
      if (child.localName === 'media') for (const node of child.children) { if (node.localName !== 'file' || node.children.length) throw new Error('Invalid encrypted media reference'); refs.add(node.textContent); }
    }
    if ([...refs].some(name => !filename(name) || blocked(name))) throw new Error('Unsafe ciphertext reference');
  } else for (const node of doc.getElementsByTagName('*')) if (!node.children.length) refs.add(node.textContent.trim());
  return { encrypted, refs };
};
export const collectManifest = data => {
  const identity = submissionIdentity(decode(data.xml.bytes, XML_LIMIT), true);
  return { xmlFormId: identity.xmlFormId, instanceId: identity.instanceId, version: identity.version, xml: { size: data.xml.size, sha256: data.xml.sha256 }, files: data.media.map(({ name, size, sha256 }) => ({ name, size, sha256 })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) };
};
export const verifyCollectSnapshot = async (snapshot, data) => {
  if (snapshot?.keyId !== await fingerprint(snapshot?.publicKey)) throw new Error('Invalid snapshot authority');
  const details = await verifyEnvelope(snapshot, snapshot.publicKey); const manifest = collectManifest(data);
  if (details.purpose !== 'field-data.collect-handoff-snapshot@1' || details.issuer !== window.location.origin || details.projectId !== data.projectId || details.ownerId !== data.actorId || canonical(details.manifest) !== canonical(manifest) || details.manifestHash !== await hash(new TextEncoder().encode(canonical(manifest))) || ![details.formId, details.formDefId, details.submissionDefId].every(n => Number.isSafeInteger(n) && n > 0) || !Number.isFinite(Date.parse(details.submissionReceivedAt)) || !Number.isFinite(Date.parse(details.verifiedAt)) || Date.parse(details.submissionReceivedAt) > Date.parse(details.verifiedAt)) throw new Error('Wrong Collect handoff snapshot');
  return details;
};
const validate = async data => {
  if (!exact(data, ['schemaVersion', 'origin', 'actorId', 'projectId', 'createdAt', 'expiresAt', 'xml', 'media', 'snapshot']) || data.schemaVersion !== schema || data.origin !== window.location.origin || ![data.actorId, data.projectId].every(n => Number.isSafeInteger(n) && n > 0) || !Number.isSafeInteger(data.createdAt) || !Number.isSafeInteger(data.expiresAt) || data.createdAt > Date.now() + 300000 || data.expiresAt <= Date.now() || data.expiresAt <= data.createdAt || data.expiresAt - data.createdAt > 86400000 || !Array.isArray(data.media) || data.media.length > 10) throw new Error('Invalid Collect package');
  const check = async (row, media) => {
    if (!exact(row, ['name', 'size', 'sha256', 'bytes', ...(media ? ['contentType'] : [])]) || !filename(row.name) || (media && blocked(row.name)) || !Number.isSafeInteger(row.size) || row.size < 1 || row.size > (media ? LIMIT : XML_LIMIT) || !/^[a-f0-9]{64}$/.test(row.sha256) || (media && (typeof row.contentType !== 'string' || !/^(?:(?:image|audio|video)\/[a-zA-Z0-9.+-]+|application\/octet-stream)$/.test(row.contentType)))) throw new Error('Invalid Collect file');
    const bytes = decode(row.bytes, row.size); if (bytes.length !== row.size || await hash(bytes) !== row.sha256) throw new Error('Collect file integrity failed'); return bytes;
  };
  const bytes = await check(data.xml, false); submissionIdentity(bytes, true); const { encrypted, refs } = references(bytes); let total = 0; const names = new Set([data.xml.name]);
  for (const row of data.media) { await check(row, true); total += row.size; if (total > LIMIT || names.has(row.name) || !refs.has(row.name)) throw new Error('Duplicate or oversized Collect files'); names.add(row.name); }
  if (encrypted && [...refs].some(name => !data.media.some(f => f.name === name))) throw new Error('Missing ciphertext in Collect package');
  if (data.snapshot != null) await verifyCollectSnapshot(data.snapshot, data);
  return data;
};
export const prepareCollectHandoff = async (files, identity) => {
  if (!Array.isArray(files) || !files.length || files.length > 50 || files.reduce((n, f) => n + f.size, 0) > 44 * 1024 * 1024) throw new Error('Select one instance folder, at most 50 files and 44 MB');
  const names = new Set(); const parents = new Set();
  for (const file of files) {
    if (typeof file.name !== 'string' || !file.name.length || file.name.length > 255 || /[/\\\u0000-\u001f\u007f]/.test(file.name) || ['.', '..'].includes(file.name)) throw new Error('Invalid file path');
    if (names.has(file.name)) throw new Error('Duplicate file name'); names.add(file.name);
    if (file.webkitRelativePath) { const parts = file.webkitRelativePath.split('/'); if (parts.some(p => !p || p === '.' || p === '..') || parts.at(-1) !== file.name) throw new Error('Unsafe instance folder'); parents.add(parts.slice(0, -1).join('/')); }
  }
  if (parents.size > 1) throw new Error('Select one instance folder at a time');
  const preferred = files.find(f => f.name === 'submission.xml'); const candidates = [];
  for (const file of preferred ? [preferred] : files.filter(f => /\.xml$/i.test(f.name) && !f.name.startsWith('.'))) {
    if (file.size > XML_LIMIT) { if (preferred) throw new Error('Submission XML exceeds 1 MB'); continue; }
    try { const bytes = await file.arrayBuffer(); const parsed = submissionIdentity(bytes, true); candidates.push({ file, bytes, identity: parsed }); } catch (error) { if (preferred) throw error; }
  }
  if (candidates.length !== 1) throw new Error('Choose one unambiguous instance XML');
  const primary = candidates[0]; const { encrypted, refs } = references(primary.bytes);
  if (encrypted && [...refs].some(name => !files.some(f => f.name === name))) throw new Error('The encrypted envelope requires all referenced ciphertext files');
  const selected = files.filter(f => f !== primary.file && refs.has(f.name) && !f.name.startsWith('.') && !blocked(f.name));
  if (selected.length > 10 || selected.reduce((n, f) => n + f.size, 0) > LIMIT || selected.some(f => !f.size)) throw new Error('Choose up to 10 referenced files, 20 MB total');
  const media = [];
  for (const file of selected) { const bytes = await file.arrayBuffer(); media.push({ name: file.name, size: bytes.byteLength, sha256: await hash(bytes), bytes: encode(bytes), contentType: /^(?:image|audio|video)\/[a-zA-Z0-9.+-]+$/.test(file.type) ? file.type : 'application/octet-stream' }); }
  const now = Date.now(); const data = { schemaVersion: schema, origin: window.location.origin, actorId: identity.actorId, projectId: identity.projectId, createdAt: now, expiresAt: now + 86400000, xml: { name: primary.file.name, size: primary.bytes.byteLength, sha256: await hash(primary.bytes), bytes: encode(primary.bytes) }, media, snapshot: null };
  await validate(data); return { data, excluded: files.filter(f => f !== primary.file && !selected.includes(f)).map(f => f.name) };
};
export const encryptCollectHandoff = async (data, passphrase) => {
  await validate(data); const salt = crypto.getRandomValues(new Uint8Array(16)); const iv = crypto.getRandomValues(new Uint8Array(12)); const key = await derive(passphrase, salt);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(`${schema}:${window.location.origin}`) }, key, new TextEncoder().encode(JSON.stringify(data)));
  return { schemaVersion: schema, salt: encode(salt), iv: encode(iv), ciphertext: encode(ciphertext) };
};
export const decryptCollectHandoff = async (record, passphrase) => {
  if (!exact(record, ['schemaVersion', 'salt', 'iv', 'ciphertext']) || record.schemaVersion !== schema) throw new Error('Invalid Collect archive');
  const salt = decode(record.salt, 16); const iv = decode(record.iv, 12); if (salt.length !== 16 || iv.length !== 12) throw new Error('Invalid Collect encryption');
  const key = await derive(passphrase, salt); const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(`${schema}:${window.location.origin}`) }, key, decode(record.ciphertext, 32 * 1024 * 1024));
  return validate(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
};
export const storedCollectHandoff = (operation, value, isCurrent) => storedMedia(operation, value, isCurrent, 'field-data-collect-handoff');
// Only checkpoint the encrypted copy this tab opened. An explicit save/import in
// another tab must not be overwritten by a late verification response.
export const checkpointCollectHandoff = (record, expected, active) => new Promise((resolve, reject) => {
  const open = indexedDB.open('field-data-collect-handoff', 1);
  open.onupgradeneeded = () => { open.transaction.abort(); reject(new Error('The saved Collect package was removed')); };
  open.onerror = () => reject(new Error('Collect storage unavailable'));
  open.onsuccess = () => {
    const db = open.result; const tx = db.transaction('packages', 'readwrite'); const store = tx.objectStore('packages'); const read = store.get('current');
    read.onsuccess = () => { if (!active() || !expected || read.result?.ciphertext !== expected.ciphertext) { tx.abort(); return; } store.put(record, 'current'); };
    tx.oncomplete = () => { db.close(); resolve(); }; const failed = () => { db.close(); reject(new Error('The saved Collect package changed')); }; tx.onabort = failed; tx.onerror = failed;
  };
});
