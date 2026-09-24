// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

const { UUID_PATTERN } = require('./claim-versioning');

const encodeCursor = ({ rank, openedAt, id }) => Buffer.from(JSON.stringify({
  rank, openedAt: new Date(openedAt).toISOString(), id
}), 'utf8').toString('base64url');

const decodeCursor = (value) => {
  if (typeof value !== 'string' || value.length > 300 || !/^[A-Za-z0-9_-]+$/.test(value))
    throw new Error('Invalid review cursor.');
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch (error) { throw new Error('Invalid review cursor.'); }
  if (parsed == null || !Number.isInteger(parsed.rank) || parsed.rank < 0 || parsed.rank > 3
    || typeof parsed.openedAt !== 'string' || !Number.isFinite(Date.parse(parsed.openedAt))
    || typeof parsed.id !== 'string' || !UUID_PATTERN.test(parsed.id)
    || encodeCursor(parsed) !== value)
    throw new Error('Invalid review cursor.');
  return parsed;
};

module.exports = { encodeCursor, decodeCursor };
