/* global document, localStorage, sessionStorage */
import { expect, test } from '@playwright/test';
import { createHash, createPublicKey, generateKeyPairSync } from 'node:crypto';
import offlineAssignments from '../../../server/lib/util/offline-assignments.js';
const appUrl = process.env.ODK_URL || 'http://127.0.0.1:8989';
const taskId = '11111111-1111-4111-8111-111111111111';
const pushId = '22222222-2222-4222-8222-222222222222';
const key = 'fixture-app-user-key';
const visitFixture = { id: '88888888-8888-4888-8888-888888888888', assetName: 'Water point', externalId: 'WP-01', assetType: 'water-point',
  predicate: 'condition', instruction: 'Check the pump handle. <img src=x onerror=alert(1)>', xmlFormId: 'verification',
  formName: 'Independent verification', plannedVisitDate: '2026-10-19', visitBy: '2026-10-20T00:00:00Z', dispatchedAt: '2026-10-09T10:00:00Z', actionable: true };
const setup = async (page, { push = false, denied = false, fail = false, delayed = false, failDelete = false, offline = false, offlineOrigin = null, visits = [], failVisits = false, receipts = [], failReceipts = false, itineraries = [], failItineraries = false, offlineItineraries, offlineVisits } = {}) => {
  const state = { inboxReads: 0, seen: false, registered: false, deleted: false, failures: fail ? 1 : 0, requests: [] };
  const errors = [];
  if (offline) {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const publicKey = createPublicKey(privateKey);
    state.bundle = offlineAssignments.issue({ key: privateKey, publicKey: publicKey.export({ format: 'jwk' }),
      keyId: createHash('sha256').update(publicKey.export({ format: 'der', type: 'spki' })).digest('hex'),
      origin: offlineOrigin ?? new URL(appUrl).origin },
    { actorId: 42, projectId: 7, displayName: 'Checker', projectName: 'Project' },
    [{ id: taskId, question: '<img src=x onerror=alert(1)> Verify the visit.', xmlFormId: 'verification',
      formName: 'Independent verification', dueAt: null, plannedVisitDate: '2026-10-14', status: 'requested', actionable: true, seenAt: null }], new Date(), offlineItineraries, offlineVisits);
  }
  page.on('pageerror', error => errors.push(error.message));
  let release;
  const wait = delayed ? new Promise(resolve => { release = resolve; }) : null;
  await page.addInitScript(({ denied }) => {
    globalThis.window.PushManager = function PushManager() {};
    Object.defineProperty(globalThis.window, 'Notification', { value: { requestPermission: async () => denied ? 'denied' : 'granted' } });
    const subscription = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/browser-fixture',
      toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/browser-fixture', keys: { p256dh: 'fixture', auth: 'fixture' } }),
      unsubscribe: async () => true
    };
    const registration = { active: true, pushManager: { getSubscription: async () => null, subscribe: async () => subscription } };
    Object.defineProperty(globalThis.navigator, 'serviceWorker', { value: { getRegistration: async () => registration, register: async () => registration,
      addEventListener: (name, handler) => { globalThis.window.fieldworkMessage = handler; }, removeEventListener: () => {} } });
  }, { denied });
  await page.route('**/client-config.json', route => route.fulfill({ json: {} }));
  await page.route('**/version.txt', route => route.fulfill({ body: 'test' }));
  await page.route('**/v1/**', async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (!path.startsWith('/v1/field-data/app-user/')) return route.fulfill({ json: {} });
    state.requests.push({ url: req.url(), authorization: req.headers().authorization, method: req.method() });
    if (state.revoked) return route.fulfill({ status: 401, json: {} });
    if (req.headers().authorization !== `Bearer ${key}`) return route.fulfill({ status: 403, json: {} });
    if (path.endsWith('/media-uploads')) return route.fulfill({ json: { items: [] } });
    if (path.endsWith('/offline-assignments')) {
      if (state.offlineWait) await state.offlineWait;
      return route.fulfill({ json: offline ? { enabled: true, bundle: state.bundle } : { enabled: false } });
    }
    if (path.endsWith('/backchecks')) {
      state.inboxReads += 1;
      if (wait && state.inboxReads > 1) await wait;
      if (state.failures > 0) { state.failures -= 1; return route.fulfill({ status: 503, json: {} }); }
      return route.fulfill({ json: { appUser: { name: 'Checker', projectName: 'Project' }, nextCursor: null, items: [
        { id: taskId, question: '<img src=x onerror=alert(1)> Verify the visit.', xmlFormId: 'verification', formName: 'Independent verification',
          dueAt: null, plannedVisitDate: '2026-10-14', status: 'requested', actionable: true, seenAt: state.seen ? '2026-10-09T04:00:00Z' : null }
      ] } });
    }
    if (path.endsWith('/reverification')) {
      if (failVisits) return route.fulfill({ status: 503, json: {} });
      return route.fulfill({ json: { appUser: { name: 'Checker', projectName: 'Project' }, items: visits, complete: true } });
    }
    if (path.endsWith('/receipts')) {
      if (failReceipts) return route.fulfill({ status: 503, json: {} });
      return route.fulfill({ json: { receipts, head: { projectId: 7, seq: receipts[0]?.seq ?? 0, entryHash: receipts[0]?.entryHash ?? '0'.repeat(64), signed: receipts.length ? { algorithm: 'ES256' } : null } } });
    }
    if (path.endsWith('/itineraries')) return route.fulfill({ status: failItineraries ? 503 : 200, json: { items: itineraries } });
    if (path.endsWith('/seen')) { state.seen = true; return route.fulfill({ json: { id: taskId, seenAt: '2026-10-09T04:00:00Z' } }); }
    if (path.endsWith('/push') && req.method() === 'GET')
      return route.fulfill({ json: { enabled: push, publicKey: 'AQID', subscriptions: [] } });
    if (path.endsWith('/push') && req.method() === 'POST') { state.registered = true; return route.fulfill({ json: { id: pushId } }); }
    if (req.method() === 'DELETE') {
      if (failDelete) return route.fulfill({ status: 503, json: {} });
      state.deleted = true; return route.fulfill({ json: { success: true } }); }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto(`${appUrl}/fieldwork`);
  return { state, errors, release };
};
const connect = async (page) => {
  await page.getByLabel('App User access key or Collect server URL').fill(key);
  await page.getByRole('button', { name: 'Open my inbox' }).click();
};

test('App User inbox works without Central login, acknowledges safely and clears credentials on disconnect', async ({ page }) => {
  const { state, errors } = await setup(page);
  await connect(page);
  await expect(page.getByText('Planned visit: 2026-10-14 (UTC date)', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Independent verification (verification)' })).toBeVisible();
  await expect(page.getByText('<img src=x onerror=alert(1)> Verify the visit.', { exact: true })).toBeVisible();
  await expect(page.locator('.tasks img')).toHaveCount(0);
  await expect(page.getByText('Browser push is not configured on this server.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Acknowledge request' }).click();
  await expect(page.getByText('Acknowledged:', { exact: false })).toBeVisible();
  expect(state.seen).toBe(true);
  expect(state.requests.every(req => !req.url.includes(key))).toBe(true);
  expect(await page.evaluate(value => JSON.stringify({ local: { ...globalThis.localStorage }, session: { ...globalThis.sessionStorage } }).includes(value), key)).toBe(false);
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByLabel('App User access key or Collect server URL')).toHaveValue('');
  await expect(page.locator('.tasks')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('browser push registers only after consent and disconnect removes the subscription', async ({ page }) => {
  const { state, errors } = await setup(page, { push: true });
  await connect(page);
  await page.getByRole('button', { name: 'Enable browser notifications' }).click();
  await expect(page.getByRole('button', { name: 'Turn off browser notifications' })).toBeVisible();
  expect(state.registered).toBe(true);
  state.seen = true;
  await page.evaluate(() => globalThis.window.fieldworkMessage({ origin: globalThis.window.location.origin, data: { type: 'fieldwork-inbox-update' } }));
  await expect(page.getByText('Acknowledged:', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open my inbox' })).toBeVisible();
  expect(state.deleted).toBe(true);
  expect(errors).toEqual([]);
});

test('denied browser permission keeps the inbox usable and registers nothing', async ({ page }) => {
  const { state, errors } = await setup(page, { push: true, denied: true });
  await connect(page);
  await page.getByRole('button', { name: 'Enable browser notifications' }).click();
  await expect(page.getByText('Notifications were not permitted.', { exact: false })).toBeVisible();
  expect(state.registered).toBe(false);
  await expect(page.getByRole('button', { name: 'Acknowledge request' })).toBeEnabled();
  expect(errors).toEqual([]);
});

test('inbox retries failed reads', async ({ page }) => {
  const { errors } = await setup(page, { fail: true });
  await connect(page);
  await expect(page.getByRole('alert')).toContainText('The inbox could not be loaded');
  await connect(page);
  await expect(page.getByRole('button', { name: 'Acknowledge request' })).toBeVisible();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  expect(errors).toEqual([]);
});


test('a delayed refresh cannot restore tasks or credentials after disconnect', async ({ page }) => {
  const { state, errors, release } = await setup(page, { delayed: true });
  await connect(page);
  await expect(page.getByRole('button', { name: 'Acknowledge request' })).toBeVisible();
  await page.getByRole('button', { name: 'Refresh inbox' }).click();
  await expect.poll(() => state.inboxReads).toBe(2);
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  release();
  await expect(page.getByLabel('App User access key or Collect server URL')).toHaveValue('');
  await expect(page.locator('.tasks')).toHaveCount(0);
  expect(errors).toEqual([]);
});


test('disconnect clears private tasks and keys even when notification cleanup fails', async ({ page }) => {
  const { errors } = await setup(page, { push: true, failDelete: true });
  await connect(page);
  await page.getByRole('button', { name: 'Enable browser notifications' }).click();
  await expect(page.getByRole('button', { name: 'Turn off browser notifications' })).toBeVisible();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Notification cleanup could not be confirmed');
  await expect(page.getByLabel('App User access key or Collect server URL')).toHaveValue('');
  await expect(page.locator('.tasks')).toHaveCount(0);
  expect(errors).toEqual([]);
});

const passphrase = 'offline-test-passphrase';
const offlinePanel = page => page.getByRole('region', { name: 'Protected offline assignments' });
const saveOffline = async (page) => {
  const panel = offlinePanel(page);
  await panel.getByLabel('New offline passphrase (12–128 characters)').fill(passphrase);
  await panel.getByLabel('Confirm offline passphrase').fill(passphrase);
  await panel.getByRole('button', { name: 'Save encrypted snapshot' }).click();
};
const unlockOffline = async (page, password = passphrase) => {
  const panel = offlinePanel(page);
  await panel.getByLabel('Saved snapshot passphrase').fill(password);
  await panel.getByRole('button', { name: 'Unlock saved snapshot' }).click();
};
const vault = (page, replacement = null) => page.evaluate(value => new Promise((resolve, reject) => {
  const open = globalThis.indexedDB.open('field-data-offline', 1);
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result;
    const tx = db.transaction('snapshots', value == null ? 'readonly' : 'readwrite');
    const store = tx.objectStore('snapshots');
    const request = value == null ? store.get('current') : store.put(value, 'current');
    tx.oncomplete = () => { db.close(); resolve(request.result ?? null); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  };
}), replacement);

test('encrypted assignments survive reload and unlock offline without persisted credentials', async ({ page, context }) => {
  const { state, errors } = await setup(page, { offline: true, offlineVisits: { items: [visitFixture], complete: true, omitted: 0 } });
  await connect(page);
  await saveOffline(page);
  const panel = offlinePanel(page);
  await expect(panel.getByRole('status')).toContainText('Encrypted snapshot saved');
  const raw = JSON.stringify(await vault(page));
  expect(raw).not.toContain(key);
  expect(raw).not.toContain(passphrase);
  expect(raw).not.toContain('Verify the visit');
  expect(raw).not.toContain('Water point');
  expect(raw).not.toContain('Check the pump handle');
  await page.reload();
  await expect(panel.getByLabel('Saved snapshot passphrase')).toBeVisible();
  // The app downloads some cosmetic components (such as the hover cards) just after load. Let
  // those finish before going offline, or the test fails on a download it cut off itself.
  await page.waitForLoadState('networkidle');
  const reads = state.requests.length;
  await context.setOffline(true);
  await unlockOffline(page, 'incorrect-passphrase');
  await expect(panel.getByRole('alert')).toContainText('could not be unlocked');
  await unlockOffline(page);
  await expect(panel).toContainText('Read-only snapshot from');
  await expect(panel.getByRole('heading', { name: 'Offline re-verification visits' })).toBeVisible();
  await expect(panel).toContainText('Water point · WP-01');
  await expect(panel).toContainText('Planned visit: 2026-10-19 (UTC)');
  await expect(panel).toContainText('Check the pump handle.');
  await expect(panel).toContainText('Planned visit: 2026-10-14 (UTC date)');
  await expect(panel).toContainText('<img src=x onerror=alert(1)> Verify the visit.');
  await expect(panel.locator('img')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Acknowledge request' })).toHaveCount(0);
  expect(state.requests.length).toBe(reads);
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= 320)).toBe(true);
  await panel.getByRole('button', { name: 'Forget saved snapshot' }).click();
  await expect(panel.getByRole('status')).toContainText('forgotten');
  expect(await vault(page)).toBeNull();
  await expect(panel.getByText('Read-only snapshot from', { exact: false })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('offline snapshot rejects corrupted ciphertext and expiry', async ({ page }) => {
  const { state, errors } = await setup(page, { offline: true });
  await connect(page);
  await saveOffline(page);
  const panel = offlinePanel(page);
  await expect(panel.getByRole('status')).toContainText('Encrypted snapshot saved');
  const original = await vault(page);
  await vault(page, { ...original, ciphertext: `${original.ciphertext[0] === 'A' ? 'B' : 'A'}${original.ciphertext.slice(1)}` });
  await unlockOffline(page);
  await expect(panel.getByRole('alert')).toContainText('could not be unlocked');
  await vault(page, original);
  const expiry = Date.parse(JSON.parse(Buffer.from(state.bundle.payload, 'base64url').toString()).expiresAt);
  await page.evaluate(now => { Date.now = () => now; }, expiry + 1);
  await unlockOffline(page);
  await expect(panel.getByRole('alert')).toContainText('could not be unlocked');
  await expect(panel.getByText('Read-only snapshot from', { exact: false })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a modified signed manifest cannot be saved', async ({ page }) => {
  const { state, errors } = await setup(page, { offline: true });
  state.bundle.signature = `${state.bundle.signature[0] === 'A' ? 'B' : 'A'}${state.bundle.signature.slice(1)}`;
  await connect(page);
  await saveOffline(page);
  await expect(offlinePanel(page).getByRole('alert')).toContainText('could not be saved');
  expect(await vault(page)).toBeNull();
  expect(errors).toEqual([]);
});

test('a valid signature for another origin is rejected', async ({ page }) => {
  const { errors } = await setup(page, { offline: true, offlineOrigin: 'https://different.example.test' });
  await connect(page);
  await saveOffline(page);
  await expect(offlinePanel(page).getByRole('alert')).toContainText('could not be saved');
  expect(await vault(page)).toBeNull();
  expect(errors).toEqual([]);
});

test('live refresh and credential revocation remove cached instructions', async ({ page }) => {
  const { state, errors } = await setup(page, { offline: true });
  await connect(page);
  await saveOffline(page);
  const panel = offlinePanel(page);
  await expect(panel.getByRole('status')).toContainText('Encrypted snapshot saved');
  await unlockOffline(page);
  await expect(panel).toContainText('Read-only snapshot from');
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(panel.getByText('Read-only snapshot from', { exact: false })).toHaveCount(0);
  await connect(page);
  await expect.poll(() => vault(page)).toBeNull();
  await saveOffline(page);
  await expect(panel.getByRole('status')).toContainText('Encrypted snapshot saved');
  state.revoked = true;
  await page.getByRole('button', { name: 'Refresh inbox', exact: true }).click();
  await expect(page.getByLabel('App User access key or Collect server URL')).toBeVisible();
  await expect.poll(() => vault(page)).toBeNull();
  await expect(panel.getByRole('button', { name: 'Unlock saved snapshot' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a delayed offline snapshot cannot save after disconnect', async ({ page }) => {
  const { state, errors } = await setup(page, { offline: true });
  let release;
  state.offlineWait = new Promise(resolve => { release = resolve; });
  await connect(page);
  await saveOffline(page);
  await expect.poll(() => state.requests.some(request => request.url.endsWith('/offline-assignments'))).toBe(true);
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  release();
  await expect(offlinePanel(page).getByRole('button', { name: 'Save encrypted snapshot' })).toHaveCount(0);
  expect(await vault(page)).toBeNull();
  expect(errors).toEqual([]);
});

test('offline storage failure does not report a saved snapshot and can be retried', async ({ page }) => {
  const { errors } = await setup(page, { offline: true });
  await connect(page);
  await page.evaluate(() => {
    globalThis.originalSnapshotPut = globalThis.IDBObjectStore.prototype.put;
    globalThis.IDBObjectStore.prototype.put = () => { throw new globalThis.DOMException('Storage full', 'QuotaExceededError'); };
  });
  await saveOffline(page);
  const panel = offlinePanel(page);
  await expect(panel.getByRole('alert')).toContainText('could not be saved');
  expect(await vault(page)).toBeNull();
  await page.evaluate(() => { globalThis.IDBObjectStore.prototype.put = globalThis.originalSnapshotPut; });
  await saveOffline(page);
  await expect(panel.getByRole('status')).toContainText('Encrypted snapshot saved');
  expect(await vault(page)).not.toBeNull();
  expect(errors).toEqual([]);
});

test('unconfigured offline signing preserves the live inbox and saves nothing', async ({ page }) => {
  const { errors } = await setup(page);
  await connect(page);
  await saveOffline(page);
  await expect(offlinePanel(page).getByRole('status')).toContainText('not configured');
  await expect(page.getByRole('button', { name: 'Acknowledge request' })).toBeEnabled();
  expect(await vault(page)).toBeNull();
  expect(errors).toEqual([]);
});

test('inbox lists re-verification visits as plain text', async ({ page }) => {
  const { state, errors } = await setup(page, { visits: [visitFixture] });
  await connect(page);
  const visits = page.locator('.visits');
  await expect(page.getByRole('heading', { name: 'Re-verification visits' })).toBeVisible();
  await expect(visits).toContainText('Water point · WP-01');
  await expect(visits).toContainText('Check: condition');
  await expect(visits).toContainText('Check the pump handle.');
  await expect(visits.locator('img')).toHaveCount(0);
  await expect(visits).toContainText('Independent verification');
  await expect(page.getByRole('button', { name: /complete|submit|acknowledge visit/i })).toHaveCount(0);
  await expect(page.getByText('Planned visit: 2026-10-19 (UTC)')).toBeVisible();
  expect(state.requests.filter(request => request.url.endsWith('/reverification'))
    .every(request => request.authorization === `Bearer ${key}` && request.method === 'GET')).toBe(true);
  await page.getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.getByText('Water point')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a visit-list failure does not hide the backcheck inbox', async ({ page }) => {
  const { errors } = await setup(page, { failVisits: true });
  await connect(page);
  await expect(page.getByText('Verify the visit.')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Re-verification visits could not be loaded');
  expect(errors).toEqual([]);
});

test('an empty visit list says so', async ({ page }) => {
  const { errors } = await setup(page);
  await connect(page);
  await expect(page.getByText('No re-verification visits are assigned to you.')).toBeVisible();
  expect(errors).toEqual([]);
});

test('the collector sees the receipts the server recorded for their uploads', async ({ page }) => {
  const receipt = { seq: 12, xmlFormId: 'verification', formName: 'Independent verification', instanceId: 'uuid:visit-1',
    receivedAt: '2026-10-10T12:00:00.123456Z', contentHash: 'a'.repeat(64), entryHash: 'b'.repeat(64) };
  const { errors } = await setup(page, { receipts: [receipt] });
  await page.getByLabel('App User access key or Collect server URL').fill(key);
  await page.getByRole('button', { name: 'Open my inbox' }).click();
  const list = page.locator('.receipts li');
  await expect(list).toHaveCount(1);
  await expect(list).toContainText('Independent verification · uuid:visit-1');
  await expect(list).toContainText('Receipt 12 · Received 2026-10-10T12:00:00.123456Z');
  await expect(list).toContainText(`Content fingerprint: ${'a'.repeat(64)}`);
  await expect(page.getByText(`The ledger holds 12 receipts; latest ${'b'.repeat(64)}, signed by the server.`)).toBeVisible();
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= 360)).toBe(true);
  // Disconnecting clears them with everything else.
  await page.getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.locator('.receipts li')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a receipts failure does not hide the inbox', async ({ page }) => {
  const { errors } = await setup(page, { failReceipts: true });
  await page.getByLabel('App User access key or Collect server URL').fill(key);
  await page.getByRole('button', { name: 'Open my inbox' }).click();
  await expect(page.getByText('Receipts could not be loaded. Refresh to retry.')).toBeVisible();
  await expect(page.locator('.tasks li').first()).toContainText('Verify the visit.');
  expect(errors).toEqual([]);
});


test('approved itinerary stops are escaped, withheld work is visible and disconnect clears locations', async ({ page }) => {
  const { errors } = await setup(page, { itineraries: [{ id: taskId, date: '2026-10-14', note: 'Check access. <img src=x onerror=alert(1)>',
    start: { latitude: 8.48, longitude: -13.23 }, needsReview: true, withheld: 1,
    stops: [{ id: taskId, order: 2, question: 'Verify this visit.', xmlFormId: 'verify', formName: 'Independent verification', formVersion: '2', dueAt: '2026-10-15T10:00:00Z', location: { latitude: 8.49, longitude: -13.22, accuracy: 15 } }] }] });
  await connect(page);
  await expect(page.getByRole('heading', { name: '2026-10-14 · approved stop order' })).toBeVisible();
  await expect(page.getByText('1 stops are no longer available.', { exact: false })).toBeVisible();
  await expect(page.getByText('8.49, -13.22', { exact: false })).toBeVisible();
  await expect(page.getByText('Independent verification (verify)', { exact: false })).toBeVisible();
  await expect(page.getByText('Form version: 2', { exact: false })).toBeVisible();
  await expect(page.locator('.tasks img')).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= globalThis.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByRole('heading', { name: '2026-10-14 · approved stop order' })).toHaveCount(0);
  expect(errors).toEqual([]);
});


test('signed approved itineraries unlock offline without persisting plaintext coordinates', async ({ page, context }) => {
  const approved = { id: taskId, date: '2026-10-14', note: 'Approved access instructions.', needsReview: true, withheld: 1,
    method: 'nearest-next-stop, great-circle distance, return to start', start: { latitude: 8.48, longitude: -13.23 },
    stops: [{ id: pushId, order: 2, question: 'Visit approved water point.', xmlFormId: 'verify', formName: 'Independent verification', formVersion: '2', dueAt: '2026-10-15T10:00:00Z', location: { latitude: 8.491234, longitude: -13.221234, accuracy: 15 } }] };
  const { errors, state } = await setup(page, { offline: true, offlineItineraries: [approved] });
  await connect(page); await saveOffline(page); const panel = offlinePanel(page);
  await expect(panel.getByRole('status')).toContainText('Encrypted snapshot saved');
  const raw = JSON.stringify(await vault(page)); expect(raw).not.toContain('8.491234'); expect(raw).not.toContain('Visit approved water point');
  await page.reload(); await page.waitForLoadState('networkidle'); const reads = state.requests.length;
  await context.setOffline(true); await unlockOffline(page);
  await expect(panel.getByRole('heading', { name: 'Offline approved itineraries' })).toBeVisible();
  await expect(panel).toContainText('Independent verification (verify)'); await expect(panel).toContainText('Form version: 2 · as saved');
  await expect(panel).toContainText('8.491234, -13.221234'); await expect(panel).toContainText('1 stops were unavailable when saved');
  await expect(panel).toContainText('Cancellations, access changes and road conditions cannot be checked offline');
  expect(state.requests.length).toBe(reads);
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= globalThis.innerWidth)).toBe(true);
  await panel.getByRole('button', { name: 'Lock snapshot', exact: true }).click();
  await expect(panel.getByText('8.491234, -13.221234', { exact: false })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a valid signature cannot make malformed itinerary coordinates acceptable', async ({ page }) => {
  await setup(page, { offline: true, offlineItineraries: [{ id: taskId, date: '2026-10-14', note: 'Instructions', needsReview: false,
    withheld: 0, method: 'road suggestion', start: { latitude: 8.48, longitude: -13.23 },
    stops: [{ id: pushId, order: 1, question: 'Visit', location: { latitude: 99, longitude: -13.22 } }] }] });
  await connect(page); await saveOffline(page);
  await expect(offlinePanel(page).getByRole('alert')).toBeVisible(); expect(await vault(page)).toBeNull();
});


test('a signed itinerary with malformed collection metadata is rejected before storage', async ({ page }) => {
  await setup(page, { offline: true, offlineItineraries: [{ id: taskId, date: '2026-10-14', note: 'Instructions', needsReview: false,
    withheld: 0, method: 'road suggestion', start: { latitude: 8.48, longitude: -13.23 },
    stops: [{ id: pushId, order: 1, question: 'Visit', xmlFormId: 'verify', formVersion: {}, dueAt: 'not-a-date', location: { latitude: 8.49, longitude: -13.22 } }] }] });
  await connect(page); await saveOffline(page);
  await expect(offlinePanel(page).getByRole('alert')).toBeVisible(); expect(await vault(page)).toBeNull();
});

for (const [name, invalid] of [
  ['impossible visit date', { plannedVisitDate: '2026-02-30' }],
  ['unexpected source answer', { value: 'Earlier answer must never be stored' }]
]) {
  test(`signed offline visits reject ${name} before storage`, async ({ page }) => {
    await setup(page, { offline: true, offlineVisits: { items: [{ ...visitFixture, ...invalid }], complete: true, omitted: 0 } });
    await connect(page);
    await saveOffline(page);
    await expect(offlinePanel(page).getByRole('alert')).toBeVisible();
    expect(await vault(page)).toBeNull();
  });
}

test('media queue resumes confirmed chunks after a lost acknowledgement and honors priorities', async ({ page }) => {
  const { errors } = await setup(page); let lost = false; const uploads = new Map(); const starts = []; const chunks = [];
  await page.route('**/v1/field-data/app-user/media-uploads**', async route => {
    const request = route.request(); const url = new URL(request.url());
    expect(request.headers().authorization).toBe(`Bearer ${key}`);
    if (url.pathname.endsWith('/media-uploads')) {
      if (request.method() === 'GET') return route.fulfill({ json: { items: [...uploads.values()] } });
      const manifest = request.postDataJSON(); starts.push(manifest.name);
      const row = { ...manifest, offset: 0, status: 'pending', expiresAt: '2026-10-20T12:00:00Z', chunkSize: 262144 };
      uploads.set(row.id, row); return route.fulfill({ json: row });
    }
    const id = url.pathname.split('/media-uploads/')[1].split('/')[0]; const row = uploads.get(id);
    if (url.pathname.includes('/chunks/')) {
      const bytes = request.postDataBuffer();
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(request.headers()['x-chunk-sha256']);
      const offset = Number(url.pathname.split('/chunks/')[1]); expect(offset).toBe(row.offset);
      row.offset += bytes.length; chunks.push({ name: row.name, offset });
      if (row.name === 'photo.jpg' && !lost) { lost = true; return route.abort('failed'); }
      return route.fulfill({ json: row });
    }
    if (url.pathname.endsWith('/complete')) { row.status = 'completed'; return route.fulfill({ json: row }); }
    return route.fulfill({ json: row });
  });
  await connect(page); const panel = page.getByRole('region', { name: 'Recover media uploads' });
  await panel.getByLabel('Form ID', { exact: true }).fill('verification');
  await panel.getByLabel('Synced submission instance ID').fill('own-synced-instance');
  await panel.getByLabel('Media files (up to 20 MB each)').setInputFiles([
    { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(262157, 7) },
    { name: 'urgent.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('Urgent audio') }
  ]);
  await panel.getByLabel('Priority for urgent.mp3').selectOption('1');
  await panel.getByRole('button', { name: 'Upload or resume queue' }).click();
  await expect(panel.getByRole('alert')).toContainText('Transfer interrupted');
  expect(starts).toEqual(['urgent.mp3', 'photo.jpg']);
  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(storage).not.toContain('photo.jpg'); expect(storage).not.toContain('own-synced-instance');
  await page.reload(); await connect(page);
  await panel.getByLabel('Form ID', { exact: true }).fill('verification');
  await panel.getByLabel('Synced submission instance ID').fill('own-synced-instance');
  await panel.getByLabel('Media files (up to 20 MB each)').setInputFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(262157, 7) });
  await panel.getByRole('button', { name: 'Upload or resume queue' }).click();
  await expect(panel.getByRole('status')).toContainText('Queue finished');
  expect(chunks.filter(chunk => chunk.name === 'photo.jpg').map(chunk => chunk.offset)).toEqual([0, 262144]);
  expect(starts).toHaveLength(2);
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= 320)).toBe(true);
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'photo.jpg', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('media transfers pause at a chunk boundary and cancel only temporary data', async ({ page }) => {
  await setup(page); const rows = new Map(); let release; let arrived; let held = false; let cancelled = 0;
  const received = new Promise(resolve => { arrived = resolve; });
  const wait = new Promise(resolve => { release = resolve; });
  await page.route('**/v1/field-data/app-user/media-uploads**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (path.endsWith('/media-uploads')) {
      if (request.method() === 'GET') return route.fulfill({ json: { items: [...rows.values()] } });
      const row = { ...request.postDataJSON(), offset: 0, status: 'pending', chunkSize: 262144, expiresAt: new Date(Date.now() + 86400000).toISOString() };
      rows.set(row.id, row); return route.fulfill({ json: row });
    }
    const id = path.split('/media-uploads/')[1].split('/')[0]; const row = rows.get(id);
    if (request.method() === 'DELETE') { cancelled += 1; rows.delete(id); return route.fulfill({ json: { cancelled: true } }); }
    if (path.includes('/chunks/')) {
      row.offset += request.postDataBuffer().length;
      if (!held) { held = true; arrived(); await wait; }
      return route.fulfill({ json: row });
    }
    if (path.endsWith('/complete')) row.status = 'completed';
    return route.fulfill({ json: row });
  });
  await connect(page); const panel = page.getByRole('region', { name: 'Recover media uploads' });
  await panel.getByLabel('Form ID', { exact: true }).fill('verification');
  await panel.getByLabel('Synced submission instance ID').fill('own-submission');
  await panel.getByLabel('Media files (up to 20 MB each)').setInputFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(262157, 7) });
  await panel.getByRole('button', { name: 'Upload or resume queue' }).click();
  await received;
  await panel.getByRole('button', { name: 'Pause after current chunk' }).click(); release();
  await expect(panel.getByRole('status')).toContainText('Paused');
  expect([...rows.values()][0].offset).toBe(262144);
  expect([...rows.values()][0].status).toBe('pending');
  await panel.getByRole('button', { name: 'Refresh saved transfers' }).click();
  await expect(panel.getByRole('status')).toContainText('Saved transfers refreshed');
  await panel.locator('summary').click();
  await panel.getByRole('button', { name: 'Cancel saved transfer: photo.jpg' }).click();
  await expect(panel.getByRole('status')).toContainText('Submission attachments are unchanged');
  await expect(panel).toContainText('0 of 262157 bytes');
  expect(cancelled).toBe(1); expect(rows.size).toBe(0);
  await panel.getByRole('button', { name: 'Upload or resume queue' }).click();
  await expect(panel.getByRole('status')).toContainText('Queue finished');
  expect([...rows.values()][0].status).toBe('completed');
});

const mediaVaultPanel = page => page.getByRole('region', { name: 'Encrypted offline media' });
const mediaPhrase = 'media-fixture-long-passphrase';
const storedMediaRecord = page => page.evaluate(async () => new Promise((resolve, reject) => {
  const open = globalThis.indexedDB.open('field-data-media', 1);
  open.onupgradeneeded = () => open.result.createObjectStore('packages');
  open.onsuccess = () => {
    const db = open.result; const request = db.transaction('packages').objectStore('packages').get('current');
    request.onsuccess = () => { db.close(); resolve(request.result ?? null); }; request.onerror = () => reject(request.error);
  };
}));
const protectMedia = async page => {
  const panel = mediaVaultPanel(page);
  await panel.getByLabel('Offline media form ID', { exact: true }).fill('verification');
  await panel.getByLabel('Offline media submission instance ID').fill('own-media-source');
  await panel.getByLabel('Files to protect').setInputFiles({ name: 'private-photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('Private original media bytes') });
  await panel.getByLabel('Media package passphrase').fill(mediaPhrase);
  await panel.getByRole('button', { name: 'Encrypt and save files' }).click();
  await expect(panel.getByRole('status')).toContainText('Encrypted media saved');
};
const unlockMedia = async page => {
  const panel = mediaVaultPanel(page);
  await panel.getByLabel('Media package passphrase').fill(mediaPhrase);
  await panel.getByRole('button', { name: 'Unlock saved media' }).click();
  await expect(panel).toContainText('private-photo.jpg');
};

test('encrypted media survives reload, exports and imports without uploading or storing plaintext', async ({ page }) => {
  const { errors, state } = await setup(page);
  await protectMedia(page);
  const record = await storedMediaRecord(page);
  const serialized = JSON.stringify(record);
  for (const secret of ['private-photo.jpg', 'own-media-source', 'Private original media bytes', mediaPhrase, key]) expect(serialized).not.toContain(secret);
  expect(Object.keys(record).sort()).toEqual(['ciphertext', 'iv', 'salt', 'schemaVersion']);
  const panel = mediaVaultPanel(page);
  await panel.getByLabel('Media package passphrase').fill(mediaPhrase);
  const downloadReady = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Export encrypted package' }).click();
  const download = await downloadReady;
  expect(download.suggestedFilename()).toBe('field-data-media.fdmedia');
  const path = await download.path();
  await panel.getByRole('button', { name: 'Delete saved media' }).click();
  await expect(panel.getByRole('status')).toContainText('Saved media deleted');
  expect(await storedMediaRecord(page)).toBeNull();
  await panel.getByLabel('Media package passphrase').fill(mediaPhrase);
  await panel.getByLabel('Import encrypted media package').setInputFiles(path);
  await expect(panel.getByRole('status')).toContainText('Encrypted package imported');
  expect(await storedMediaRecord(page)).toEqual(record);
  await expect(panel.getByRole('button', { name: 'Add unlocked files to upload queue' })).toBeDisabled();
  await page.reload();
  await expect(panel).not.toContainText('private-photo.jpg');
  await unlockMedia(page);
  expect(state.requests.filter(request => request.url.includes('/media-uploads'))).toHaveLength(0);
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= 320)).toBe(true);
  await panel.getByRole('button', { name: 'Lock and clear open files' }).click();
  await expect(panel).not.toContainText('private-photo.jpg');
  await expect(panel.getByLabel('Media package passphrase')).toHaveValue('');
  expect(errors).toEqual([]);
});

test('media package rejects wrong passwords and tampering without replacing the saved copy', async ({ page }) => {
  await setup(page); await protectMedia(page);
  const panel = mediaVaultPanel(page); const original = await storedMediaRecord(page);
  await panel.getByLabel('Media package passphrase').fill('incorrect-long-passphrase');
  await panel.getByRole('button', { name: 'Unlock saved media' }).click();
  await expect(panel.getByRole('alert')).toContainText('Unable to open or save media');
  await expect(panel).not.toContainText('private-photo.jpg');
  const tampered = { ...original, ciphertext: `${original.ciphertext[0] === 'A' ? 'B' : 'A'}${original.ciphertext.slice(1)}` };
  await panel.getByLabel('Media package passphrase').fill(mediaPhrase);
  await panel.getByLabel('Import encrypted media package').setInputFiles({ name: 'tampered.fdmedia', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(tampered)) });
  await expect(panel.getByRole('alert')).toContainText('Unable to open or save media');
  expect(await storedMediaRecord(page)).toEqual(original);
  await unlockMedia(page);
  await connect(page);
  // Connecting a new identity locks all plaintext; the user must unlock again.
  await expect(panel).not.toContainText('private-photo.jpg');
  await unlockMedia(page);
  await panel.getByRole('button', { name: 'Add unlocked files to upload queue' }).click();
  const uploads = page.getByRole('region', { name: 'Recover media uploads' });
  await expect(uploads.getByRole('heading', { name: 'private-photo.jpg' })).toBeVisible();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(panel).not.toContainText('private-photo.jpg');
  await expect(uploads).toHaveCount(0);
  expect(await storedMediaRecord(page)).toEqual(original);
});

test('restored encrypted media uploads original bytes only after explicit action and clears on revoked access', async ({ page }) => {
  await setup(page); await protectMedia(page); await connect(page); await unlockMedia(page);
  let manifest; let bytes; let writes = 0; let revoked = false;
  await page.route('**/v1/field-data/app-user/media-uploads**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    expect(request.headers().authorization).toBe(`Bearer ${key}`);
    if (revoked) return route.fulfill({ status: 403, json: {} });
    if (request.method() !== 'GET') writes += 1;
    if (path.endsWith('/media-uploads')) {
      if (request.method() === 'GET') return route.fulfill({ json: { items: [] } });
      manifest = { ...request.postDataJSON(), offset: 0, status: 'pending', chunkSize: 262144 };
      return route.fulfill({ json: manifest });
    }
    if (path.includes('/chunks/')) {
      bytes = request.postDataBuffer();
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.sha256);
      manifest.offset = bytes.length;
    }
    if (path.endsWith('/complete')) manifest.status = 'completed';
    return route.fulfill({ json: manifest });
  });
  const vaultPanel = mediaVaultPanel(page); const uploads = page.getByRole('region', { name: 'Recover media uploads' });
  await vaultPanel.getByRole('button', { name: 'Add unlocked files to upload queue' }).click();
  await expect(uploads).toContainText('Unlocked files added'); expect(writes).toBe(0);
  await vaultPanel.getByRole('button', { name: 'Add unlocked files to upload queue' }).click();
  await expect(uploads.getByRole('alert')).toContainText('already queued');
  await uploads.getByRole('button', { name: 'Upload or resume queue' }).click();
  await expect(uploads.getByRole('status')).toContainText('Queue finished');
  expect(bytes.toString()).toBe('Private original media bytes');
  expect(manifest.instanceId).toBe('own-media-source'); expect(writes).toBe(3);
  // Import does not confer authority; a fresh server denial revokes live access.
  await page.reload(); await connect(page); await unlockMedia(page);
  await vaultPanel.getByRole('button', { name: 'Add unlocked files to upload queue' }).click(); revoked = true;
  await uploads.getByRole('button', { name: 'Upload or resume queue' }).click();
  await expect(uploads).toHaveCount(0); await expect(vaultPanel).not.toContainText('private-photo.jpg');
  expect(writes).toBe(3); expect(await storedMediaRecord(page)).not.toBeNull();
});

test('locking during encryption prevents a delayed save from restoring private files', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const encrypt = globalThis.crypto.subtle.encrypt.bind(globalThis.crypto.subtle);
    globalThis.crypto.subtle.encrypt = async (...args) => { const result = await encrypt(...args); globalThis.mediaEncrypted = true; return result; };
    const original = globalThis.crypto.subtle.deriveKey.bind(globalThis.crypto.subtle);
    globalThis.crypto.subtle.deriveKey = async (...args) => {
      globalThis.mediaDeriving = true;
      await new Promise(resolve => { globalThis.releaseMediaDerive = resolve; });
      return original(...args);
    };
  });
  const panel = mediaVaultPanel(page);
  await panel.getByLabel('Offline media form ID', { exact: true }).fill('verification');
  await panel.getByLabel('Offline media submission instance ID').fill('own-media-source');
  await panel.getByLabel('Files to protect').setInputFiles({ name: 'private-photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('Private original media bytes') });
  await panel.getByLabel('Media package passphrase').fill(mediaPhrase);
  await panel.getByRole('button', { name: 'Encrypt and save files' }).click();
  await expect.poll(() => page.evaluate(() => globalThis.mediaDeriving)).toBe(true);
  await panel.getByRole('button', { name: 'Lock and clear open files' }).click();
  await page.evaluate(() => globalThis.releaseMediaDerive());
  await expect(panel.getByRole('status')).toContainText('Media locked');
  await expect.poll(() => page.evaluate(() => globalThis.mediaEncrypted)).toBe(true);
  await expect.poll(() => storedMediaRecord(page)).toBeNull();
  await expect(panel).not.toContainText('private-photo.jpg');
});

test('a failed encrypted media save preserves the previous package and can be retried', async ({ page }) => {
  await setup(page); await protectMedia(page);
  const original = await storedMediaRecord(page); const panel = mediaVaultPanel(page);
  await panel.getByLabel('Files to protect').setInputFiles({ name: 'replacement.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('Replacement media') });
  await page.evaluate(() => {
    globalThis.originalMediaPut = globalThis.IDBObjectStore.prototype.put;
    globalThis.IDBObjectStore.prototype.put = function failPut() { throw new Error('Storage quota exceeded'); };
  });
  await panel.getByLabel('Media package passphrase').fill(mediaPhrase);
  await panel.getByRole('button', { name: 'Encrypt and save files' }).click();
  await expect(panel.getByRole('alert')).toContainText('previous saved package is unchanged');
  expect(await storedMediaRecord(page)).toEqual(original);
  await page.evaluate(() => { globalThis.IDBObjectStore.prototype.put = globalThis.originalMediaPut; });
  await panel.getByLabel('Media package passphrase').fill(mediaPhrase);
  await panel.getByRole('button', { name: 'Encrypt and save files' }).click();
  await expect(panel.getByRole('status')).toContainText('Encrypted media saved');
  expect(await storedMediaRecord(page)).not.toEqual(original);
});
