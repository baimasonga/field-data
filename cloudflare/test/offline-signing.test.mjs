// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPrivateKey, createPublicKey, createHash, generateKeyPairSync, sign } from 'node:crypto';
import { prepareOfflineSigning } from '../prepare-offline-signing.mjs';
import { verifyOfflineSigning } from '../verify-offline-signing.mjs';
const KEY = 'FIELD_DATA_OFFLINE_SIGNING_KEY'; const ORIGIN = 'FIELD_DATA_OFFLINE_ORIGIN';
const cfg = { accountId: 'a'.repeat(32), apiToken: 'fixture-token', origin: 'https://field.example.test' };
const metadata = names => async (url, options) => {
  assert.equal(new URL(url).hostname, 'api.cloudflare.com'); assert.equal(options.redirect, 'error'); assert.equal(options.method, undefined);
  return Response.json({ success: true, result: names.map(name => ({ name, type: 'secret_text' })) });
};
test('missing signing settings are prepared for the atomic deployment, without remote writes', async () => {
  const result = await prepareOfflineSigning({ ...cfg, fetcher: metadata([]) });
  assert.equal(result.keyCreated, true); assert.equal(result.originCreated, true); assert.equal(result.additions[ORIGIN], cfg.origin);
  const key = createPrivateKey(result.additions[KEY]); assert.equal(key.asymmetricKeyType, 'ec'); assert.equal(key.asymmetricKeyDetails.namedCurve, 'prime256v1');
});
test('existing keys and origins are retained, and only an absent setting is generated', async () => {
  const existing = await prepareOfflineSigning({ ...cfg, fetcher: metadata([KEY, ORIGIN]) }); assert.deepEqual(existing.additions, {});
  const missingOrigin = await prepareOfflineSigning({ ...cfg, fetcher: metadata([KEY]) }); assert.deepEqual(missingOrigin.additions, { [ORIGIN]: cfg.origin });
  const missingKey = await prepareOfflineSigning({ ...cfg, fetcher: metadata([ORIGIN]) }); assert.deepEqual(Object.keys(missingKey.additions), [KEY]);
});
test('explicit valid repository settings need no control-plane read, and invalid settings fail without echoing values', async () => {
  const key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  const result = await prepareOfflineSigning({ providedKey: key, providedOrigin: cfg.origin, fetcher: () => { throw new Error('must not read'); } }); assert.deepEqual(result.additions, {});
  await assert.rejects(prepareOfflineSigning({ ...cfg, providedKey: 'private-sentinel', fetcher: metadata([]) }), /must be valid P-256/);
  for (const origin of ['http://field.example.test', 'https://user:private-sentinel@field.example.test', 'https://field.example.test/path'])
    await assert.rejects(prepareOfflineSigning({ ...cfg, origin, fetcher: metadata([]) }), /valid HTTPS site origin/);
  await assert.rejects(prepareOfflineSigning({ ...cfg, fetcher: async () => { throw new Error('private-sentinel'); } }), /metadata could not be read/);
  await assert.rejects(prepareOfflineSigning({ ...cfg, fetcher: async () => Response.json({ success: false, errors: ['private-sentinel'] }, { status: 403 }) }), /metadata is unavailable/);
});
const fixture = ({ deployment = 'release-1', differentAssets = false, disabled = false, badAudience = false, cleanupFailure = false, malformedProject = false } = {}) => {
  const calls = []; const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }); let actor;
  const fetcher = async (url, options = {}) => {
    const path = new URL(url).pathname; const method = options.method ?? 'GET'; calls.push({ path, method });
    if (path === '/field-data-build.json') return Response.json({ deploymentId: deployment });
    if (path === '/') return new Response(`<script type="module" src="/assets/central/${differentAssets && new URL(url).hostname === 'worker.example.test' ? 'old' : 'current'}.js"></script>`);
    if (method === 'DELETE') return cleanupFailure ? new Response('cleanup unavailable', { status: 503 }) : Response.json({ success: true });
    if (path === '/v1/projects') return Response.json({ id: 99, name: malformedProject ? 'Existing user project' : JSON.parse(options.body).name });
    if (path === '/v1/projects/99/app-users') { actor = JSON.parse(options.body); return Response.json({ id: 77, displayName: actor.displayName, token: 'temporary-fixture-key' }); }
    if (path.endsWith('/offline-assignments')) {
      if (disabled) return Response.json({ enabled: false });
      const issuedAt = new Date(); const data = { schemaVersion: 'offline-assignments@2', id: 'fixture', actorId: 77, projectId: 99,
        audience: badAudience ? 'https://other.example.test' : cfg.origin, items: [], complete: true, itineraries: { items: [], complete: true, omitted: 0 },
        issuedAt: issuedAt.toISOString(), expiresAt: new Date(issuedAt.getTime() + 8 * 3600000).toISOString() };
      const bytes = Buffer.from(JSON.stringify(data)); const publicKey = createPublicKey(pair.privateKey);
      return Response.json({ enabled: true, bundle: { algorithm: 'ES256', publicKey: publicKey.export({ format: 'jwk' }),
        keyId: createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex'), payload: bytes.toString('base64url'),
        signature: sign('sha256', bytes, { key: pair.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url') } });
    }
    throw new Error('unexpected fixture request');
  };
  return { calls, fetcher };
};
const verifyCfg = { base: cfg.origin, workerBase: 'https://worker.example.test', audience: cfg.origin, deploymentId: 'release-1', sessionToken: 'fixture-session' };
test('live readiness checks custom-domain assets and the issued signature, then removes only its fixture', async () => {
  const f = fixture(); assert.deepEqual(await verifyOfflineSigning({ ...verifyCfg, fetcher: f.fetcher }), { verified: true, customDomain: true, fixtureRemoved: true });
  assert.deepEqual(f.calls.filter(c => c.method === 'DELETE').map(c => c.path), ['/v1/projects/99/app-users/77', '/v1/projects/99']);
});
test('wrong deployments/assets prevent authenticated requests and fixture creation', async () => {
  for (const options of [{ deployment: 'old-release' }, { differentAssets: true }]) {
    const f = fixture(options); await assert.rejects(verifyOfflineSigning({ ...verifyCfg, fetcher: f.fetcher })); assert.equal(f.calls.some(c => c.path.startsWith('/v1/')), false);
  }
});
test('disabled or wrong-audience signing still cleans the confirmed fixture', async () => {
  for (const options of [{ disabled: true }, { badAudience: true }]) {
    const f = fixture(options); await assert.rejects(verifyOfflineSigning({ ...verifyCfg, fetcher: f.fetcher })); assert.equal(f.calls.filter(c => c.method === 'DELETE').length, 2);
  }
});
test('unconfirmed resource identifiers are never deleted and cleanup failures are reported', async () => {
  const malformed = fixture({ malformedProject: true }); await assert.rejects(verifyOfflineSigning({ ...verifyCfg, fetcher: malformed.fetcher }), /project was not confirmed/);
  assert.equal(malformed.calls.some(c => c.method === 'DELETE'), false);
  const failure = fixture({ cleanupFailure: true }); await assert.rejects(verifyOfflineSigning({ ...verifyCfg, fetcher: failure.fetcher }), /cleanup could not be confirmed/);
});
