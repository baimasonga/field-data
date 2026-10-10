/* global localStorage */
// O3 random backcheck sample in the browser: docs/field-intelligence/O3-backcheck-sample.md
import { expect, test } from '@playwright/test';

const appUrl = process.env.ODK_URL || 'http://127.0.0.1:8989';
const managerVerbs = ['project.read', 'project.update', 'form.read', 'form.list', 'submission.list', 'submission.read', 'submission.update'];
const viewerVerbs = ['project.read', 'form.read', 'form.list', 'submission.list', 'submission.read'];
const fields = [];

const sampleId = '11111111-1111-4111-8111-111111111111';
const summary = { id: sampleId, drawnAt: '2026-10-10T12:00:00Z', drawnBy: { id: 1, displayName: 'Fixture' }, seed: '0123456789abcdef0123456789abcdef',
  settings: { rate: 25, minPerCollector: 2, receivedFrom: '2026-09-01', receivedTo: null }, eligible: 9, sampledBefore: 3, sampled: 5, routed: 4, alreadyDecided: 1 };
const detail = { ...summary,
  collectors: [
    { submitterId: 5, displayName: 'Collector A', eligible: 6, sampled: 3, requested: 1, linked: 1 },
    { submitterId: 6, displayName: 'Collector B', eligible: 3, sampled: 2, requested: 0, linked: 0 }
  ],
  items: [
    { instanceId: 'uuid:a1', submitterId: 5, displayName: 'Collector A', rank: 1, caseId: 'c1', caseStatus: 'in-review', routing: 'routed', backcheck: 'linked' },
    { instanceId: 'uuid:a2', submitterId: 5, displayName: 'Collector A', rank: 2, caseId: 'c2', caseStatus: 'open', routing: 'routed', backcheck: null },
    { instanceId: 'uuid:a3', submitterId: 5, displayName: 'Collector A', rank: 3, caseId: 'c3', caseStatus: 'open', routing: 'routed', backcheck: null },
    { instanceId: 'uuid:b1', submitterId: 6, displayName: 'Collector B', rank: 1, caseId: 'c4', caseStatus: 'resolved', routing: 'already-decided', backcheck: null },
    { instanceId: 'uuid:b2', submitterId: 6, displayName: 'Collector B', rank: 2, caseId: 'c5', caseStatus: 'open', routing: 'routed', backcheck: 'requested' }
  ] };

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
const samplesPath = '/v1/projects/1/forms/household/backcheck-samples';

test('a manager draws a sample, retries safely, and sees coverage by collector', async ({ page: p }) => {
  const posts = [];
  let drawn = false;
  const errors = await api(p, managerVerbs, async (route, path) => {
    if (path === samplesPath && route.request().method() === 'POST') {
      posts.push(route.request().postDataJSON());
      // The first attempt fails, as a dropped connection would.
      if (posts.length === 1) { await route.fulfill({ status: 500, json: { code: 500.1, message: 'Something went wrong.' } }); return true; }
      drawn = true;
      await route.fulfill({ status: 201, json: detail });
      return true;
    }
    if (path === samplesPath) { await route.fulfill({ json: drawn ? [summary] : [] }); return true; }
    if (path === `${samplesPath}/${sampleId}`) { await route.fulfill({ json: detail }); return true; }
    return false;
  });
  await p.goto(`${appUrl}${page}`);
  const section = p.locator('.backcheck-sample');
  await expect(section).toContainText('never the original collector');
  await expect(section).toContainText('No sample has been drawn for this Form.');
  await section.getByLabel('Share of each collector').fill('25');
  await section.getByLabel('At least, per collector').fill('2');
  await section.getByLabel('Received from').fill('2026-09-01');
  await section.getByRole('button', { name: 'Draw sample' }).click();
  await expect(section.getByRole('alert')).toContainText('Something went wrong.');
  await section.getByRole('button', { name: 'Draw sample' }).click();
  await expect(section.locator('.backcheck-sample-summary')).toContainText('5 of 9 eligible Submissions (25% per collector, at least 2, received 2026-09-01 to …); 3 skipped as sampled before.');
  await expect(section.locator('.backcheck-sample-summary')).toContainText('1 already had a review decision and were not reopened.');
  expect(posts.length).toBe(2);
  expect(posts[0].requestId).toMatch(/^[0-9a-f-]{36}$/);
  // The retry carries the same request ID, so it cannot draw twice.
  expect(posts[1]).toEqual(posts[0]);
  expect(posts[0]).toEqual({ requestId: posts[0].requestId, rate: 25, minPerCollector: 2, receivedFrom: '2026-09-01' });

  const rows = section.locator('.backcheck-sample-coverage tbody tr');
  await expect(rows.nth(0)).toContainText('Collector A');
  await expect(rows.nth(0).locator('td')).toHaveText(['6', '3', '1', '1']);
  await expect(rows.nth(1).locator('td')).toHaveText(['3', '2', '0', '0']);
  await section.getByText('Chosen Submissions (5)').click();
  const items = section.locator('.backcheck-sample-items li');
  await expect(items.nth(0)).toContainText('backcheck linked');
  await expect(items.nth(1)).toContainText('in the review queue, no backcheck yet');
  await expect(items.nth(3)).toContainText('already decided, not reopened');
  await expect(items.nth(0).getByRole('link')).toHaveAttribute('href', '/projects/1/forms/household/submissions/uuid%3Aa1');
  await expect(section.locator('.backcheck-sample-seed')).toContainText('0123456789abcdef0123456789abcdef');
  await p.setViewportSize({ width: 360, height: 800 });
  expect(await p.evaluate(() => document.documentElement.scrollWidth <= 360)).toBe(true);
  expect(errors).toEqual([]);
});

test('a viewer sees samples but cannot draw one', async ({ page: p }) => {
  const errors = await api(p, viewerVerbs, async (route, path) => {
    if (path === samplesPath) { await route.fulfill({ json: [summary] }); return true; }
    if (path === `${samplesPath}/${sampleId}`) { await route.fulfill({ json: detail }); return true; }
    return false;
  });
  await p.goto(`${appUrl}${page}`);
  const section = p.locator('.backcheck-sample');
  await expect(section.locator('.backcheck-sample-coverage')).toContainText('Collector B');
  await expect(section.getByRole('button', { name: 'Draw sample' })).toHaveCount(0);
  expect(errors).toEqual([]);
});
