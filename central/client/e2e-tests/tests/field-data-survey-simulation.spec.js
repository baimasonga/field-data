/* global localStorage */
// S2 interview simulation in the browser: docs/field-intelligence/S2-survey-simulation.md
import { expect, test } from '@playwright/test';

const appUrl = process.env.ODK_URL || 'http://127.0.0.1:8989';
const verbs = ['project.read', 'project.update', 'form.read', 'form.list', 'form.update', 'form.delete', 'form.create', 'dataset.list', 'entity.list', 'submission.list', 'submission.read', 'submission.update'];

const form = {
  projectId: 1, xmlFormId: 'household', name: 'Household', state: 'open', publishedAt: '2026-10-01T00:00:00Z',
  createdAt: '2026-10-01T00:00:00Z', updatedAt: null, submissions: 3, reviewStates: { received: 3, hasIssues: 0, edited: 0 },
  lastSubmission: null, version: '1', hash: 'a'.repeat(32), sha: 's', sha256: 's', keyId: null, enketoId: 'e1', enketoOnceId: null,
  webformsEnabled: true, entityRelated: false, publicLinks: 0, excelContentType: null, draftToken: null,
  createdBy: { id: 1, displayName: 'Fixture' }, lastSubmissionDate: null, publishNotes: null
};
const draft = { ...form, version: '2', hash: 'b'.repeat(32), publishedAt: null, draftToken: 'token', enketoId: 'e2', submissions: 0 };

const clean = { doctorVersion: 1, formVersion: '2', hash: draft.hash, draft: true, findings: [], notChecked: [],
  summary: { questions: 3, groups: 0, repeats: 0, calculations: 0, choiceLists: 1, languages: [], expressions: 2, errors: 0, warnings: 0, notes: 0 } };
const simulated = (seed, extra = {}) => ({
  simulatorVersion: 1, seed, runs: 200, runsAsked: 200, reducedForBudget: false, simulatedToday: '2026-01-01',
  questions: [
    { path: '/data/district', label: 'District', control: 'select1', shown: 200, answered: 200, constraintNeverMet: 0 },
    { path: '/data/bo_only', label: 'Bo only', control: 'input', shown: 0, answered: 0, constraintNeverMet: 0 },
    { path: '/data/age', label: 'Age', control: 'input', shown: 200, answered: 188, constraintNeverMet: 12 }
  ],
  neverShown: ['/data/bo_only'], constraintNeverMet: [{ path: '/data/age', interviews: 12 }],
  length: { min: 2, median: 2, max: 3 },
  notSimulated: [{ path: '/data/fancy', attribute: 'relevant', expression: 'pulldata(1)', reason: 'it uses the function pulldata(), which the simulator does not evaluate' }],
  reportHash: 'f'.repeat(64), formVersion: '2', hash: draft.hash, draft: true, ...extra
});

const api = async (page, simulation) => {
  const errors = [];
  const calls = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Only in the top window: the Draft page's hidden download iframe would run it
  // again, and a storage change from another frame logs the session out.
  await page.addInitScript(() => { if (window === window.top) localStorage.setItem('sessionExpires', String(Date.now() + 3600000)); });
  await page.route('**/client-config.json', (r) => r.fulfill({ json: {} }));
  await page.route('**/version.txt', (r) => r.fulfill({ body: 'fixture' }));
  await page.route('**/v1/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    calls.push(pathname);
    if (pathname.endsWith('/simulation')) { await simulation(route, new URL(route.request().url())); return; }
    if (pathname.endsWith('/doctor')) { await route.fulfill({ json: clean }); return; }
    const project = { id: 1, name: 'Synthetic', forms: 1, datasets: 0, archived: false, verbs };
    const base = '/v1/projects/1/forms/household';
    const json = pathname === '/v1/sessions/restore' ? { expiresAt: '2099-01-01T00:00:00Z', csrf: 'fixture' }
      : pathname === '/v1/users/current' ? { id: 1, displayName: 'Fixture', verbs: [], preferences: { site: {}, projects: {} } }
        : pathname === '/v1/projects' ? [project]
          : pathname === '/v1/projects/1' ? project
            : pathname === base ? form
              : pathname === `${base}/draft` ? draft
                : pathname === `${base}/versions` ? [form]
                  : pathname.endsWith('.svc/Submissions') ? { value: [], '@odata.count': 0 }
                    : [];
    await route.fulfill({ json });
  });
  return { errors, calls };
};
const draftPage = `${appUrl}/projects/1/forms/household/draft`;

test('a manager simulates interviews of the Draft and reads the report', async ({ page }) => {
  const asked = [];
  const { errors, calls } = await api(page, async (route, url) => {
    asked.push(Object.fromEntries(url.searchParams));
    await route.fulfill({ json: simulated(url.searchParams.get('seed') ?? 'a1b2c3d4e5f6a7b8') });
  });
  await page.goto(draftPage);
  const section = page.locator('#form-edit-simulation');
  await expect(section).toContainText('evidence, not proof');
  await expect(section.locator('.simulation-idle')).toContainText('Not simulated yet.');
  // Nothing is simulated until asked.
  expect(calls.filter((c) => c.endsWith('/simulation'))).toHaveLength(0);
  await section.getByLabel('Interviews').fill('200');
  await section.getByRole('button', { name: 'Simulate interviews' }).click();
  await expect(section.locator('.simulation-summary')).toContainText('200 simulated interviews (seed a1b2c3d4e5f6a7b8): 2 to 3 questions shown, 2 typically.');
  expect(asked[0]).toEqual({ runs: '200' });
  expect(calls).toContain('/v1/projects/1/forms/household/draft/simulation');
  await expect(section.locator('.simulation-never')).toContainText('Never shown (1)');
  await expect(section.locator('.simulation-never')).toContainText('/data/bo_only Bo only');
  await expect(section.locator('.simulation-constraint')).toContainText('/data/age Age · 12 of 200 interviews');
  await expect(section.locator('.simulation-not-simulated')).not.toHaveAttribute('open', '');
  await expect(section.locator('.simulation-not-simulated')).toContainText('Not simulated (1)');
  await section.getByText('Every question (3)').click();
  await expect(section.locator('.simulation-table tbody tr').nth(2).locator('td')).toHaveText(['200', '188']);

  // A seed reproduces a run.
  await section.getByLabel('Seed').fill('field-test');
  await section.getByRole('button', { name: 'Simulate interviews' }).click();
  await expect(section.locator('.simulation-summary')).toContainText('(seed field-test)');
  expect(asked[1]).toEqual({ runs: '200', seed: 'field-test' });

  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= 360)).toBe(true);
  expect(errors).toEqual([]);
});

test('a clean simulation says so, and a refused one is explained', async ({ page }) => {
  let refuse = true;
  const { errors } = await api(page, async (route, url) => {
    if (refuse) { await route.fulfill({ status: 400, json: { code: 400.57, message: 'This form is too large for the form check.' } }); return; }
    await route.fulfill({ json: simulated(url.searchParams.get('seed') ?? 's', { neverShown: [], constraintNeverMet: [], notSimulated: [] }) });
  });
  await page.goto(draftPage);
  const section = page.locator('#form-edit-simulation');
  await section.getByRole('button', { name: 'Simulate interviews' }).click();
  await expect(section.getByRole('alert')).toContainText('This form is too large for the form check.');
  refuse = false;
  await section.getByRole('button', { name: 'Simulate interviews' }).click();
  await expect(section.locator('.simulation-clean')).toContainText('Every question was shown in some interview');
  expect(errors).toEqual([]);
});

test('compares draft and published simulations with the same seed and refuses a changed baseline', async ({ page }) => {
  let changed = false; let denied = false; const requests = [];
  const { errors } = await api(page, async (route, url) => {
    requests.push({ path: url.pathname, seed: url.searchParams.get('seed'), runs: url.searchParams.get('runs') });
    const published = !url.pathname.includes('/draft/');
    if (published && denied) { await route.fulfill({ status: 403, json: { message: 'Published version is unavailable.' } }); return; }
    await route.fulfill({ json: simulated(url.searchParams.get('seed') ?? 'generated', published ? {
      hash: changed ? 'changed' : form.hash, formVersion: '1', draft: false,
      questions: [{ path: '/data/district', shown: 100, answered: 100 }, { path: '/data/old', shown: 200, answered: 200 }],
      notSimulated: [{ path: '/data/old', attribute: 'relevant', reason: 'unsupported' }]
    } : {}) });
  });
  await page.goto(draftPage);
  const section = page.locator('#form-edit-simulation');
  await section.getByLabel('Compare with published version').check();
  await section.getByRole('button', { name: 'Simulate interviews' }).click();
  const comparison = section.locator('.simulation-comparison');
  await expect(comparison).toContainText('separate simulations, not paired interviews');
  await expect(comparison.locator('tr', { hasText: '/data/district' }).locator('td')).toHaveText(['50.0% (100/200)', '100.0% (200/200)']);
  await expect(comparison.locator('tr', { hasText: '/data/old' }).locator('td')).toHaveText(['100.0% (200/200)', 'Not in version']);
  await expect(comparison.locator('tr', { hasText: '/data/age' }).locator('td')).toHaveText(['Not in version', '100.0% (200/200)']);
  await expect(comparison).toContainText('Published expressions not simulated (1)');
  expect(requests).toEqual([{ path: '/v1/projects/1/forms/household/draft/simulation', seed: null, runs: '200' },
    { path: '/v1/projects/1/forms/household/simulation', seed: 'generated', runs: '200' }]);
  changed = true;
  await section.getByRole('button', { name: 'Simulate interviews' }).click();
  await expect(section.getByRole('alert')).toContainText('form or simulation date changed');
  await expect(comparison).toHaveCount(0);
  changed = false; denied = true;
  await section.getByRole('button', { name: 'Simulate interviews' }).click();
  await expect(section.getByRole('alert')).toContainText('Published version is unavailable.');
  await expect(comparison).toHaveCount(0);
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= 360)).toBe(true);
  expect(errors).toEqual([]);
});
