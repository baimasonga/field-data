/* global localStorage */
// S1 survey doctor in the browser: docs/field-intelligence/S1-survey-doctor.md
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

const finding = (severity, code, path, message, extra = {}) => ({ severity, code, path, message, attribute: 'relevant', expression: null, related: [], ...extra });
const report = (findings, notChecked = []) => ({
  doctorVersion: 1, formVersion: '2', hash: draft.hash, draft: true, findings, notChecked,
  summary: {
    questions: 14, groups: 1, repeats: 1, calculations: 2, choiceLists: 3, languages: [], expressions: 12,
    errors: findings.filter((f) => f.severity === 'error').length,
    warnings: findings.filter((f) => f.severity === 'warning').length,
    notes: findings.filter((f) => f.severity === 'note').length
  }
});
const withProblems = report([
  finding('error', 'never-shown', '/data/bo_only', 'This question can never be shown: its relevance is never true.', { expression: " /data/district  = 'bo'" }),
  finding('error', 'cycle', '/data/a', 'Its calculate depends on /data/b, which in turn depend on it.', { attribute: 'calculate', expression: '/data/b + 1', related: ['/data/b'] }),
  finding('warning', 'forward-reference', '/data/early', 'Its relevant depends on /data/late, asked later in the form.'),
  finding('note', 'number-without-range', '/data/hh_size', 'This number question has no constraint.', { attribute: 'constraint' })
], [{ reason: 'relevance-not-evaluated', paths: ['/data/fancy'] }]);

const api = async (page, doctor) => {
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
    if (pathname.endsWith('/doctor')) { await doctor(route, pathname); return; }
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

test('the Draft page checks the draft, shows findings by severity, and the publish dialog warns but allows publishing', async ({ page }) => {
  const { errors, calls } = await api(page, (route) => route.fulfill({ json: withProblems }));
  await page.goto(draftPage);
  const section = page.locator('#form-edit-doctor');
  await expect(section.locator('.doctor-summary')).toContainText('2 errors · 1 warning · 1 note');
  await expect(section.locator('.doctor-summary')).toContainText('(14 questions, 12 expressions checked)');
  const errorsGroup = section.locator('.doctor-group.doctor-error');
  await expect(errorsGroup).toHaveAttribute('open', '');
  await expect(errorsGroup.locator('.doctor-finding')).toHaveCount(2);
  await expect(errorsGroup.locator('.doctor-finding').first()).toContainText('/data/bo_only');
  await expect(errorsGroup.locator('.doctor-finding').first()).toContainText('Never shown');
  await expect(errorsGroup.locator('.doctor-finding').first()).toContainText("relevant: /data/district  = 'bo'");
  await expect(errorsGroup.locator('.doctor-finding').nth(1)).toContainText('Depends on itself');
  await expect(section.locator('.doctor-group.doctor-warning')).toContainText('Depends on a later question');
  // Notes and what was not checked are collapsed.
  await expect(section.locator('.doctor-group.doctor-note')).not.toHaveAttribute('open', '');
  await expect(section.locator('.doctor-not-checked')).toContainText('Not checked (1)');
  expect(calls.filter((c) => c === '/v1/projects/1/forms/household/draft/doctor')).toHaveLength(1);

  await page.getByRole('button', { name: 'Publish Draft' }).click();
  const modal = page.locator('#form-draft-publish');
  await expect(modal.locator('.modal-warnings')).toContainText('The form check found 2 errors in this Draft');
  await expect(modal.locator('.modal-warnings')).toContainText('You can still publish.');
  await expect(modal.getByRole('button', { name: 'Proceed' })).not.toHaveAttribute('aria-disabled', 'true');

  await page.setViewportSize({ width: 360, height: 800 });
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= 360)).toBe(true);
  expect(errors).toEqual([]);
});

test('a clean draft says so, can be checked again, and the publish dialog has no form-check warning', async ({ page }) => {
  let count = 0;
  const { errors } = await api(page, (route) => { count += 1; return route.fulfill({ json: report([]) }); });
  await page.goto(draftPage);
  const section = page.locator('#form-edit-doctor');
  await expect(section).toContainText('No errors or warnings found.');
  await expect(section.locator('.doctor-group')).toHaveCount(0);
  await section.getByRole('button', { name: 'Check again' }).click();
  await expect.poll(() => count).toBe(2);
  await page.getByRole('button', { name: 'Publish Draft' }).click();
  await expect(page.locator('#form-draft-publish')).not.toContainText('form check');
  expect(errors).toEqual([]);
});

test('a check that fails is explained and does not break the Draft page', async ({ page }) => {
  const { errors } = await api(page, (route) => route.fulfill({ status: 400, json: { code: 400.57, message: 'This form is too large for the form check (more than 5,000 questions or 5 MB), so it was not checked.' } }));
  await page.goto(draftPage);
  await expect(page.locator('#form-edit-doctor').getByRole('alert')).toContainText('too large for the form check');
  await expect(page.getByRole('button', { name: 'Publish Draft' })).toBeVisible();
  expect(errors).toEqual([]);
});
