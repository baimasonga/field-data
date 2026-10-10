/* global localStorage */
// G1b imagery availability in the browser: docs/field-intelligence/G1b-imagery-availability.md
import { expect, test } from '@playwright/test';

const appUrl = process.env.ODK_URL || 'http://127.0.0.1:8989';
const managerVerbs = ['project.read', 'project.update', 'form.read', 'form.list', 'submission.list', 'submission.read', 'submission.update'];
const viewerVerbs = ['project.read', 'form.read', 'form.list', 'submission.list', 'submission.read'];
const fields = [];

const view = (extra = {}) => ({
  enabled: true, catalogue: 'https://earth-search.aws.element84.com/v1', collection: 'sentinel-2-l2a', windowDays: 30, clearBelow: 30, cellDegrees: 0.05,
  encrypted: false,
  coverage: { total: 4, noLocation: 1, notChecked: 1, checked: 2, withScene: 2, withClearScene: 1 },
  submissions: [
    { instanceId: 'uuid:a', status: 'checked', visitTime: 'receipt', scenes: 15, clear: 0,
      nearest: { id: 's1', date: '2026-09-22', cloud: 100, daysFromVisit: 2 }, clearest: { id: 's2', date: '2026-10-04', cloud: 41.7, daysFromVisit: 14 } },
    { instanceId: 'uuid:b', status: 'checked', visitTime: 'capture', scenes: 3, clear: 2,
      nearest: { id: 's3', date: '2026-01-10', cloud: 4, daysFromVisit: 0 }, clearest: { id: 's3', date: '2026-01-10', cloud: 4, daysFromVisit: 0 } },
    { instanceId: 'uuid:c', status: 'not-checked', visitTime: 'capture' },
    { instanceId: 'uuid:d', status: 'no-location' }
  ],
  ...extra
});

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

test('a reviewer checks imagery availability and sees coverage and scenes per Submission', async ({ page: p }) => {
  let checks = 0;
  const errors = await api(p, managerVerbs, async (route, path) => {
    if (path === '/v1/projects/1/forms/household/imagery/check') {
      checks += 1;
      await route.fulfill({ json: { encrypted: false, submissions: 4, located: 3, considered: 3, truncated: false, lookups: 2, looked: 1, cached: 1, unavailable: [{ cell: '8.475,-13.225', day: '2026-09-20', reason: 'catalogue answered 503' }] } });
      return true;
    }
    if (path === '/v1/projects/1/forms/household/imagery') { await route.fulfill({ json: view() }); return true; }
    return false;
  });
  await p.goto(`${appUrl}${page}`);
  const section = p.locator('.imagery-availability');
  await expect(section).toContainText('never a Submission\'s location');
  await expect(section.locator('.imagery-coverage')).toContainText('1 of 2 checked Submissions have a scene under 30% cloud');
  await expect(section.locator('.imagery-coverage')).toContainText('1 not checked yet · 1 without a location');
  await section.getByRole('button', { name: 'Check imagery availability' }).click();
  await expect(section.locator('.imagery-report')).toContainText('1 looked up, 1 already known.');
  await expect(section.locator('.imagery-report')).toContainText('could not answer for 1 place; try again later');
  expect(checks).toBe(1);
  await section.getByText('Imagery by Submission (2)').click();
  const items = section.locator('.imagery-list li');
  await expect(items.nth(0)).toContainText('15 scenes; nearest 2026-09-22 (2 days after the visit, 100% cloud); clearest 2026-10-04 (41.7% cloud)');
  await expect(items.nth(0)).toContainText('visit dated by receipt time');
  await expect(items.nth(1)).toContainText('nearest 2026-01-10 (same day, 4% cloud)');
  await expect(items.nth(0).getByRole('link')).toHaveAttribute('href', '/projects/1/forms/household/submissions/uuid%3Aa');
  await p.setViewportSize({ width: 360, height: 800 });
  expect(await p.evaluate(() => document.documentElement.scrollWidth <= 360)).toBe(true);
  expect(errors).toEqual([]);
});

test('when imagery checks are off, the section says so and offers no button; viewers cannot check', async ({ page: p }) => {
  const errors = await api(p, viewerVerbs, async (route, path) => {
    if (path === '/v1/projects/1/forms/household/imagery') { await route.fulfill({ json: view({ enabled: false }) }); return true; }
    return false;
  });
  await p.goto(`${appUrl}${page}`);
  const section = p.locator('.imagery-availability');
  await expect(section).toContainText('Satellite imagery checks are off on this server');
  await expect(section.getByRole('button')).toHaveCount(0);
  expect(errors).toEqual([]);
});
