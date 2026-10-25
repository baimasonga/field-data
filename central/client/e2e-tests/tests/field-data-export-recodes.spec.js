/* global localStorage, window, document */
// S4 recode rules for exports in the browser: docs/field-intelligence/S4-export-recodes.md
import { expect, test } from '@playwright/test';

const appUrl = process.env.ODK_URL || 'http://127.0.0.1:8989';
const managerVerbs = ['project.read', 'project.update', 'form.read', 'form.list', 'form.update', 'form.delete', 'form.create', 'dataset.list', 'entity.list', 'submission.list', 'submission.read', 'submission.update'];
const viewerVerbs = ['project.read', 'form.read', 'form.list', 'submission.list', 'submission.read', 'dataset.list', 'entity.list'];

const form = {
  projectId: 1, xmlFormId: 'census', name: 'Census', state: 'open', publishedAt: '2026-10-02T00:00:00Z',
  createdAt: '2026-10-01T00:00:00Z', updatedAt: null, submissions: 2, reviewStates: { received: 2, hasIssues: 0, edited: 0 },
  lastSubmission: null, version: '2', hash: 'a'.repeat(32), sha: 's', sha256: 's', keyId: null, enketoId: 'e1', enketoOnceId: null,
  webformsEnabled: true, entityRelated: false, publicLinks: 0, excelContentType: null, draftToken: null,
  createdBy: { id: 1, displayName: 'Fixture' }, lastSubmissionDate: null, publishNotes: null
};
const version = (v, publishedAt) => ({ ...form, version: v, publishedAt, publishedBy: { id: 1, displayName: 'Fixture' }, excelContentType: null });
const fields = [
  { path: '/water', name: 'water', type: 'string', binary: null, selectMultiple: null },
  { path: '/lights', name: 'lights', type: 'string', binary: null, selectMultiple: true },
  { path: '/age', name: 'age', type: 'int', binary: null, selectMultiple: null },
  { path: '/kids', name: 'kids', type: 'repeat', binary: null, selectMultiple: null },
  { path: '/kids/kid_water', name: 'kid_water', type: 'string', binary: null, selectMultiple: null },
  { path: '/meta', name: 'meta', type: 'structure', binary: null, selectMultiple: null },
  { path: '/meta/instanceID', name: 'instanceID', type: 'string', binary: null, selectMultiple: null }
];
const rule = (id, extra) => ({ id, reason: 'Renamed in version 2', actorName: 'Alice', createdAt: '2026-10-02T09:00:00Z', retiredAt: null, retiredByName: null, retireReason: null, fromPath: null, values: null, ...extra });

const api = async (page, { verbs = managerVerbs } = {}) => {
  const errors = []; const posts = [];
  let state = {
    active: [rule('r1', { kind: 'value', path: '/water', versions: ['1'], values: { borehole: 'bh' } })],
    retired: [],
    versions: [{ version: '2', current: true, publishedAt: '2026-10-02T00:00:00Z' }, { version: '1', current: false, publishedAt: '2026-10-01T00:00:00Z' }]
  };
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => { if (window === window.top) localStorage.setItem('sessionExpires', String(Date.now() + 3600000)); });
  await page.route('**/client-config.json', (r) => r.fulfill({ json: {} }));
  await page.route('**/version.txt', (r) => r.fulfill({ body: 'fixture' }));
  await page.route('**/v1/**', async (route) => {
    const request = route.request();
    const { pathname, search } = new URL(request.url());
    const base = '/v1/projects/1/forms/census';
    if (pathname === `${base}/recodes` && request.method() === 'POST') {
      const body = request.postDataJSON(); posts.push(body);
      const created = rule('r2', { ...body, reason: body.reason });
      state = { ...state, active: [created, ...state.active] };
      await route.fulfill({ status: 201, json: created }); return;
    }
    const retire = /\/recodes\/([^/]+)\/retire$/.exec(pathname);
    if (retire && request.method() === 'POST') {
      const body = request.postDataJSON(); posts.push({ retire: retire[1], ...body });
      const found = state.active.find((r) => r.id === retire[1]);
      const done = { ...found, retiredAt: '2026-10-03T00:00:00Z', retiredByName: 'Alice', retireReason: body.reason };
      state = { ...state, active: state.active.filter((r) => r.id !== found.id), retired: [done, ...state.retired] };
      await route.fulfill({ json: done }); return;
    }
    const project = { id: 1, name: 'Synthetic', forms: 1, datasets: 0, archived: false, verbs };
    const json = pathname === '/v1/sessions/restore' ? { expiresAt: '2099-01-01T00:00:00Z', csrf: 'fixture' }
      : pathname === '/v1/users/current' ? { id: 1, displayName: 'Fixture', verbs: [], preferences: { site: {}, projects: {} } }
        : pathname === '/v1/projects' ? [project]
          : pathname === '/v1/projects/1' ? project
            : pathname === base ? form
              : pathname === `${base}/versions` ? [version('2', '2026-10-02T00:00:00Z'), version('1', '2026-10-01T00:00:00Z')]
                : pathname === `${base}/recodes` ? state
                  : pathname === `${base}/fields` && search === '?odata=false' ? fields
                    : pathname === `${base}/draft` ? null
                      : [];
    if (json == null) { await route.fulfill({ status: 404, json: { code: 404.1, message: 'Not found' } }); return; }
    await route.fulfill({ json });
  });
  return { errors, posts };
};
const versionsPage = `${appUrl}/projects/1/forms/census/versions`;

test('lists rules, adds a value rule and a moved-question rule, and retires one', async ({ page }) => {
  const { errors, posts } = await api(page);
  await page.goto(versionsPage);
  const section = page.locator('#form-version-recodes');
  await expect(section).toContainText("standard CSV and OData downloads retain stored answers");
  const first = section.locator('.recodes-rule').first();
  await expect(first).toContainText('/water');
  await expect(first).toContainText('Codes · version 1');
  await expect(first).toContainText('borehole → bh');
  await expect(first).toContainText('Renamed in version 2 · Alice · 2026-10-02');

  // The question list leaves out groups, repeats and metadata.
  const add = section.locator('.recodes-add');
  await add.locator('summary').click();
  const options = await add.getByLabel('Question in the current version').locator('option').allTextContents();
  expect(options).toEqual(['Choose a question', '/water', '/lights', '/age', '/kids/kid_water']);
  await add.getByLabel('Question in the current version').selectOption('/lights');
  await add.getByLabel('1', { exact: true }).check();
  await add.getByLabel('Old value = new value, one per line').fill('torch = battery_torch\nlamp=kerosene');
  await add.getByLabel('Reason').fill('Renamed in version 2');
  await add.getByRole('button', { name: 'Add rule' }).click();
  await expect(section.locator('.recodes-rule')).toHaveCount(2);
  expect(posts[0]).toEqual({ kind: 'value', path: '/lights', versions: ['1'], values: { torch: 'battery_torch', lamp: 'kerosene' }, reason: 'Renamed in version 2' });

  // The form stays open for the next rule. A moved question: questions inside
  // repeats are not offered.
  await add.getByLabel('Question moved: read earlier answers from its old place').check();
  const moved = await add.getByLabel('Question in the current version').locator('option').allTextContents();
  expect(moved).not.toContain('/kids/kid_water');
  await add.getByLabel('Question in the current version').selectOption('/age');
  await add.getByLabel('1', { exact: true }).check();
  await add.getByLabel('Its path in those versions').fill(' /old_age ');
  await add.getByLabel('Reason').fill('Moved');
  await add.getByRole('button', { name: 'Add rule' }).click();
  expect(posts[1]).toEqual({ kind: 'path', path: '/age', versions: ['1'], fromPath: '/old_age', reason: 'Moved' });

  // A badly written line is explained, not sent.
  await add.getByLabel('Codes changed: map old values to new ones').check();
  await add.getByLabel('Question in the current version').selectOption('/water');
  await add.getByLabel('1', { exact: true }).check();
  await add.getByLabel('Old value = new value, one per line').fill('tap');
  await add.getByLabel('Reason').fill('x');
  await add.getByRole('button', { name: 'Add rule' }).click();
  await expect(section.getByRole('alert')).toContainText('Write each line as old = new: "tap"');
  expect(posts).toHaveLength(2);

  const water = section.locator('.recodes-rule', { hasText: 'borehole → bh' });
  await water.getByLabel('Reason to retire').fill('Wrong code');
  await water.getByRole('button', { name: 'Retire' }).click();
  await expect(section.locator('.recodes-retired summary')).toHaveText('Retired rules (1)');
  expect(posts[2]).toEqual({ retire: 'r1', reason: 'Wrong code' });

  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= 360)).toBe(true);
  expect(errors).toEqual([]);
});

test('people who cannot change the form see rules but cannot add or retire them', async ({ page }) => {
  const { errors } = await api(page, { verbs: viewerVerbs });
  await page.goto(versionsPage);
  const section = page.locator('#form-version-recodes');
  await expect(section.locator('.recodes-rule')).toHaveCount(1);
  await expect(section.locator('.recodes-add')).toHaveCount(0);
  await expect(section.getByRole('button', { name: 'Retire' })).toHaveCount(0);
  expect(errors).toEqual([]);
});
