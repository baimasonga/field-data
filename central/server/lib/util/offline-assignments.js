// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { createPrivateKey, createPublicKey, createHash, sign, randomUUID } = require('crypto');
const Problem = require('./problem');

const config = () => {
  try {
    const origin = new URL(process.env.FIELD_DATA_OFFLINE_ORIGIN);
    if (origin.href !== `${origin.origin}/` || origin.username || origin.password
      || (origin.protocol !== 'https:' && !(origin.protocol === 'http:'
        && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)))) return null;
    const key = createPrivateKey(process.env.FIELD_DATA_OFFLINE_SIGNING_KEY);
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails.namedCurve !== 'prime256v1') return null;
    const publicKey = createPublicKey(key);
    const keyId = createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
    return { key, publicKey: publicKey.export({ format: 'jwk' }), keyId, origin: origin.origin };
  } catch { return null; }
};

const issue = (settings, user, rows, now = new Date()) => {
  const data = { schemaVersion: 'offline-assignments@1', id: randomUUID(),
    audience: settings.origin, actorId: user.actorId, projectId: user.projectId,
    appUser: { name: user.displayName ?? 'App User', projectName: user.projectName },
    issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 8 * 3600000).toISOString(),
    complete: rows.length <= 50, items: rows.slice(0, 50) };
  const bytes = Buffer.from(JSON.stringify(data));
  if (bytes.length > 262144) throw Problem.user.reviewAssignmentInvalid();
  return { algorithm: 'ES256', keyId: settings.keyId, publicKey: settings.publicKey,
    payload: bytes.toString('base64url'),
    signature: sign('sha256', bytes, { key: settings.key, dsaEncoding: 'ieee-p1363' }).toString('base64url') };
};

module.exports = { config, issue };
