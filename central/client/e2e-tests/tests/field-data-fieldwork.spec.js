import { expect, test } from '@playwright/test';
const appUrl = process.env.ODK_URL || 'http://127.0.0.1:8989';
const taskId = '11111111-1111-4111-8111-111111111111';
const pushId = '22222222-2222-4222-8222-222222222222';
const key = 'fixture-app-user-key';
const setup = async (page, { push = false, denied = false, fail = false, delayed = false } = {}) => {
  const state = { inboxReads: 0, seen: false, registered: false, deleted: false, failures: fail ? 1 : 0, requests: [] };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let release;
  const wait = delayed ? new Promise(resolve => { release = resolve; }) : null;
  await page.addInitScript(({ denied }) => {
    window.PushManager = function PushManager() {};
    Object.defineProperty(window, 'Notification', { value: { requestPermission: async () => denied ? 'denied' : 'granted' } });
    const subscription = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/browser-fixture',
      toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/browser-fixture', keys: { p256dh: 'fixture', auth: 'fixture' } }),
      unsubscribe: async () => true
    };
    const registration = { active: true, pushManager: { getSubscription: async () => null, subscribe: async () => subscription } };
    Object.defineProperty(navigator, 'serviceWorker', { value: { getRegistration: async () => registration, register: async () => registration,
      addEventListener: (name, handler) => { window.fieldworkMessage = handler; }, removeEventListener: () => {} } });
  }, { denied });
  await page.route('**/client-config.json', route => route.fulfill({ json: {} }));
  await page.route('**/version.txt', route => route.fulfill({ body: 'test' }));
  await page.route('**/v1/**', async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (!path.startsWith('/v1/field-data/app-user/')) return route.fulfill({ json: {} });
    state.requests.push({ url: req.url(), authorization: req.headers().authorization, method: req.method() });
    if (req.headers().authorization !== `Bearer ${key}`) return route.fulfill({ status: 403, json: {} });
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
    if (req.method() === 'DELETE') { state.deleted = true; return route.fulfill({ json: { success: true } }); }
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
  expect(await page.evaluate(value => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }).includes(value), key)).toBe(false);
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
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
  await page.evaluate(() => window.fieldworkMessage({ origin: window.location.origin, data: { type: 'fieldwork-inbox-update' } }));
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
