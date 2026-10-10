/* global localStorage */
// F4 near-duplicate submissions in the browser: docs/field-intelligence/F4-near-duplicates.md
import { expect, test } from '@playwright/test';

const appUrl = process.env.ODK_URL || 'http://127.0.0.1:8989';
const verbs = ['project.read', 'project.update', 'form.read', 'form.list', 'submission.list', 'submission.read', 'submission.update'];

const evidence = {
  submissions: [], projectArea: { status: 'unusable', reason: 'no-area-set', layerId: null }, encrypted: false,
  coverage: { total: 7, withCaptureTime: 0, withLocation: 0, byAccuracyBand: { none: 7 }, byProjectArea: { 'not-checked': 7 } },
  limits: []
};
const flag = (id, rule, outcome, ev, extra = {}) => ({
  id, rule, ruleVersion: 1, formId: 1, instanceId: `uuid:${id}`, relatedInstanceId: null, outcome, evidence: ev,
  status: 'open', decision: null, note: null, decidedBy: null, decidedAt: null, createdAt: '2026-10-10T09:00:00Z', ...extra
});
const nearDuplicate = flag('copy', 'near-duplicate', 'concern', {
  similarity: 0.917, threshold: 0.9, compared: 12, identical: 11, differing: ['/q9'], differingCount: 1, exact: false,
  alsoSimilarTo: 1, sameCollector: false, sameDevice: false, informativeQuestions: 12,
  explanation: '11 of 12 compared answers (91.7%) are identical to an earlier submission\'s. Independent interviews rarely match this closely.',
  alternatives: ['Two members of one household, or a respondent interviewed twice, answering the same way.'],
  nextStep: 'Open both submissions and compare them; ask the collector, or the collectors, how each interview was done.'
}, { relatedInstanceId: 'uuid:hh2' });

const api = async (page, custom = async () => false) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('sessionExpires', String(Date.now() + 3600000)));
  await page.route('**/client-config.json', r => r.fulfill({ json: {} }));
  await page.route('**/version.txt', r => r.fulfill({ body: 'fixture' }));
  await page.route('**/v1/**', async route => {
    const url = new URL(route.request().url()); const path = url.pathname;
    if (await custom(route, path)) return;
    const project = { id: 1, name: 'Synthetic', forms: 1, datasets: 0, archived: false, verbs };
    const form = { projectId: 1, xmlFormId: 'geo_survey', name: 'Geo survey', state: 'open', publishedAt: '2026-10-01T00:00:00Z',
      createdAt: '2026-10-01T00:00:00Z', updatedAt: null, submissions: 7, reviewStates: { received: 7, hasIssues: 0, edited: 0 },
      lastSubmission: '2026-10-09T00:00:00Z', version: '1', hash: 'h', sha: 's', sha256: 's', keyId: null, enketoId: null, webformsEnabled: true, entityRelated: false, publicLinks: 0, excelContentType: null };
    const json = path === '/v1/sessions/restore' ? { expiresAt: '2099-01-01T00:00:00Z', csrf: 'fixture' }
      : path === '/v1/users/current' ? { id: 1, displayName: 'Fixture', verbs: [], preferences: { site: {}, projects: {} } }
        : path === '/v1/projects' ? [project]
          : path === '/v1/projects/1' ? project
            : path === '/v1/projects/1/forms/geo_survey' ? form
              : path === '/v1/field-data/review-queue/metrics' ? { counts: { open: 0, inReview: 0, resolved: 0, superseded: 0 },
                staleWrites: { total: 0, byOperation: [] }, oldestActiveSeconds: null, averageFirstAssignmentSeconds: null,
                averageResolutionSeconds: null, assignedCaseCount: 0, backchecks: { pending: 0, overdue: 0 }, activeReasons: [] }
                : path.startsWith('/v1/field-data/review-queue') ? { items: [], nextCursor: null }
                : [];
    await route.fulfill({ json });
  });
  return errors;
};

test('a near-duplicate finding shows what matched, links both Submissions, and the run reports the check', async ({ page }) => {
  const errors = await api(page, async (route, path) => {
    if (path === '/v1/projects/1/forms/geo_survey/evidence') { await route.fulfill({ json: evidence }); return true; }
    if (path === '/v1/projects/1/forms/geo_survey/integrity') { await route.fulfill({ json: [nearDuplicate] }); return true; }
    if (path === '/v1/projects/1/forms/geo_survey/integrity/run') {
      await route.fulfill({ json: {
        rule: 'implausible-travel', ruleVersion: 1, thresholds: { maxSpeedKmh: 120, minSecondsBetween: 120, maxUsableAccuracyM: 100 },
        examined: 7, collectors: 2, concerns: 0, inconclusive: 0, plausible: 0, withdrawn: 0, encrypted: false, locationRules: [],
        nearDuplicates: { rule: 'near-duplicate', ruleVersion: 1, ran: true, examined: 7, concern: 1, comparedQuestions: 12,
          thresholds: { similarity: 0.9, minShared: 8, maxCommonShare: 0.8 } }
      } });
      return true;
    }
    return false;
  });
  await page.goto(`${appUrl}/projects/1/forms/geo_survey/verification`);
  const finding = page.locator('.finding');
  await expect(finding).toContainText('Near-duplicate answers');
  await expect(finding).toContainText('11 of 12 compared answers (91.7%) are identical');
  await expect(finding.locator('.finding-similarity')).toContainText('11 of 12 compared');
  await expect(finding.locator('.finding-similarity')).toContainText('/q9');
  await expect(finding.locator('.finding-similarity')).toContainText('Other earlier Submissions as similar');
  await expect(finding).toContainText('Two members of one household');
  await expect(finding.getByRole('link', { name: 'Open the earlier, similar Submission' })).toHaveAttribute('href', /uuid%3Ahh2/);
  await expect(finding.getByRole('link', { name: 'Open this Submission' })).toHaveAttribute('href', /uuid%3Acopy/);

  await page.getByRole('button', { name: 'Run checks' }).click();
  await expect(page.locator('.run-report')).toContainText('Near-duplicate answers v1: 1 to look at (12 questions compared).');
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= 360)).toBe(true);
  expect(errors).toEqual([]);
});

test('the run says when near-duplicates could not be checked', async ({ page }) => {
  const errors = await api(page, async (route, path) => {
    if (path === '/v1/projects/1/forms/geo_survey/evidence') { await route.fulfill({ json: evidence }); return true; }
    if (path === '/v1/projects/1/forms/geo_survey/integrity') { await route.fulfill({ json: [] }); return true; }
    if (path === '/v1/projects/1/forms/geo_survey/integrity/run') {
      await route.fulfill({ json: {
        rule: 'implausible-travel', ruleVersion: 1, thresholds: { maxSpeedKmh: 120, minSecondsBetween: 120, maxUsableAccuracyM: 100 },
        examined: 9000, collectors: 2, concerns: 0, inconclusive: 0, plausible: 0, withdrawn: 0, encrypted: false, locationRules: [],
        nearDuplicates: { rule: 'near-duplicate', ruleVersion: 1, ran: false, reason: 'too-many-submissions', examined: 9000 }
      } });
      return true;
    }
    return false;
  });
  await page.goto(`${appUrl}/projects/1/forms/geo_survey/verification`);
  await page.getByRole('button', { name: 'Run checks' }).click();
  await expect(page.locator('.run-report')).toContainText('Near-duplicate answers: not checked, the Form has more Submissions than can be compared.');
  expect(errors).toEqual([]);
});
