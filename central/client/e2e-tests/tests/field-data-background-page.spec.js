/* global document */
import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
// The minimal headless shell disables Background Sync; use Chromium's full browser implementation.
test.use({ channel: 'chromium' });
const dist = resolve(import.meta.dirname, '../../dist');
const key = 'fixture-background-app-user-key'; const phrase = 'background-original-package-passphrase';
const xml = '<data id="verify" version="1"><answer>private closed-page XML</answer><meta><instanceID>background-browser</instanceID></meta></data>';
let server; let origin; let authority; let state;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const attest = (kind, details) => {
  const bytes = Buffer.from(JSON.stringify({ ...details, purpose: `field-data.xml-background-${kind}@1`, issuer: origin }));
  return { algorithm: 'ES256', keyId: authority.keyId, publicKey: authority.publicKey, payload: bytes.toString('base64url'), signature: sign('sha256', bytes, { key: authority.key, dsaEncoding: 'ieee-p1363' }).toString('base64url') };
};
const json = (response, data, status = 200, headers = {}) => { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }); response.end(JSON.stringify(data)); };
const bodyOf = async request => { const chunks = []; for await (const chunk of request) chunks.push(chunk); return Buffer.concat(chunks); };
test.beforeAll(async () => {
  test.skip(!existsSync(resolve(dist, 'index.html')), 'Production build required for background worker verification');
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }); authority = { key: pair.privateKey, publicKey: pair.publicKey.export({ format: 'jwk' }), keyId: hash(pair.publicKey.export({ type: 'spki', format: 'der' })) };
  server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost'); const path = url.pathname;
      if (path === '/worker-control.html') { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<!doctype html><title>Browser automation controller</title>'); return; }
      if (path === '/client-config.json') { json(response, {}); return; }
      if (path === '/version.txt') { response.writeHead(200, { 'content-type': 'text/plain' }); response.end('background-fixture'); return; }
      if (path.startsWith('/v1/')) {
        const delivery = path.match(/\/xml-background\/([^/]+)\/deliver$/);
        if (delivery) {
          const p = state.proofs.get(delivery[1]); const bytes = await bodyOf(request); state.deliveries.push({ bytes, headers: request.headers, closed: state.closed });
          if (!p || hash(request.headers['x-field-data-delivery-token'] ?? '') !== p.authorization.tokenHash || p.events.some(e => e.kind === 'revoke')) { json(response, {}, 404); return; }
          if (state.deliveryMode === 'temporary') { json(response, {}, 503, { 'Retry-After': '1' }); return; }
          if (hash(bytes) !== p.target.manifest.sha256) { json(response, {}, 409); return; }
          if (!p.events.some(e => e.kind === 'delivery')) {
            const now = new Date().toISOString(); const details = { authorizationId: p.authorization.id, targetId: p.target.id, projectId: 1, formId: 12, formDefId: 22, ownerId: 1, submissionDefId: 101, ...(p.target.manifest.deprecatedId ? { deprecatedId: p.target.manifest.deprecatedId, baseSha256: p.target.manifest.baseSha256, baseSubmissionDefId: 100 } : {}), sha256: p.target.manifest.sha256, size: bytes.length, transport: 'background-capability', alreadyReceived: false, submissionReceivedAt: now, acceptedAt: now, authorizationPayloadHash: hash(Buffer.from(p.authorization.attestation.payload, 'base64url')) };
            p.events.push({ targetId: p.target.id, authorizationId: p.authorization.id, kind: 'delivery', details, attestation: attest('delivery', details) }); p.sourceAvailable = true;
          }
          json(response, p); return;
        }
        if (request.headers.authorization !== `Bearer ${key}`) { json(response, {}, 401); return; }
        if (path.endsWith('/xml-couriers/edit-base')) { json(response, { deprecatedId: url.searchParams.get('deprecatedId'), baseSha256: 'b'.repeat(64), baseSubmissionDefId: 100, current: true }); return; }
        if (path.endsWith('/backchecks')) { json(response, { appUser: { name: 'Original collector', projectName: 'Project', actorId: 1, projectId: 1 }, items: [], nextCursor: null }); return; }
        if (path.endsWith('/receipts')) { json(response, { receipts: [], head: null }); return; }
        if (path.endsWith('/push')) { json(response, { enabled: false, subscriptions: [] }); return; }
        if (path.endsWith('/reverification') || path.endsWith('/itineraries')) { json(response, { items: [], complete: true }); return; }
        if (path.endsWith('/submission')) { state.foreground.push(request.headers); await bodyOf(request); response.writeHead(201, { 'content-type': 'text/xml' }); response.end('<OpenRosaResponse/>'); return; }
        if (path.endsWith('/xml-background') && request.method === 'POST') {
          const body = JSON.parse((await bodyOf(request)).toString()); state.requests.push(body); let p = state.proofs.get(body.id);
          if (!p) {
            const target = { id: randomUUID(), projectId: 1, formId: 12, formDefId: 22, ownerId: 1, manifest: body.manifest };
            const details = { id: body.id, targetId: target.id, projectId: 1, formId: 12, formDefId: 22, ownerId: 1, manifest: body.manifest, ...(body.manifest.deprecatedId ? { baseSubmissionDefId: 100 } : {}), tokenHash: body.tokenHash, issuedAt: new Date().toISOString(), expiresAt: body.expiresAt };
            p = { target, authorization: { id: body.id, targetId: target.id, ownerId: 1, tokenHash: body.tokenHash, expiresAt: body.expiresAt, attestation: attest('authorization', details) }, events: [], sourceAvailable: null }; state.proofs.set(body.id, p);
          }
          if (state.lostAuthorization) { state.lostAuthorization = false; json(response, {}, 503); return; } json(response, p); return;
        }
        if (path.endsWith('/xml-background')) { json(response, { items: [...state.proofs.values()] }); return; }
        const match = path.match(/\/xml-background\/([^/]+)(\/revoke)?$/);
        if (match) {
          const p = state.proofs.get(match[1]); if (!p) { json(response, {}, 404); return; }
          if (match[2]) {
            if (state.revokeFailure) { state.revokeFailure = false; json(response, {}, 503); return; }
            const body = JSON.parse((await bodyOf(request)).toString()); const details = { authorizationId: p.authorization.id, targetId: p.target.id, projectId: 1, ownerId: 1, revokedBy: 1, revokedAt: new Date().toISOString(), reason: body.reason, authorizationPayloadHash: hash(Buffer.from(p.authorization.attestation.payload, 'base64url')) };
            const event = { targetId: p.target.id, authorizationId: p.authorization.id, kind: 'revoke', details, attestation: state.unsignedRevocation ? null : attest('revoke', details) }; p.events.push(event); json(response, { event }); return;
          }
          json(response, { ...p, sourceAvailable: p.sourceAvailable == null ? null : state.sourceAvailable }); return;
        }
        json(response, { items: [] }); return;
      }
      const file = resolve(dist, path === '/fieldwork' ? 'index.html' : path.slice(1));
      if (!file.startsWith(`${dist}/`) || !existsSync(file)) { response.writeHead(404); response.end(); return; }
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.svg': 'image/svg+xml' };
      response.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' }); response.end(readFileSync(file));
    } catch { if (!response.headersSent) json(response, {}, 500); else response.end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done)); origin = `http://127.0.0.1:${server.address().port}`;
});
test.beforeEach(() => { state = { proofs: new Map(), requests: [], deliveries: [], foreground: [], deliveryMode: 'temporary', sourceAvailable: true, lostAuthorization: false, closed: false, revokeFailure: false, unsignedRevocation: false }; });
test.afterAll(async () => { if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)); } });
const connect = async page => { await page.getByLabel('App User access key or Collect server URL').fill(key); await page.getByRole('button', { name: 'Open my inbox', exact: true }).click(); await expect(page.getByText('Original collector · Project', { exact: true })).toBeVisible(); };
const prepare = async (page, source = xml) => {
  await page.goto(`${origin}/fieldwork`); await connect(page); const queue = page.locator('.offline-submissions'); const panel = page.locator('.background-submissions');
  await queue.getByLabel('New submission XML files').setInputFiles({ name: 'background.xml', mimeType: 'text/xml', buffer: Buffer.from(source) }); await queue.getByLabel('Submission queue passphrase').fill(phrase); await queue.getByRole('button', { name: 'Encrypt and save submissions' }).click(); await expect(queue).toContainText('Encrypted submissions saved.');
  await panel.getByLabel('I authorize this exact XML after the page closes').check(); return { queue, panel };
};
const controller = async context => {
  const page = await context.newPage(); await page.goto(`${origin}/worker-control.html`); const cdp = await context.newCDPSession(page); let registrations = [];
  cdp.on('ServiceWorker.workerRegistrationUpdated', event => { registrations = event.registrations; }); await cdp.send('ServiceWorker.enable');
  return { page, cdp, id: async () => { await expect.poll(() => registrations.find(r => r.scopeURL === `${origin}/fieldwork`)?.registrationId).toBeTruthy(); return registrations.find(r => r.scopeURL === `${origin}/fieldwork`).registrationId; } };
};
const wake = async page => {
  const cdp = await page.context().newCDPSession(page); let registrations = [];
  cdp.on('ServiceWorker.workerRegistrationUpdated', event => { registrations = event.registrations; }); await cdp.send('ServiceWorker.enable');
  try {
    await expect.poll(() => registrations.find(r => r.scopeURL === `${origin}/fieldwork`)?.registrationId).toBeTruthy();
    await cdp.send('ServiceWorker.dispatchSyncEvent', { origin, registrationId: registrations.find(r => r.scopeURL === `${origin}/fieldwork`).registrationId, tag: 'field-data-xml-background@1', lastChance: false });
  } finally { await cdp.detach(); }
};
const stored = page => page.evaluate(() => new Promise((resolveRows, reject) => { const open = globalThis.indexedDB.open('field-data-background-xml', 1); open.onupgradeneeded = () => { open.transaction.abort(); resolveRows([]); }; open.onerror = reject; open.onsuccess = () => { const db = open.result; const tx = db.transaction('jobs', 'readonly'); const read = tx.objectStore('jobs').getAll(); read.onsuccess = async () => { const rows = read.result; const info = []; for (const row of rows) { let extractable; try { if (row.key) await crypto.subtle.exportKey('raw', row.key); extractable = true; } catch { extractable = false; } info.push({ raw: JSON.stringify(row), keyPresent: row.key != null, keyExtractable: row.key != null && extractable, ciphertextPresent: row.ciphertext != null, status: row.status, body: row.body }); } db.close(); resolveRows(info); }; }; }));

test('a restarted real service worker delivers exact encrypted outbound XML after every Fieldwork page closes, then recovers a signed acknowledgement', async ({ page, context }) => {
  test.setTimeout(90000); const control = await controller(context); const { panel } = await prepare(page);
  await panel.getByRole('button', { name: 'Authorize background XML', exact: true }).click(); await expect(panel).toContainText('Background XML authorized.'); await wake(page); await expect.poll(async () => (await stored(page))[0]?.status).toBe('retry');
  const rows = await stored(page); expect(rows).toHaveLength(1); expect(rows[0].keyPresent).toBe(true); expect(rows[0].keyExtractable).toBe(false); expect(rows[0].ciphertextPresent).toBe(true);
  for (const value of [key, phrase, 'private closed-page XML', '<data']) expect(rows[0].raw).not.toContain(value);
  const originalExpiry = rows[0].body.expiresAt; const registrationId = await control.id(); await page.close(); state.closed = true;
  expect(context.pages().filter(p => p.url().startsWith(`${origin}/fieldwork`))).toHaveLength(0); await control.cdp.send('ServiceWorker.stopAllWorkers'); state.deliveryMode = 'accept';
  const since = Date.now(); await expect.poll(() => Date.now() - since, { timeout: 10000 }).toBeGreaterThan(6200);
  await control.cdp.send('ServiceWorker.dispatchSyncEvent', { origin, registrationId, tag: 'field-data-xml-background@1', lastChance: false });
  await expect.poll(() => state.deliveries.length, { timeout: 15000 }).toBe(2); expect(state.deliveries[1].closed).toBe(true); expect(state.deliveries[1].bytes).toEqual(Buffer.from(xml)); expect(state.deliveries[1].headers.authorization).toBeUndefined(); expect(state.deliveries[1].headers.cookie).toBeUndefined();
  const reopened = await context.newPage(); await reopened.goto(`${origin}/fieldwork`); await connect(reopened); const q = reopened.locator('.offline-submissions'); const p = reopened.locator('.background-submissions');
  await q.getByLabel('Submission queue passphrase').fill(phrase); await q.getByRole('button', { name: 'Unlock submission queue' }).click(); await p.getByRole('button', { name: 'Refresh background deliveries' }).click(); await expect(p).toContainText('Signed background delivery receipt recorded.');
  const completed = await stored(reopened); expect(completed[0].keyPresent).toBe(false); expect(completed[0].ciphertextPresent).toBe(false); expect(completed[0].body.expiresAt).toBe(originalExpiry);
  state.sourceAvailable = false; await p.getByRole('button', { name: 'Save background delivery acknowledgement' }).click(); await expect(p.getByRole('alert')).toBeVisible(); await expect(q.getByRole('listitem').first()).toContainText('Pending');
  state.sourceAvailable = true; await p.getByRole('button', { name: 'Inspect background receipt' }).click(); await p.getByRole('button', { name: 'Save background delivery acknowledgement' }).click(); await expect(q).toContainText('Background delivery acknowledgement saved in the encrypted queue.');
  const { verifyXmlBackgroundProof } = await import('../../../../cloudflare/verify-xml-background.mjs'); const proof = [...state.proofs.values()][0]; expect(verifyXmlBackgroundProof(proof, { issuer: origin, projectId: 1, publicKeys: [authority.publicKey] }).events[0].transport).toBe('background-capability');
  await reopened.setViewportSize({ width: 320, height: 700 }); expect(await reopened.evaluate(() => document.documentElement.scrollWidth <= globalThis.innerWidth)).toBe(true); await control.page.close();
});

test('local cancellation drops delivery secrets even when server revocation loses connectivity, and unsigned revocation is explicit', async ({ page, context }) => {
  test.setTimeout(60000); const control = await controller(context); const { panel } = await prepare(page); await panel.getByRole('button', { name: 'Authorize background XML', exact: true }).click(); await expect(panel).toContainText('Background XML authorized.'); await wake(page); await expect.poll(async () => (await stored(page))[0]?.status).toBe('retry');
  state.revokeFailure = true; await panel.getByRole('button', { name: 'Cancel background authorization' }).click(); await expect(panel.getByRole('alert')).toBeVisible(); const rows = await stored(page); expect(rows[0].keyPresent).toBe(false); expect(rows[0].ciphertextPresent).toBe(false);
  state.unsignedRevocation = true; await panel.getByRole('button', { name: 'Cancel background authorization' }).click(); await expect(panel).toContainText('permanently revoked'); await panel.getByRole('button', { name: 'Inspect background receipt' }).click(); await expect(panel).toContainText('its signature was unavailable');
  const registrationId = await control.id(); await page.close(); state.deliveryMode = 'accept'; await control.cdp.send('ServiceWorker.stopAllWorkers'); await control.cdp.send('ServiceWorker.dispatchSyncEvent', { origin, registrationId, tag: 'field-data-xml-background@1', lastChance: false });
  const after = await context.newPage(); await after.goto(`${origin}/worker-control.html`); expect((await stored(after))[0].status).toBe('cancelled'); expect(state.deliveries).toHaveLength(1);
});

test('an uncertain authorization survives reload and retries the same token hash, manifest and deadline', async ({ page }) => {
  test.setTimeout(60000); const { panel } = await prepare(page); state.lostAuthorization = true; await panel.getByRole('button', { name: 'Authorize background XML', exact: true }).click(); await expect(panel.getByRole('alert')).toBeVisible(); expect(state.deliveries).toHaveLength(0);
  await page.reload(); await connect(page); await panel.getByRole('button', { name: 'Refresh background deliveries' }).click(); await panel.getByRole('button', { name: 'Retry exact background authorization' }).click(); await expect(panel).toContainText('Background XML authorized.'); await wake(page); expect(state.requests).toHaveLength(2); expect(state.requests[0]).toEqual(state.requests[1]); await expect.poll(async () => (await stored(page))[0]?.status).toBe('retry');
});

test('an unsupported Background Sync browser creates no authorization and retains foreground delivery', async ({ page }) => {
  await page.addInitScript(() => { if (globalThis.ServiceWorkerRegistration) Object.defineProperty(globalThis.ServiceWorkerRegistration.prototype, 'sync', { configurable: true, get: () => undefined }); });
  const { panel, queue } = await prepare(page); await panel.getByRole('button', { name: 'Authorize background XML', exact: true }).click(); await expect(panel.getByRole('alert')).toBeVisible(); expect(state.requests).toHaveLength(0);
  await queue.getByRole('button', { name: 'Upload queued XML now' }).click(); await expect(queue).toContainText('XML accepted. Recover referenced media separately'); expect(state.foreground[0].authorization).toBe(`Bearer ${key}`);
});


const makeDue = page => page.evaluate(() => new Promise(done => {
  const open = globalThis.indexedDB.open('field-data-background-xml', 1); open.onsuccess = () => { const db = open.result; const tx = db.transaction('jobs', 'readwrite'); const store = tx.objectStore('jobs'); store.getAll().onsuccess = event => { for (const row of event.target.result) store.put({ ...row, nextAttemptAt: 0 }); }; tx.oncomplete = () => { db.close(); done(); }; };
}));

test('temporary failures stop after five retries without extending the authorization or retaining delivery secrets', async ({ page, context }) => {
  test.setTimeout(60000); const control = await controller(context); const { panel } = await prepare(page); await panel.getByRole('button', { name: 'Authorize background XML', exact: true }).click(); await expect(panel).toContainText('Background XML authorized.'); await wake(page); await expect.poll(async () => (await stored(page))[0]?.status).toBe('retry'); const deadline = (await stored(page))[0].body.expiresAt; const registrationId = await control.id();
  for (let attempt = 2; attempt <= 6; attempt += 1) {
    await makeDue(page); await control.cdp.send('ServiceWorker.dispatchSyncEvent', { origin, registrationId, tag: 'field-data-xml-background@1', lastChance: false });
    await expect.poll(async () => (await stored(page))[0]?.status).toBe(attempt === 6 ? 'stopped' : 'retry');
  }
  expect(state.deliveries).toHaveLength(6); const row = (await stored(page))[0]; expect(row.keyPresent).toBe(false); expect(row.ciphertextPresent).toBe(false); expect(row.body.expiresAt).toBe(deadline);
});

test('a browser deadline scrubs an expired outbound copy without another delivery attempt', async ({ page, context }) => {
  test.setTimeout(60000); const control = await controller(context); const { panel } = await prepare(page); await panel.getByRole('button', { name: 'Authorize background XML', exact: true }).click(); await expect(panel).toContainText('Background XML authorized.'); await wake(page); await expect.poll(async () => (await stored(page))[0]?.status).toBe('retry');
  await page.evaluate(() => new Promise(done => { const open = globalThis.indexedDB.open('field-data-background-xml', 1); open.onsuccess = () => { const db = open.result; const tx = db.transaction('jobs', 'readwrite'); const store = tx.objectStore('jobs'); store.getAll().onsuccess = event => { for (const row of event.target.result) store.put({ ...row, expiresAt: Date.now() - 1 }); }; tx.oncomplete = () => { db.close(); done(); }; }; }));
  const registrationId = await control.id(); await page.close(); await control.cdp.send('ServiceWorker.stopAllWorkers'); await control.cdp.send('ServiceWorker.dispatchSyncEvent', { origin, registrationId, tag: 'field-data-xml-background@1', lastChance: false });
  await expect.poll(async () => (await stored(control.page))[0]?.status).toBe('expired');
  const row = (await stored(control.page))[0]; expect(row.status).toBe('expired'); expect(row.keyPresent).toBe(false); expect(state.deliveries).toHaveLength(1);
});


test('an encrypted background edit requires a reviewed prior hash and verifies both versions in its receipt', async ({ page }) => {
  const source = '<data id="verify" version="1"><base64EncryptedKey>a2V5</base64EncryptedKey><encryptedXmlFile>submission.xml.enc</encryptedXmlFile><base64EncryptedElementSignature>c2ln</base64EncryptedElementSignature><meta><instanceID>background-sealed-edit</instanceID><deprecatedID>background-sealed-prior</deprecatedID></meta></data>';
  state.deliveryMode = 'accept'; const { panel, queue } = await prepare(page, source);
  await expect(panel.getByRole('button', { name: 'Authorize background XML', exact: true })).toBeDisabled(); await panel.getByRole('button', { name: 'Review background edit base' }).click(); await expect(panel).toContainText('Background edit base reviewed.');
  await expect(panel.getByLabel('I authorize this exact XML after the page closes')).not.toBeChecked(); await panel.getByLabel('I authorize this exact XML after the page closes').check();
  await panel.getByRole('button', { name: 'Authorize background XML', exact: true }).click(); await expect(panel).toContainText('Background XML authorized.'); await wake(page); await expect(panel).toContainText('Signed background delivery receipt recorded.');
  expect(state.requests[0].manifest.deprecatedId).toBe('background-sealed-prior'); expect(state.requests[0].manifest.baseSha256).toBe('b'.repeat(64)); expect(state.deliveries[0].bytes).toEqual(Buffer.from(source));
  await panel.getByRole('button', { name: 'Save background delivery acknowledgement' }).click(); await expect(queue).toContainText('Background delivery acknowledgement saved in the encrypted queue.');
  const { verifyXmlBackgroundProof } = await import('../../../../cloudflare/verify-xml-background.mjs'); expect(verifyXmlBackgroundProof([...state.proofs.values()][0], { issuer: origin, projectId: 1, publicKeys: [authority.publicKey] }).events[0].baseSubmissionDefId).toBe(100);
});


test('a present but disabled Background Sync API creates no outbound copy or server authorization', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(globalThis.ServiceWorkerRegistration.prototype, 'sync', { configurable: true, get: () => ({ register: async () => { throw new DOMException('Background Sync is disabled.', 'UnknownError'); } }) }); });
  const { panel } = await prepare(page); await panel.getByRole('button', { name: 'Authorize background XML', exact: true }).click(); await expect(panel.getByRole('alert')).toBeVisible(); expect(state.requests).toHaveLength(0); expect(await stored(page)).toHaveLength(0);
});
