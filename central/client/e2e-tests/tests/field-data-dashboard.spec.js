import { expect, test } from '@playwright/test';

const appUrl = process.env.ODK_URL || 'http://127.0.0.1:8989';
const emptyStats = {
  kpi: { projects: 0, forms: 0, submissions: 0, users: 0 },
  recentSubmissions: [], projects: [], submissionsTrend: [], topForms: [],
  systemStatus: null
};

const mockApi = async (page, respondStats) => {
  await page.addInitScript(() => {
    localStorage.setItem('sessionExpires', String(Date.now() + 3600000));
  });
  await page.route('**/client-config.json', route => route.fulfill({ json: {} }));
  await page.route('**/version.txt', route => route.fulfill({ body: 'test' }));
  await page.route('**/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/v1/field-data/stats') return respondStats(route);
    const json = path === '/v1/sessions/restore'
      ? { expiresAt: '2099-01-01T00:00:00Z', csrf: 'test' }
      : path === '/v1/users/current' ? {
        id: 1, displayName: 'Test Administrator', email: 'admin@example.test',
        verbs: ['user.list', 'project.create', 'audit.read', 'config.set', 'backup.run'],
        preferences: { site: {}, projects: {} }
      } : [];
    return route.fulfill({ json });
  });
};

test('empty dashboard renders zeros and empty states without administrator probes', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await mockApi(page, route => route.fulfill({ json: emptyStats }));
  await page.goto(`${appUrl}/field-data`);
  await expect(page.locator('.kpi-value')).toHaveText(['0', '0', '0', '0']);
  await expect(page.getByText('No projects are available yet. Create a project to get started.')).toBeVisible();
  await expect(page.locator('.status-bar')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('dashboard renders the actual stats API contract with populated results', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await mockApi(page, route => route.fulfill({ json: {
    ...emptyStats,
    kpi: { projects: 1, forms: 2, submissions: 12, users: 3 },
    projects: [{ id: 7, name: 'Health survey' }],
    recentSubmissions: [{ id: 9, form: 'health', formName: 'Health form', submitter: 'Field team', createdAt: '2026-10-03T10:00:00Z' }],
    submissionsTrend: [{ day: '2026-10-03', count: 12 }],
    topForms: [{ form: 'health', name: 'Health form', count: 12 }],
    systemStatus: { database: true, fileStorage: true, enketo: false, pyxform: true, emailService: false }
  } }));
  await page.goto(`${appUrl}/field-data`);
  await expect(page.locator('.kpi-value')).toHaveText(['12', '1', '2', '3']);
  await expect(page.getByRole('link', { name: 'Health survey' })).toHaveAttribute('href', '/projects/7');
  await expect(page.locator('.fd-table tbody')).toContainText('Field team');
  await expect(page.locator('.legend-value')).toHaveText('12');
  await expect(page.locator('.status-bar .status-state')).toHaveText(['Operational', 'Operational', 'Down', 'Operational', 'Down']);
  expect(errors).toEqual([]);
});

test('dashboard offers retry after a failed stats request', async ({ page }) => {
  let attempts = 0;
  await mockApi(page, route => ++attempts === 1
    ? route.fulfill({ status: 503, json: { message: 'Unavailable' } })
    : route.fulfill({ json: emptyStats }));
  await page.goto(`${appUrl}/field-data`);
  await expect(page.getByText('The dashboard could not be loaded. Please try again.')).toBeVisible();
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('.kpi-value')).toHaveText(['0', '0', '0', '0']);
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
});

test('integrations belong to System and dashboard is not active on another page', async ({ page }) => {
  await mockApi(page, route => route.fulfill({ json: emptyStats }));
  await page.goto(`${appUrl}/field-data/dhis2`);
  const navigation = page.locator('#fd-sidebar nav');
  await expect(navigation.getByText('System', { exact: true })).toBeVisible();
  await expect(navigation.getByText('Integrations', { exact: true })).toHaveCount(0);
  await expect(navigation.getByRole('link', { name: 'Dashboard', exact: true })).not.toHaveClass(/(?:^|\s)active(?:\s|$)/);
  await expect(navigation.getByRole('link', { name: 'DHIS2 Mapping' })).toHaveClass(/(?:^|\s)active(?:\s|$)/);
  const systemLinks = await navigation.locator('p').filter({ hasText: /^System$/ }).evaluate(heading => {
    const links = [];
    for (let el = heading.nextElementSibling; el?.tagName === 'A'; el = el.nextElementSibling)
      links.push(el.textContent.trim());
    return links;
  });
  expect(systemLinks).toEqual(['DHIS2 Mapping', 'Webhooks', 'Audit Logs', 'Backups', 'Settings']);
});
