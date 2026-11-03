/* global document, localStorage */
import { test, expect } from '@playwright/test';
import { inflateSync } from 'node:zlib';
import jsQR from 'jsqr';

const origin = process.env.ODK_URL || 'http://127.0.0.1:8989';
const key = 'private-collect-auto-send-key';
const setup = async page => {
  await page.route('**/client-config.json', route => route.fulfill({ json: {} }));
  await page.route('**/version.txt', route => route.fulfill({ body: 'auto-send-fixture' }));
  await page.route('**/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/backchecks')) return route.fulfill({ json: { appUser: { actorId: 42, projectId: 7, name: 'Collector', projectName: 'Pilot' }, items: [], nextCursor: null } });
    if (path.endsWith('/receipts')) return route.fulfill({ json: { receipts: [], head: null } });
    if (path.endsWith('/push')) return route.fulfill({ json: { enabled: false, subscriptions: [] } });
    return route.fulfill({ json: { items: [], complete: true } });
  });
  await page.goto(`${origin}/fieldwork`);
  await page.getByLabel('App User access key or Collect server URL').fill(key);
  await page.getByRole('button', { name: 'Open my inbox', exact: true }).click();
  const panel = page.locator('#collect-auto-send');
  await expect(panel).toBeVisible();
  return panel;
};
const decode = async panel => {
  const pixels = await panel.locator('canvas').evaluate(canvas => ({ width: canvas.width, height: canvas.height, data: Array.from(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data) }));
  const code = jsQR(Uint8ClampedArray.from(pixels.data), pixels.width, pixels.height);
  return JSON.parse(inflateSync(Buffer.from(code.data, 'base64')).toString());
};
test('stock Collect settings encode each explicit network policy and retain sent forms', async ({ page }) => {
  const panel = await setup(page);
  await expect(panel.getByRole('button', { name: 'Show private Collect QR' })).toBeDisabled();
  for (const policy of ['off', 'wifi_only', 'cellular_only', 'wifi_and_cellular']) {
    await panel.getByLabel('Collect upload network').selectOption(policy);
    await panel.getByRole('checkbox').check();
    await panel.getByRole('button', { name: 'Show private Collect QR' }).click();
    await expect(panel.locator('img')).toBeVisible();
    expect(await decode(panel)).toEqual({ general: { server_url: `${origin}/v1/key/${key}/projects/7`, autosend: policy, delete_send: false }, project: { name: 'Pilot' }, admin: {} });
    await panel.getByRole('button', { name: 'Hide private QR' }).click();
    await expect(panel.locator('canvas')).toHaveCount(0);
  }
});
test('policy changes and timeout remove credential pixels and require fresh consent', async ({ page }) => {
  const panel = await setup(page);
  await page.clock.install();
  await panel.getByRole('checkbox').check();
  await panel.getByRole('button', { name: 'Show private Collect QR' }).click();
  await panel.getByLabel('Collect upload network').selectOption('wifi_only');
  await expect(panel.locator('img')).toHaveCount(0);
  await expect(panel.getByRole('checkbox')).not.toBeChecked();
  await panel.getByRole('checkbox').check();
  await panel.getByRole('button', { name: 'Show private Collect QR' }).click();
  await page.clock.fastForward(120001);
  await expect(panel.locator('img')).toHaveCount(0);
  await expect(panel.getByRole('checkbox')).not.toBeChecked();
});
test('private code fits mobile and disappears when the page is hidden', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  const panel = await setup(page);
  await panel.getByRole('checkbox').check();
  await panel.getByRole('button', { name: 'Show private Collect QR' }).click();
  const image = await panel.locator('img').boundingBox();
  expect(image.x).toBeGreaterThanOrEqual(0);
  expect(image.x + image.width).toBeLessThanOrEqual(320);
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(panel.locator('canvas')).toHaveCount(0);
  expect(await page.evaluate(secret => Object.values(localStorage).some(value => value.includes(secret)), key)).toBe(false);
});
test('disconnect destroys the private QR and reconnect starts with manual send and no consent', async ({ page }) => {
  const panel = await setup(page);
  await panel.getByLabel('Collect upload network').selectOption('wifi_and_cellular');
  await panel.getByRole('checkbox').check();
  await panel.getByRole('button', { name: 'Show private Collect QR' }).click();
  await expect(panel.locator('img')).toBeVisible();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await page.getByLabel('App User access key or Collect server URL').fill(key);
  await page.getByRole('button', { name: 'Open my inbox', exact: true }).click();
  await expect(panel.getByLabel('Collect upload network')).toHaveValue('off');
  await expect(panel.getByRole('button', { name: 'Show private Collect QR' })).toBeDisabled();
  await expect(panel.locator('canvas')).toHaveCount(0);
});
