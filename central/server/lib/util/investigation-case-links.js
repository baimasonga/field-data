// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { createHash } = require('node:crypto');
const { UUID_PATTERN } = require('./claim-versioning');
const Problem = require('./problem');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const invalid = () => Problem.user.investigationInvalid({ field: 'case link', reason: 'request identity, reason, revision or search cursor is invalid' });
const exact = (body, keys) => body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === keys.length && keys.every(k => Object.hasOwn(body, k));
const revision = headers => {
  if (headers['if-match'] == null) throw Problem.user.investigationRevisionRequired();
  const match = /^"investigation-([1-9]\d{0,9})"$/.exec(headers['if-match']);
  if (!match || Number(match[1]) >= 2147483647) throw invalid(); return Number(match[1]);
};
const checked = (body, headers, removing = false, linkId = null) => {
  if (!exact(body, removing ? ['requestId', 'reason'] : ['requestId', 'caseId', 'reason']) || !UUID_PATTERN.test(body.requestId ?? '') ||
      !UUID_PATTERN.test((removing ? linkId : body.caseId) ?? '') || typeof body.reason !== 'string' || body.reason.trim().length < 10 || body.reason.length > 2000) throw invalid();
  return { requestId: body.requestId.toLowerCase(), revision: revision(headers), action: removing ? 'removed' : 'linked', targetId: (removing ? linkId : body.caseId).toLowerCase(), reason: body.reason.trim() };
};
const active = events => {
  const latest = new Map(); for (const e of events) if (!latest.has(e.caseId)) latest.set(e.caseId, e);
  return [...latest.values()].filter(e => e.action === 'linked');
};
// Leave enough event slots to remove every active link, including a new one.
const canAdd = (events, links) => links < 100 && events + links + 2 <= 500;
const cursor = (row, context) => Buffer.from(JSON.stringify({ at: new Date(row.openedAt).toISOString(), id: row.id, context })).toString('base64url');
const checkedCursor = (value, context) => {
  try {
    if (typeof value !== 'string' || value.length > 1000 || !/^[A-Za-z0-9_-]+$/.test(value)) throw invalid();
    const decoded = Buffer.from(value, 'base64url'); if (decoded.toString('base64url') !== value) throw invalid();
    const data = JSON.parse(decoded.toString('utf8'));
    if (!exact(data, ['at', 'id', 'context']) || data.context !== context || !UUID_PATTERN.test(data.id ?? '') || typeof data.at !== 'string' || new Date(data.at).toISOString() !== data.at) throw invalid(); return data;
  } catch { throw invalid(); }
};
module.exports = { hash, invalid, checked, active, canAdd, cursor, checkedCursor };
