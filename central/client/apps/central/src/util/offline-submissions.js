// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
/* eslint-disable no-await-in-loop */
import { decode, derive, encode, hash, storedMedia } from './offline-media';

const schema = 'offline-submissions@1';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
export const XML_LIMIT = 1024 * 1024;
export const QUEUE_LIMIT = 5 * XML_LIMIT;
const lifetime = 24 * 3600000;
const exact = (value, keys) => value != null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 1000;
const positive = value => Number.isSafeInteger(value) && value > 0;
export const submissionIdentity = (bytes, includeVersion = false) => {
  if (!bytes.byteLength || bytes.byteLength > XML_LIMIT) throw new Error('Each XML file must be between 1 byte and 1 MB');
  const text = decoder.decode(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('XML declarations with entities or document types are unsupported');
  const document = new DOMParser().parseFromString(text, 'application/xml');
  if (document.getElementsByTagName('parsererror').length) throw new Error('Invalid XML');
  const root = document.documentElement;
  const metas = Array.from(root.children).filter(node => node.localName === 'meta');
  const instances = metas.flatMap(meta => Array.from(meta.children).filter(node => node.localName === 'instanceID'));
  if (metas.length !== 1 || instances.length !== 1 || instances[0].children.length || !id(instances[0].textContent.trim()) || !id(root.getAttribute('id')) ||
    document.getElementsByTagNameNS('*', 'deprecatedID').length) throw new Error('Choose a new submission with one meta/instanceID; edited submissions are unsupported');
  return { xmlFormId: root.getAttribute('id'), instanceId: instances[0].textContent.trim(), ...(includeVersion ? { version: root.getAttribute('version') ?? '' } : {}) };
};
export const validateSubmissions = async (data, now = Date.now(), origin = window.location.origin) => {
  if (!exact(data, ['schemaVersion', 'origin', 'actorId', 'projectId', 'createdAt', 'expiresAt', 'items']) || data.schemaVersion !== schema || data.origin !== origin ||
    !positive(data.actorId) || !positive(data.projectId) || !Number.isSafeInteger(data.createdAt) || !Number.isSafeInteger(data.expiresAt) ||
    data.createdAt > now + 300000 || data.expiresAt <= now || data.expiresAt <= data.createdAt || data.expiresAt - data.createdAt > lifetime ||
    !Array.isArray(data.items) || !data.items.length || data.items.length > 10) throw new Error('Invalid or expired submission package');
  const targets = new Set(); let size = 0;
  for (const row of data.items) {
    if (!exact(row, ['xmlFormId', 'instanceId', 'priority', 'sha256', 'bytes', 'delivered']) || ![1, 2, 3].includes(row.priority) || typeof row.delivered !== 'boolean' || !/^[a-f0-9]{64}$/.test(row.sha256)) throw new Error('Invalid submission manifest');
    const bytes = decode(row.bytes, XML_LIMIT); const parsed = submissionIdentity(bytes);
    if (parsed.xmlFormId !== row.xmlFormId || parsed.instanceId !== row.instanceId || await hash(bytes) !== row.sha256) throw new Error('Submission integrity check failed');
    const target = JSON.stringify([row.xmlFormId, row.instanceId]); size += bytes.length;
    if (targets.has(target) || size > QUEUE_LIMIT) throw new Error('Duplicate submission or package exceeds 5 MB');
    targets.add(target);
  }
  return data;
};
export const prepareSubmissions = async (files, identity, now = Date.now(), origin = window.location.origin) => {
  if (!Array.isArray(files) || !files.length || files.length > 10 || files.some(file => file.size > XML_LIMIT) || files.reduce((sum, file) => sum + file.size, 0) > QUEUE_LIMIT) throw new Error('Choose up to 10 XML files, 1 MB each and 5 MB in total');
  const items = [];
  for (const file of files) {
    const bytes = await file.arrayBuffer();
    items.push({ ...submissionIdentity(bytes), priority: 2, sha256: await hash(bytes), bytes: encode(bytes), delivered: false });
  }
  return validateSubmissions({ schemaVersion: schema, origin, actorId: identity.actorId, projectId: identity.projectId, createdAt: now, expiresAt: now + lifetime, items }, now, origin);
};
export const encryptSubmissions = async (data, passphrase, now = Date.now(), origin = window.location.origin) => {
  await validateSubmissions(data, now, origin);
  const salt = crypto.getRandomValues(new Uint8Array(16)); const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derive(passphrase, salt);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(`${schema}:${origin}`) }, key, encoder.encode(JSON.stringify(data)));
  return { schemaVersion: schema, salt: encode(salt), iv: encode(iv), ciphertext: encode(ciphertext) };
};
export const decryptSubmissions = async (record, passphrase, now = Date.now(), origin = window.location.origin) => {
  if (!exact(record, ['schemaVersion', 'salt', 'iv', 'ciphertext']) || record.schemaVersion !== schema) throw new Error('Unknown submission package');
  const salt = decode(record.salt, 16); const iv = decode(record.iv, 12);
  if (salt.length !== 16 || iv.length !== 12) throw new Error('Invalid encryption parameters');
  const key = await derive(passphrase, salt);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(`${schema}:${origin}`) }, key, decode(record.ciphertext, 8 * XML_LIMIT));
  return validateSubmissions(JSON.parse(decoder.decode(plaintext)), now, origin);
};
export const storedSubmissions = (operation, value, isCurrent) => storedMedia(operation, value, isCurrent, 'field-data-submissions');
