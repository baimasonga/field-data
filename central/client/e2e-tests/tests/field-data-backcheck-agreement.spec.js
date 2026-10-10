/* global localStorage */
// O5 backcheck agreement in the browser: docs/field-intelligence/O5-backcheck-agreement.md
import { expect, test } from '@playwright/test';

const appUrl = process.env.ODK_URL || 'http://127.0.0.1:8989';
const viewerVerbs = ['project.read', 'form.read', 'form.list', 'submission.list', 'submission.read'];
const fields = [];

const api = async (page, verbs, custom) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('sessionExpires', String(Date.now() + 3600000)));
  await page.route('**/client-config.json', (r) => r.fulfill({ json: {} }));
  await page.route('**/version.txt', (r) => r.fulfill({ body: 'fixture' }));
  await page.route('**/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (await custom(route, path)) return;
    const project = { id: 1, name: 'Synthetic', forms: 1, datasets: 0, archived: false, verbs };
    const form = { projectId: 1, xmlFormId: 'household', name: 'Household', state: 'open', publishedAt: '2026-10-01T00:00:00Z',
      createdAt: '2026-10-01T00:00:00Z', updatedAt: null, submissions: 3, reviewStates: { received: 3, hasIssues: 0, edited: 0 },
      lastSubmission: null, version: '1', hash: 'h', sha: 's', sha256: 's', keyId: null, enketoId: null, webformsEnabled: true, entityRelated: false, publicLinks: 0, excelContentType: null };
    const json = path === '/v1/sessions/restore' ? { expiresAt: '2099-01-01T00:00:00Z', csrf: 'fixture' }
      : path === '/v1/users/current' ? { id: 1, displayName: 'Fixture', verbs: [], preferences: { site: {}, projects: {} } }
        : path === '/v1/projects' ? [project]
          : path === '/v1/projects/1' ? project
            : path === '/v1/projects/1/forms/household' ? form
              : path === '/v1/projects/1/forms/household/fields' ? fields
                : path === '/v1/projects/1/forms/household/evidence' ? { submissions: [], projectArea: { status: 'unusable', reason: 'no-area-set', layerId: null }, encrypted: false, coverage: { total: 3, withCaptureTime: 0, withLocation: 0, byAccuracyBand: { none: 3 }, byProjectArea: { 'not-checked': 3 } }, limits: [] }
                  : path === '/v1/field-data/review-queue/metrics' ? { counts: { open: 0, inReview: 0, resolved: 0, superseded: 0 },
                    staleWrites: { total: 0, byOperation: [] }, oldestActiveSeconds: null, averageFirstAssignmentSeconds: null,
                    averageResolutionSeconds: null, assignedCaseCount: 0, backchecks: { pending: 0, overdue: 0 }, activeReasons: [] }
                    : path.startsWith('/v1/field-data/review-queue') ? { items: [], nextCursor: null }
                      : [];
    await route.fulfill({ json });
  });
  return errors;
};
const page = '/projects/1/forms/household/verification';
const agreementPath = '/v1/projects/1/forms/household/backcheck-agreement';
const agreement = {
  backchecks: { linked: 7, used: 7, truncated: false, compared: 4, unavailable: { 'no-mapping': 2, 'source-integrity': 1 }, notReadable: 0 },
  collectors: [
    { actorId: 5, displayName: 'Collector A', backchecks: 3, withDifferences: 2, fields: 12, different: 3, missing: 1 },
    { actorId: 6, displayName: 'Collector B', backchecks: 1, withDifferences: 0, fields: 0, different: 0, missing: 4 }
  ],
  questions: [
    { question: 'mapped:Age', label: 'Age', fields: 1, different: 1, missing: 0 },
    { question: '/name', label: 'Respondent name', fields: 4, different: 1, missing: 0 }
  ]
};

test('backcheck agreement shows counts by collector and question, and retries a failed load', async ({ page: p }) => {
  let failures = 1;
  let calls = 0;
  const errors = await api(p, viewerVerbs, async (route, path) => {
    if (path !== agreementPath) return false;
    calls += 1;
    if (failures-- > 0) await route.fulfill({ status: 500, json: { message: 'Failed' } });
    else await route.fulfill({ json: agreement });
    return true;
  });
  await p.goto(`${appUrl}${page}`);
  const section = p.getByRole('region', { name: 'Backcheck agreement' });
  await expect(section).toContainText('A difference is a reason to look, not a verdict');
  await expect(section.getByRole('alert')).toHaveText('Backcheck agreement could not be loaded. Try again.');
  await section.getByRole('button', { name: 'Refresh' }).click();
  await expect(section.getByRole('alert')).toHaveCount(0);
  expect(calls).toBe(2);
  await expect(section.locator('.backcheck-agreement-totals')).toHaveText(
    '7 linked backchecks, 4 compared. 2 not compared: answered on another Form with no field mapping yet. 1 not compared: failed the integrity check.'
  );
  const a = section.locator('.backcheck-agreement-collectors tbody tr').nth(0);
  await expect(a).toContainText('Collector A');
  await expect(a).toContainText('2 of 3 backchecks (67%)');
  await expect(a).toContainText('3 of 12 answers (25%)');
  await expect(section.locator('.backcheck-agreement-collectors tbody tr').nth(1)).toContainText('no answers compared');
  const age = section.locator('.backcheck-agreement-questions tbody tr').nth(0);
  await expect(age).toContainText('Age (mapped)');
  await expect(age).toContainText('1 of 1 answer (100%)');
  await expect(section.locator('.backcheck-agreement-questions tbody tr').nth(1)).toContainText('Respondent name1 of 4 answers (25%)');
  await p.setViewportSize({ width: 360, height: 800 });
  expect(await p.evaluate(() => document.documentElement.scrollWidth <= 360)).toBe(true);
  expect(errors).toEqual([]);
});

test('backcheck agreement says when nothing could be compared', async ({ page: p }) => {
  const errors = await api(p, viewerVerbs, async (route, path) => {
    if (path !== agreementPath) return false;
    await route.fulfill({ json: { backchecks: { linked: 2, used: 2, truncated: false, compared: 0, unavailable: { 'no-mapping': 1 }, notReadable: 1 }, collectors: [], questions: [] } });
    return true;
  });
  await p.goto(`${appUrl}${page}`);
  const section = p.getByRole('region', { name: 'Backcheck agreement' });
  await expect(section.locator('.backcheck-agreement-empty')).toHaveText('No backcheck of this Form could be compared yet.');
  await expect(section.locator('.backcheck-agreement-totals')).toContainText('1 answered on a Form you may not read.');
  await expect(section.locator('table')).toHaveCount(0);
  expect(errors).toEqual([]);
});
