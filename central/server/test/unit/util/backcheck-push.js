// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { strict: assert } = require('assert');
const { createECDH, randomBytes } = require('crypto');
const webpush = require('web-push');
const { pushConfig, subscriptionBody } = require('../../../lib/util/backcheck-push');

describe('backcheck push configuration and subscription validation', () => {
  it('requires explicit enablement and a valid matching VAPID pair', () => {
    const pair = webpush.generateVAPIDKeys();
    const env = { FIELD_DATA_PUSH_ENABLED: 'true', FIELD_DATA_PUSH_SUBJECT: 'mailto:push@example.test',
      FIELD_DATA_PUSH_PUBLIC_KEY: pair.publicKey, FIELD_DATA_PUSH_PRIVATE_KEY: pair.privateKey };
    assert.equal(pushConfig({}), null);
    assert.equal(pushConfig({ ...env, FIELD_DATA_PUSH_ENABLED: 'false' }), null);
    assert.equal(pushConfig({ ...env, FIELD_DATA_PUSH_PRIVATE_KEY: webpush.generateVAPIDKeys().privateKey }), null);
    assert.equal(pushConfig({ ...env, FIELD_DATA_PUSH_SUBJECT: 'not a URI' }), null);
    assert.equal(pushConfig(env).publicKey, pair.publicKey);
  });
  it('accepts supported browser endpoints and valid P256 keys, rejects arbitrary destinations and malformed input', () => {
    const key = createECDH('prime256v1');
    const valid = { endpoint: 'https://fcm.googleapis.com/fcm/send/fixture',
      keys: { p256dh: key.generateKeys().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
    assert.ok(subscriptionBody(valid));
    for (const endpoint of ['http://fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x',
      'https://fcm.googleapis.com.evil.test/x', 'https://127.0.0.1/x', 'https://[::1]/x', 'https://fcm.googleapis.com/x#secret'])
      assert.equal(subscriptionBody({ ...valid, endpoint }), null);
    assert.equal(subscriptionBody({ ...valid, keys: { ...valid.keys, p256dh: 'a'.repeat(87) } }), null);
    assert.equal(subscriptionBody({ ...valid, unexpected: 'value' }), null);
    assert.equal(subscriptionBody(null), null);
  });
});
