import { test, expect } from '@playwright/test';

const origin = process.env.ODK_URL || 'http://127.0.0.1:8989';
const item = (id, expectedFiles, recordedFiles, missingFiles = []) => ({ submissionDefId: id, formName: 'Pilot form', instanceId: `instance-${id}`, formState: 'closed', receivedAt: '2026-11-03T13:00:00Z', expectedFiles, recordedFiles, missingFiles });
const setup = async page => {
  const state = { actorId: 42, fail: false, wrongOwner: false, requests: [], release: null, hold: false };
  await page.route('**/client-config.json', route => route.fulfill({ json: {} }));
  await page.route('**/version.txt', route => route.fulfill({ body: 'collect-delivery-fixture' }));
  await page.route('**/v1/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/backchecks')) return route.fulfill({ json: { appUser: { actorId: state.actorId, projectId: 7, name: 'Collector', projectName: 'Pilot' }, items: [], nextCursor: null } });
    if (url.pathname.endsWith('/receipts')) return route.fulfill({ json: { receipts: [], head: null } });
    if (url.pathname.endsWith('/push')) return route.fulfill({ json: { enabled: false, subscriptions: [] } });
    if (url.pathname.endsWith('/collect-delivery')) {
      state.requests.push(url.search);
      const actorId = state.wrongOwner ? 99 : state.actorId;
      if (state.hold) await new Promise(resolve => { state.release = resolve; });
      if (state.fail) return route.fulfill({ status: 500, json: {} });
      return route.fulfill({ json: { actorId, projectId: 7, items: url.search ? [item(18, 0, 0)] : [item(20, 12, 0, Array.from({ length: 10 }, (_, i) => `file-${i}.jpg`)), item(19, 2, 2)], nextCursor: url.search ? null : '19', checkedAt: '2026-11-03T13:01:00Z' } });
    }
    return route.fulfill({ json: { items: [], complete: true } });
  });
  await page.goto(`${origin}/fieldwork`);
  const connect = async () => { await page.getByLabel('App User access key or Collect server URL').fill('delivery-key'); await page.getByRole('button', { name: 'Open my inbox', exact: true }).click(); await expect(page.locator('#collect-delivery')).toBeVisible(); };
  await connect();
  return { state, connect, panel: page.locator('#collect-delivery') };
};
test('delivery inventory is explicit, paginated and distinguishes records from byte verification', async ({ page }) => {
  const { state, panel } = await setup(page);
  expect(state.requests).toEqual([]);
  await panel.getByRole('button', { name: 'Refresh Collect delivery receipts' }).click();
  await expect(panel).toContainText('12 of 12 attachment records missing');
  await expect(panel).toContainText('first 10 shown');
  await expect(panel).toContainText('all expected attachment records received (2/2)');
  await expect(panel).toContainText('File bytes have not been verified');
  await panel.getByRole('button', { name: 'Load more Collect delivery receipts' }).click();
  await expect(panel.locator('li')).toHaveCount(3);
  await expect(panel).toContainText('no files expected');
  expect(state.requests).toEqual(['', '?cursor=19']);
  await expect(panel.getByRole('button', { name: 'Load more Collect delivery receipts' })).toHaveCount(0);
});
test('failed pagination retains prior receipts and can be retried', async ({ page }) => {
  const { state, panel } = await setup(page);
  await panel.getByRole('button', { name: 'Refresh Collect delivery receipts' }).click();
  await expect(panel.locator('li')).toHaveCount(2);
  state.fail = true;
  await panel.getByRole('button', { name: 'Load more Collect delivery receipts' }).click();
  await expect(panel.getByRole('alert')).toBeVisible();
  await expect(panel.locator('li')).toHaveCount(2);
  state.fail = false;
  await panel.getByRole('button', { name: 'Load more Collect delivery receipts' }).click();
  await expect(panel.locator('li')).toHaveCount(3);
});
test('a mismatched collector response is refused', async ({ page }) => {
  const { state, panel } = await setup(page);
  state.wrongOwner = true;
  await panel.getByRole('button', { name: 'Refresh Collect delivery receipts' }).click();
  await expect(panel.getByRole('alert')).toBeVisible();
  await expect(panel.locator('li')).toHaveCount(0);
});
test('a late old session response cannot populate the reconnected collector view', async ({ page }) => {
  const { state, panel, connect } = await setup(page);
  state.hold = true;
  await panel.getByRole('button', { name: 'Refresh Collect delivery receipts' }).click();
  await expect.poll(() => state.release != null).toBe(true);
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  state.actorId = 43;
  await connect();
  state.release();
  await expect(panel.locator('li')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Refresh Collect delivery receipts' })).toBeEnabled();
});
