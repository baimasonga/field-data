import { expect, test } from '@playwright/test';
import { createHash, createPublicKey, generateKeyPairSync } from 'node:crypto';
import offlineAssignments from '../../../server/lib/util/offline-assignments.js';
const appUrl = process.env.ODK_URL || 'http://127.0.0.1:8989';
const taskId = '11111111-1111-4111-8111-111111111111';
const pushId = '22222222-2222-4222-8222-222222222222';
const key = 'fixture-app-user-key';
const setup = async (page, { push = false, denied = false, fail = false, delayed = false, failDelete = false, offline = false, offlineOrigin = null } = {}) => {
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
      formName: 'Independent verification', dueAt: null, status: 'requested', actionable: true, seenAt: null }]);
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
          dueAt: null, status: 'requested', actionable: true, seenAt: state.seen ? '2026-10-09T04:00:00Z' : null }
      ] } });
    }
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
  const { state, errors } = await setup(page, { offline: true });
  await connect(page);
  await saveOffline(page);
  const panel = offlinePanel(page);
  await expect(panel.getByRole('status')).toContainText('Encrypted snapshot saved');
  const raw = JSON.stringify(await vault(page));
  expect(raw).not.toContain(key);
  expect(raw).not.toContain(passphrase);
  expect(raw).not.toContain('Verify the visit');
  await page.reload();
  await expect(panel.getByLabel('Saved snapshot passphrase')).toBeVisible();
  const reads = state.requests.length;
  await context.setOffline(true);
  await unlockOffline(page, 'incorrect-passphrase');
  await expect(panel.getByRole('alert')).toContainText('could not be unlocked');
  await unlockOffline(page);
  await expect(panel).toContainText('Read-only snapshot from');
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
