/* global document */
import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
test.use({ channel: 'chromium' });
const dist = resolve(import.meta.dirname, '../../dist'); const CHUNK = 262144;
const collectorKey = 'background-media-collector-key'; const courierKey = 'background-media-courier-key'; const phrase = 'background-media-package-passphrase';
const bytes = Buffer.alloc(CHUNK * 2 + 13, 71); bytes.write('private background media bytes');
const hash = value => createHash('sha256').update(value).digest('hex');
let server; let origin; let authority; let state;
const attest = (kind, details, prefix = 'media-background') => { const payload = Buffer.from(JSON.stringify({ ...details, issuer: origin, purpose: `field-data.${prefix}-${kind}@1` })); return { algorithm: 'ES256', keyId: authority.keyId, publicKey: authority.publicKey, payload: payload.toString('base64url'), signature: sign('sha256', payload, { key: authority.key, dsaEncoding: 'ieee-p1363' }).toString('base64url') }; };
const json = (response, data, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(data)); };
const bodyOf = async request => { const chunks = []; for await (const chunk of request) chunks.push(chunk); return Buffer.concat(chunks); };
const proofFor = id => { const p = state.proofs.get(id); return { ...p, ...(p.authorization.courierGrantId ? { courier: state.courier } : {}), sourceAvailable: p.events.some(e => e.kind === 'delivery') ? state.sourceAvailable : null }; };
const present = () => ({ ...state.upload.manifest, ownerId: 1, status: state.upload.status, offset: state.upload.offset, expiresAt: state.upload.expiresAt, chunkSize: CHUNK });
test.beforeAll(async () => {
  test.skip(!existsSync(resolve(dist, 'index.html')), 'Production build required');
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }); authority = { key: pair.privateKey, publicKey: pair.publicKey.export({ format: 'jwk' }), keyId: hash(pair.publicKey.export({ format: 'der', type: 'spki' })) };
  server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost'); const path = url.pathname;
      if (path === '/worker-control.html') { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><title>Media worker controller</title>'); return; }
      if (path === '/client-config.json') { json(response, {}); return; }
      if (path === '/version.txt') { response.end('background-media-fixture'); return; }
      if (path.startsWith('/v1/')) {
        const cap = path.match(/\/media-background\/([^/]+)\/(progress|complete|chunks\/(\d+))$/);
        if (cap) {
          const p = state.proofs.get(cap[1]); const data = await bodyOf(request); state.calls.push({ path: cap[2], headers: request.headers, closed: state.closed, bytes: data });
          if (!p || hash(request.headers['x-field-data-delivery-token'] ?? '') !== p.authorization.tokenHash || p.events.some(e => e.kind === 'revoke') || state.courier?.events.some(e => e.kind === 'revoke')) { json(response, {}, 404); return; }
          if (cap[2] === 'progress') { json(response, { transfer: present(), proof: proofFor(cap[1]) }); return; }
          if (cap[3] != null) {
            const at = Number(cap[3]); if (state.temporary && at >= CHUNK) { json(response, {}, 503); return; }
            if (hash(data) !== request.headers['x-chunk-sha256'] || at !== state.upload.offset) { json(response, {}, 409); return; }
            state.chunks.push(data); state.upload.offset += data.length; json(response, present()); return;
          }
          if (state.upload.offset !== bytes.length || hash(Buffer.concat(state.chunks)) !== hash(bytes)) { json(response, {}, 409); return; }
          if (!p.events.some(e => e.kind === 'delivery')) {
            const a = p.authorization; const now = new Date().toISOString(); const details = { authorizationId: a.id, uploadId: a.uploadId, projectId: 1, submissionDefId: 22, ownerId: 1, senderId: a.senderId, receivedBy: a.senderId, sha256: hash(bytes), size: bytes.length, blobId: 55, transport: 'background-capability', alreadyReceived: false, receivedAt: now, authorizationPayloadHash: hash(Buffer.from(a.attestation.payload, 'base64url')) };
            if (state.courier) { const g = state.courier.grant; const custody = { grantId: g.id, uploadId: g.uploadId, projectId: 1, submissionDefId: 22, ownerId: 1, receivedBy: 2, sha256: hash(bytes), size: bytes.length, blobId: 55, receivedAt: now, grantPayloadHash: hash(Buffer.from(g.attestation.payload, 'base64url')), transport: 'background-capability', backgroundAuthorizationId: a.id, backgroundAuthorizationPayloadHash: details.authorizationPayloadHash }; state.courier.events.push({ grantId: g.id, kind: 'delivery', details: custody, attestation: attest('delivery', custody, 'media-courier') }); }
            p.events.push({ authorizationId: a.id, kind: 'delivery', details, attestation: attest('delivery', details) }); state.upload.status = 'completed';
          } json(response, proofFor(cap[1])); return;
        }
        const actorId = request.headers.authorization === `Bearer ${courierKey}` ? 2 : 1;
        if (![collectorKey, courierKey].some(key => request.headers.authorization === `Bearer ${key}`)) { json(response, {}, 401); return; }
        if (path.endsWith('/backchecks')) { json(response, { appUser: { name: actorId === 1 ? 'Media collector' : 'Media courier', projectName: 'Project', actorId, projectId: 1 }, items: [], nextCursor: null }); return; }
        if (path.endsWith('/receipts')) { json(response, { receipts: [], head: null }); return; }
        if (path.endsWith('/push')) { json(response, { enabled: false, subscriptions: [] }); return; }
        if (path.endsWith('/media-uploads')) {
          if (request.method === 'POST') { state.upload = { manifest: JSON.parse((await bodyOf(request)).toString()), offset: 0, status: 'pending', expiresAt: new Date(Date.now() + 3600000).toISOString() }; json(response, present()); return; }
          json(response, { items: state.upload ? [present()] : [] }); return;
        }
        if (path.endsWith('/courier')) {
          if (request.method === 'POST') {
            const body = JSON.parse((await bodyOf(request)).toString()); const details = { id: randomUUID(), uploadId: state.upload.manifest.id, projectId: 1, submissionDefId: 22, ownerId: 1, courierId: body.courierId, manifest: state.upload.manifest, issuedAt: new Date().toISOString(), expiresAt: state.upload.expiresAt };
            state.courier = { grant: { ...details, attestation: attest('grant', details, 'media-courier') }, events: [] };
          } json(response, state.courier); return;
        }
        if (state.upload && path.endsWith(`/media-uploads/${state.upload.manifest.id}`)) { json(response, present()); return; }
        if (path.endsWith('/media-background')) {
          if (request.method === 'POST') {
            const body = JSON.parse((await bodyOf(request)).toString()); state.requests.push(body);
            if (!state.proofs.has(body.id)) { const details = { ...body, ownerId: 1, senderId: actorId, projectId: 1, submissionDefId: 22, manifest: state.upload.manifest, issuedAt: new Date().toISOString(), ...(state.courier ? { courierGrantId: state.courier.grant.id, courierGrantPayloadHash: hash(Buffer.from(state.courier.grant.attestation.payload, 'base64url')) } : {}) }; state.proofs.set(body.id, { authorization: { ...details, attestation: attest('authorization', details) }, events: [] }); }
            if (state.lostAuthorization) { state.lostAuthorization = false; json(response, {}, 503); return; }
            const proof = proofFor(body.id); if (state.forge) proof.authorization = { ...proof.authorization, senderId: 99 }; json(response, proof); return;
          } json(response, { items: [...state.proofs.keys()].map(proofFor) }); return;
        }
        const bg = path.match(/\/media-background\/([^/]+)(\/revoke)?$/);
        if (bg) {
          if (!state.proofs.has(bg[1])) { json(response, {}, 404); return; }
          if (bg[2]) {
            if (state.revokeFailure) { state.revokeFailure = false; json(response, {}, 503); return; }
            const p = state.proofs.get(bg[1]); const a = p.authorization; const body = JSON.parse((await bodyOf(request)).toString()); const details = { authorizationId: a.id, uploadId: a.uploadId, projectId: 1, ownerId: 1, senderId: a.senderId, revokedBy: actorId, revokedAt: new Date().toISOString(), reason: body.reason, authorizationPayloadHash: hash(Buffer.from(a.attestation.payload, 'base64url')) };
            const event = { authorizationId: a.id, kind: 'revoke', details, attestation: state.unsignedRevocation ? null : attest('revoke', details) }; p.events.push(event); json(response, { event }); return;
          } json(response, proofFor(bg[1])); return;
        }
        json(response, { items: [], complete: true }); return;
      }
      const file = resolve(dist, path === '/fieldwork' ? 'index.html' : path.slice(1)); if (!file.startsWith(`${dist}/`) || !existsSync(file)) { response.writeHead(404); response.end(); return; }
      response.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' })[extname(file)] || 'application/octet-stream' }); response.end(readFileSync(file));
    } catch { if (!response.headersSent) json(response, {}, 500); else response.end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done)); origin = `http://127.0.0.1:${server.address().port}`;
});
test.beforeEach(() => { state = { proofs: new Map(), requests: [], calls: [], chunks: [], upload: null, courier: null, temporary: true, closed: false, sourceAvailable: true, lostAuthorization: false, forge: false, revokeFailure: false, unsignedRevocation: false }; });
test.afterAll(async () => { if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)); } });
const connect = async (page, actor = 1) => { await page.getByLabel('App User access key or Collect server URL').fill(actor === 1 ? collectorKey : courierKey); await page.getByRole('button', { name: 'Open my inbox', exact: true }).click(); await expect(page.getByText(actor === 1 ? 'Media collector · Project' : 'Media courier · Project', { exact: true })).toBeVisible(); };
const control = async context => { const page = await context.newPage(); await page.goto(`${origin}/worker-control.html`); const cdp = await context.newCDPSession(page); let registrations = []; cdp.on('ServiceWorker.workerRegistrationUpdated', event => { registrations = event.registrations; }); await cdp.send('ServiceWorker.enable'); return { page, cdp, wake: async () => { await expect.poll(() => registrations.find(r => r.scopeURL === `${origin}/fieldwork`)?.registrationId).toBeTruthy(); await cdp.send('ServiceWorker.dispatchSyncEvent', { origin, registrationId: registrations.find(r => r.scopeURL === `${origin}/fieldwork`).registrationId, tag: 'field-data-media-background@1', lastChance: false }); } }; };
const stored = page => page.evaluate(() => new Promise(done => { const open = globalThis.indexedDB.open('field-data-background-media', 1); open.onupgradeneeded = () => { open.transaction.abort(); done([]); }; open.onsuccess = () => { const db = open.result; const tx = db.transaction('jobs', 'readonly'); tx.objectStore('jobs').getAll().onsuccess = async event => { const rows = []; for (const row of event.target.result) { let extractable = false; try { if (row.key) { await crypto.subtle.exportKey('raw', row.key); extractable = true; } } catch { /* key must be non-extractable */ } rows.push({ raw: JSON.stringify(row), keyPresent: !!row.key, ciphertextPresent: !!row.ciphertext, extractable, body: row.body, status: row.status }); } db.close(); done(rows); }; }; }));
const due = page => page.evaluate(() => new Promise(done => { const open = globalThis.indexedDB.open('field-data-background-media', 1); open.onsuccess = () => { const db = open.result; const tx = db.transaction('jobs', 'readwrite'); const s = tx.objectStore('jobs'); s.getAll().onsuccess = event => { for (const row of event.target.result) s.put({ ...row, nextAttemptAt: 0 }); }; tx.oncomplete = () => { db.close(); done(); }; }; }));
const choose = async page => { const panel = page.locator('.background-media'); await panel.getByLabel('Background media file').selectOption({ label: 'private.mp4 · background-media' }); await panel.getByLabel('I authorize this exact media file after the page closes').check(); return panel; };
const prepare = async (page, courier = false) => {
  await page.goto(`${origin}/fieldwork`); await connect(page); let queue = page.locator('.media-uploads'); await queue.getByLabel('Form ID', { exact: true }).fill('binaryType'); await queue.getByLabel('Synced submission instance ID').fill('background-media'); await queue.getByLabel('Media files (up to 20 MB each)').setInputFiles({ name: 'private.mp4', mimeType: 'video/mp4', buffer: bytes }); await queue.getByRole('button', { name: 'Reserve files for courier delivery', exact: true }).click(); await expect(queue).toContainText('Reserved for courier');
  if (courier) {
    const delegation = queue.locator('.media-couriers'); await delegation.getByLabel('Courier transfer ID').fill(state.upload.manifest.id); await delegation.getByLabel('Recipient collector ID').fill('2'); await delegation.getByLabel('I checked the recipient account').check(); await delegation.getByRole('button', { name: 'Authorize media courier', exact: true }).click(); await expect(delegation).toContainText('Courier permission recorded.');
    await queue.getByRole('button', { name: 'Prepare queue for encrypted storage', exact: true }).click(); const vault = page.locator('.offline-media'); await vault.getByLabel('Media package passphrase').fill(phrase); await vault.getByRole('button', { name: 'Encrypt and save files', exact: true }).click(); await expect(vault).toContainText('Encrypted media saved.'); await vault.getByLabel('Media package passphrase').fill(phrase); const exporting = page.waitForEvent('download'); await vault.getByRole('button', { name: 'Export encrypted package', exact: true }).click(); const file = await exporting;
    await page.reload(); await connect(page, 2); await vault.getByLabel('Media package passphrase').fill(phrase); await vault.getByLabel('Import encrypted media package').setInputFiles(await file.path()); await expect(vault).toContainText('Encrypted package imported.'); await vault.getByRole('button', { name: 'Add unlocked files to upload queue', exact: true }).click(); queue = page.locator('.media-uploads'); await queue.getByRole('button', { name: 'Reserve files for courier delivery', exact: true }).click(); await expect(queue).toContainText('Reserved for courier');
  }
  return choose(page);
};
for (const courier of [false, true]) test(`${courier ? 'named courier' : 'collector'} resumes exact media from a restarted worker with every Fieldwork page closed`, async ({ page, context }) => {
  test.setTimeout(90000); const worker = await control(context); const panel = await prepare(page, courier); await panel.getByRole('button', { name: 'Authorize background media', exact: true }).click(); await expect(panel).toContainText('Background media authorized.'); await worker.wake(); await expect.poll(async () => (await stored(page))[0]?.status).toBe('retry'); expect(state.upload.offset).toBe(CHUNK);
  const row = (await stored(page))[0]; expect(row.keyPresent).toBe(true); expect(row.extractable).toBe(false); for (const secret of [collectorKey, courierKey, phrase, 'private background media bytes', bytes.toString('base64')]) expect(row.raw).not.toContain(secret);
  await due(page); await page.close(); state.closed = true; expect(context.pages().filter(value => value.url().startsWith(`${origin}/fieldwork`))).toHaveLength(0); await worker.cdp.send('ServiceWorker.stopAllWorkers'); state.temporary = false; await worker.wake(); await expect.poll(() => state.upload.status).toBe('completed'); expect(Buffer.concat(state.chunks)).toEqual(bytes); expect(state.calls.filter(value => value.closed && value.path.startsWith('chunks/'))[0].path).toBe(`chunks/${CHUNK}`);
  for (const call of state.calls) { expect(call.headers.authorization).toBeUndefined(); expect(call.headers.cookie).toBeUndefined(); }
  const reopened = await context.newPage(); await reopened.goto(`${origin}/fieldwork`); await connect(reopened, courier ? 2 : 1); const recovered = reopened.locator('.background-media'); await recovered.getByRole('button', { name: 'Refresh background media deliveries' }).click(); await expect(recovered).toContainText('Signed background media delivery receipt recorded.'); const accepted = (await stored(reopened))[0]; expect(accepted.keyPresent).toBe(false); expect(accepted.ciphertextPresent).toBe(false); expect(accepted.body.expiresAt).toBe(row.body.expiresAt);
  const proof = proofFor([...state.proofs.keys()][0]); const { verifyMediaBackgroundProof } = await import('../../../../cloudflare/verify-media-background.mjs'); expect((await verifyMediaBackgroundProof(proof, { issuer: origin, projectId: 1, publicKeys: [authority.publicKey] })).delivery.receivedBy).toBe(courier ? 2 : 1);
  state.sourceAvailable = false; await recovered.getByRole('button', { name: 'Inspect background media receipt' }).click(); await expect(recovered).toContainText('Historical receipt'); await reopened.setViewportSize({ width: 320, height: 700 }); expect(await reopened.evaluate(() => document.documentElement.scrollWidth <= globalThis.innerWidth)).toBe(true);
});
test('collector revocation stops queued courier media and scrubs the worker secrets', async ({ page, context }) => {
  const worker = await control(context); const panel = await prepare(page, true); await panel.getByRole('button', { name: 'Authorize background media', exact: true }).click(); await expect(panel).toContainText('Background media authorized.'); await worker.wake(); await expect.poll(async () => (await stored(page))[0]?.status).toBe('retry');
  const g = state.courier.grant; const details = { grantId: g.id, uploadId: g.uploadId, projectId: 1, revokedBy: 1, revokedAt: new Date().toISOString(), reason: 'Collector withdrew media courier authority.', grantPayloadHash: hash(Buffer.from(g.attestation.payload, 'base64url')) }; state.courier.events.push({ grantId: g.id, kind: 'revoke', details, attestation: attest('revoke', details, 'media-courier') });
  await due(page); await page.close(); await worker.cdp.send('ServiceWorker.stopAllWorkers'); state.temporary = false; await worker.wake(); await expect.poll(async () => (await stored(worker.page))[0]?.status).toBe('stopped'); expect((await stored(worker.page))[0].keyPresent).toBe(false); expect(state.upload.status).toBe('pending');
});
test('an uncertain background media authorization retries the immutable token and deadline after reload', async ({ page, context }) => {
  const worker = await control(context); const panel = await prepare(page); state.lostAuthorization = true; await panel.getByRole('button', { name: 'Authorize background media', exact: true }).click(); await expect(panel.getByRole('alert')).toBeVisible(); expect(state.calls).toHaveLength(0);
  await page.reload(); await connect(page); const recovered = page.locator('.background-media'); await recovered.getByRole('button', { name: 'Refresh background media deliveries' }).click(); await recovered.getByRole('button', { name: 'Retry exact background media authorization' }).click(); await expect(recovered).toContainText('Background media authorized.'); expect(state.requests).toHaveLength(2); expect(state.requests[0]).toEqual(state.requests[1]); await worker.wake(); await expect.poll(async () => (await stored(page))[0]?.status).toBe('retry');
});
test('local cancellation scrubs media secrets before a failed server revocation and reports unsigned revocation', async ({ page, context }) => {
  const worker = await control(context); const panel = await prepare(page); await panel.getByRole('button', { name: 'Authorize background media', exact: true }).click(); await expect(panel).toContainText('Background media authorized.'); await worker.wake(); await expect.poll(async () => (await stored(page))[0]?.status).toBe('retry');
  state.revokeFailure = true; await panel.getByRole('button', { name: 'Cancel background media authorization' }).click(); await expect(panel.getByRole('alert')).toContainText('Server revocation is unconfirmed'); expect((await stored(page))[0].keyPresent).toBe(false);
  state.unsignedRevocation = true; await panel.getByRole('button', { name: 'Cancel background media authorization' }).click(); await expect(panel).toContainText('permanently revoked'); await panel.getByRole('button', { name: 'Inspect background media receipt' }).click(); await expect(panel).toContainText('its signature was unavailable');
});
test('a substituted media authorization never activates the encrypted outbound copy', async ({ page }) => {
  const panel = await prepare(page); state.forge = true; await panel.getByRole('button', { name: 'Authorize background media', exact: true }).click(); await expect(panel.getByRole('alert')).toBeVisible(); expect(state.calls).toHaveLength(0); expect((await stored(page))[0].status).toBe('authorizing');
});
test('disabled Background Sync reserves no background capability and creates no outbound copy', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(globalThis.ServiceWorkerRegistration.prototype, 'sync', { configurable: true, get: () => ({ register: async () => { throw new DOMException('Disabled', 'UnknownError'); } }) }); }); const panel = await prepare(page); await panel.getByRole('button', { name: 'Authorize background media', exact: true }).click(); await expect(panel.getByRole('alert')).toBeVisible(); expect(state.requests).toHaveLength(0); expect(await stored(page)).toHaveLength(0);
});

test('expired outbound media is scrubbed before another capability request', async ({ page, context }) => {
  const worker = await control(context); const panel = await prepare(page); await panel.getByRole('button', { name: 'Authorize background media', exact: true }).click(); await expect(panel).toContainText('Background media authorized.'); await worker.wake(); await expect.poll(async () => (await stored(page))[0]?.status).toBe('retry'); const count = state.calls.length;
  await page.evaluate(() => new Promise(done => { const open = globalThis.indexedDB.open('field-data-background-media', 1); open.onsuccess = () => { const db = open.result; const tx = db.transaction('jobs', 'readwrite'); const s = tx.objectStore('jobs'); s.getAll().onsuccess = event => { for (const row of event.target.result) s.put({ ...row, expiresAt: Date.now() - 1 }); }; tx.oncomplete = () => { db.close(); done(); }; }; }));
  await page.close(); await worker.cdp.send('ServiceWorker.stopAllWorkers'); await worker.wake(); await expect.poll(async () => (await stored(worker.page))[0]?.status).toBe('expired'); const row = (await stored(worker.page))[0]; expect(row.keyPresent).toBe(false); expect(row.ciphertextPresent).toBe(false); expect(state.calls).toHaveLength(count);
});
test('persistent temporary media failures stop after five retries and preserve the original deadline', async ({ page, context }) => {
  const worker = await control(context); const panel = await prepare(page); await panel.getByRole('button', { name: 'Authorize background media', exact: true }).click(); await expect(panel).toContainText('Background media authorized.'); await worker.wake(); await expect.poll(async () => (await stored(page))[0]?.status).toBe('retry'); const deadline = (await stored(page))[0].body.expiresAt;
  for (let attempt = 2; attempt <= 6; attempt += 1) { await due(page); await worker.wake(); await expect.poll(async () => (await stored(page))[0]?.status).toBe(attempt === 6 ? 'stopped' : 'retry'); }
  const row = (await stored(page))[0]; expect(row.keyPresent).toBe(false); expect(row.ciphertextPresent).toBe(false); expect(row.body.expiresAt).toBe(deadline); expect(state.upload.offset).toBe(CHUNK); expect(state.calls.filter(call => call.path === 'chunks/0')).toHaveLength(1);
});
