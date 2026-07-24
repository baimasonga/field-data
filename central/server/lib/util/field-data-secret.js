// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

const crypto = require('node:crypto');

const getKey = () => {
  const value = process.env.FIELD_DATA_WEBHOOK_ENCRYPTION_KEY || '';
  const key = /^[0-9a-f]{64}$/i.test(value)
    ? Buffer.from(value, 'hex')
    : Buffer.from(value, 'base64');
  if (key.length !== 32) {
    throw new Error('FIELD_DATA_WEBHOOK_ENCRYPTION_KEY must be a 32-byte base64 value or 64 hexadecimal characters.');
  }
  return key;
};

const encryptSecret = (plaintext) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url')].join(':');
};

const decryptSecret = (stored) => {
  if (stored == null || stored === '' || !stored.startsWith('v1:')) return stored;
  const [, iv, tag, ciphertext] = stored.split(':');
  if (!(iv && tag && ciphertext)) throw new Error('Invalid encrypted webhook secret.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final()
  ]).toString('utf8');
};

module.exports = { decryptSecret, encryptSecret };
