/* global document */
import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { createHash, generateKeyPairSync } from 'node:crypto';
import offlineAssignments from '../../../server/lib/util/offline-assignments.js';
const dist = resolve(import.meta.dirname, '../../dist');
const task = '11111111-1111-4111-8111-111111111111';
const key = 'fixture-offline-page-key';
let server; let origin; let settings;
const json = (response, data) => { response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(data)); };
test.beforeAll(async () => {
  test.skip(!existsSync(resolve(dist, 'index.html')), 'Production build required for the real service worker');
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  settings = { key: pair.privateKey, publicKey: pair.publicKey.export({ format: 'jwk' }),
    keyId: createHash('sha256').update(pair.publicKey.export({ format: 'der', type: 'spki' })).digest('hex') };
  server = createServer((request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/client-config.json') { json(response, {}); return; }
    if (path === '/version.txt') { response.writeHead(200, { 'content-type': 'text/plain' }); response.end('fixture'); return; }
    if (path.startsWith('/v1/')) {
      if (request.headers.authorization !== `Bearer ${key}`) { response.writeHead(401); response.end(); return; }
      const item = { id: task, question: 'Do not cache this private task.', xmlFormId: 'verify', formName: 'Verify', status: 'requested', actionable: true };
      if (path.endsWith('/backchecks')) json(response, { appUser: { name: 'Checker', projectName: 'Project' }, items: [item], nextCursor: null });
      else if (path.endsWith('/offline-assignments')) json(response, { enabled: true, bundle: offlineAssignments.issue({ ...settings, origin },
        { actorId: 1, projectId: 1, displayName: 'Checker', projectName: 'Project' }, [item], new Date(), [], { items: [{ id: task, assetName: 'Water point', externalId: 'WP-01', assetType: 'water-point',
          predicate: 'condition', instruction: 'Private re-verification visit.', xmlFormId: 'verify', formName: 'Verify',
          plannedVisitDate: '2026-10-19', visitBy: null, dispatchedAt: new Date().toISOString(), actionable: true }], complete: true, omitted: 0 }) });
      else if (path.endsWith('/push')) json(response, { enabled: false, subscriptions: [] });
      else json(response, { items: [], complete: true, receipts: [], head: null });
      return;
    }
    const file = resolve(dist, path === '/fieldwork' ? 'index.html' : path.slice(1));
    if (!file.startsWith(`${dist}/`) || !existsSync(file)) { response.writeHead(404); response.end(); return; }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
    const body = readFileSync(file);
    if (['.html', '.js', '.css'].includes(extname(file))) {
      const compressed = gzipSync(body); response.writeHead(200, { 'content-type': types[extname(file)], 'content-encoding': 'gzip', 'content-length': compressed.length }); response.end(compressed);
    } else { response.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' }); response.end(body); }
  });
  await new Promise(resolveListening => server.listen(0, '127.0.0.1', resolveListening));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => {
  if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
});

test('a prepared production page reloads offline while private tasks remain only in the encrypted vault', async ({ page, context }) => {
  test.setTimeout(60000);
  await page.goto(`${origin}/fieldwork`);
  await page.getByLabel('App User access key or Collect server URL').fill(key);
  await page.getByRole('button', { name: 'Open my inbox', exact: true }).click();
  await expect(page.getByText('Do not cache this private task.', { exact: true })).toBeVisible();
  const snapshot = page.getByRole('region', { name: 'Protected offline assignments' });
  await snapshot.getByLabel('New offline passphrase (12–128 characters)', { exact: true }).fill('separate-fixture-passphrase');
  await snapshot.getByLabel('Confirm offline passphrase', { exact: true }).fill('separate-fixture-passphrase');
  await snapshot.getByRole('button', { name: 'Save encrypted snapshot', exact: true }).click();
  await expect(snapshot.getByRole('status')).toContainText('Encrypted snapshot saved');
  const media = page.getByRole('region', { name: 'Encrypted offline media' });
  await media.getByLabel('Offline media form ID', { exact: true }).fill('verify');
  await media.getByLabel('Offline media submission instance ID').fill('offline-own-source');
  await media.getByLabel('Files to protect').setInputFiles({ name: 'offline-private-photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('Offline original media') });
  await media.getByLabel('Media package passphrase').fill('offline-media-fixture-passphrase');
  await media.getByRole('button', { name: 'Encrypt and save files' }).click();
  await expect(media.getByRole('status')).toContainText('Encrypted media saved');
  const prep = page.getByRole('region', { name: 'Offline page preparation' });
  await prep.getByRole('button', { name: 'Prepare offline page', exact: true }).click();
  await expect(prep.getByRole('status')).toContainText('Offline page prepared', { timeout: 30000 });
  const cacheInfo = await page.evaluate(async () => {
    const names = (await globalThis.caches.keys()).filter(name => name.startsWith('fieldwork-public-shell-v1-'));
    const entries = [];
    for (const name of names) {
      const cache = await globalThis.caches.open(name);
      for (const request of await cache.keys()) entries.push({ url: request.url, body: await (await cache.match(request)).text() });
    }
    return { names, urls: entries.map(e => e.url), privateContent: entries.some(e => e.body.includes('Do not cache this private task.') || e.body.includes('Private re-verification visit.') || e.body.includes('offline-private-photo.jpg') || e.body.includes('Offline original media')) };
  });
  expect(cacheInfo.names).toHaveLength(1); expect(cacheInfo.privateContent).toBe(false);
  expect(cacheInfo.urls.every(url => !url.includes('/v1/') && !url.includes(key))).toBe(true);
  const rejected = await page.evaluate(async () => {
    const registration = await globalThis.navigator.serviceWorker.getRegistration('/fieldwork');
    return new Promise(done => {
      const channel = new MessageChannel(); channel.port1.onmessage = event => { channel.port1.close(); done(event.data); };
      const entry = document.querySelector('script[type="module"][src]').src;
      registration.active.postMessage({ type: 'prepare-offline-page', entry, assets: [entry, `${globalThis.location.origin}/v1/private-data`] }, [channel.port2]);
    });
  });
  expect(rejected.ok).toBe(false);

  await context.setOffline(true); await page.reload();
  await expect(page.getByRole('heading', { name: 'Fieldwork inbox', exact: true })).toBeVisible();
  await expect(page.getByText('Do not cache this private task.', { exact: true })).toHaveCount(0);
  await expect(media).not.toContainText('offline-private-photo.jpg');
  await media.getByLabel('Media package passphrase').fill('offline-media-fixture-passphrase');
  await media.getByRole('button', { name: 'Unlock saved media' }).click();
  await expect(media).toContainText('offline-private-photo.jpg');
  await expect(media.getByRole('button', { name: 'Add unlocked files to upload queue' })).toBeDisabled();
  await snapshot.getByLabel('Saved snapshot passphrase', { exact: true }).fill('separate-fixture-passphrase');
  await snapshot.getByRole('button', { name: 'Unlock saved snapshot', exact: true }).click();
  await expect(snapshot).toContainText('Do not cache this private task.');
  await expect(snapshot).toContainText('Private re-verification visit.');
  await expect(snapshot).toContainText('Planned visit: 2026-10-19 (UTC)');
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= globalThis.innerWidth)).toBe(true);
  await prep.getByRole('button', { name: 'Remove offline page', exact: true }).click();
  await expect(prep.getByRole('status')).toContainText('Prepared public page assets removed');
  expect(await page.evaluate(async () => (await globalThis.caches.keys()).filter(name => name.startsWith('fieldwork-public-shell-v1-')).length)).toBe(0);
});


test('an expired public page cache is not used to reopen offline', async ({ page, context }) => {
  await page.goto(`${origin}/fieldwork`);
  const prep = page.getByRole('region', { name: 'Offline page preparation' });
  await prep.getByRole('button', { name: 'Prepare offline page', exact: true }).click();
  await expect(prep.getByRole('status')).toContainText('Offline page prepared');
  await page.evaluate(async () => {
    for (const name of (await globalThis.caches.keys()).filter(name => name.startsWith('fieldwork-public-shell-v1-'))) {
      const cache = await globalThis.caches.open(name);
      await cache.put('/fieldwork-shell-metadata', new Response(JSON.stringify({ preparedAt: Date.now() - 25 * 3600000 }), { headers: { 'content-type': 'application/json' } }));
    }
  });
  await context.setOffline(true);
  await expect(page.reload()).rejects.toThrow();
  await context.setOffline(false); await page.goto(`${origin}/fieldwork`);
  await prep.getByRole('button', { name: 'Remove offline page', exact: true }).click();
  await expect(prep.getByRole('status')).toContainText('Prepared public page assets removed');
});
