// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const webpush = require('web-push');
const { createECDH } = require('crypto');

const pushConfig = (env = process.env) => {
  if (env.FIELD_DATA_PUSH_ENABLED !== 'true') return null;
  const publicKey = env.FIELD_DATA_PUSH_PUBLIC_KEY;
  const privateKey = env.FIELD_DATA_PUSH_PRIVATE_KEY;
  const subject = env.FIELD_DATA_PUSH_SUBJECT;
  try {
    webpush.getVapidHeaders('https://fcm.googleapis.com', subject, publicKey, privateKey, 'aes128gcm');
    const key = createECDH('prime256v1');
    key.setPrivateKey(Buffer.from(privateKey, 'base64url'));
    if (key.getPublicKey().toString('base64url') !== publicKey) return null;
    return { subject, publicKey, privateKey };
  } catch { return null; }
};

const subscriptionBody = (body) => {
  if (body == null || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(key => !['endpoint', 'keys', 'expirationTime'].includes(key))
    || typeof body.endpoint !== 'string' || body.endpoint.length > 2048
    || body.keys == null || Object.keys(body.keys).some(key => !['auth', 'p256dh'].includes(key))) return null;
  try {
    const url = new URL(body.endpoint);
    // Only browser push services we support. No arbitrary webhook destination,
    // local address, credential, fragment, or custom port can be registered.
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port
      || !['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'].includes(url.hostname)) return null;
    const { p256dh, auth } = body.keys;
    if (typeof p256dh !== 'string' || typeof auth !== 'string'
      || !/^[A-Za-z0-9_-]{87}$/.test(p256dh) || !/^[A-Za-z0-9_-]{22}$/.test(auth)) return null;
    const key = createECDH('prime256v1');
    key.setPublicKey(Buffer.from(p256dh, 'base64url'));
    if (Buffer.from(auth, 'base64url').length !== 16) return null;
    return { endpoint: url.href, p256dh, auth };
  } catch { return null; }
};
module.exports = { pushConfig, subscriptionBody };
