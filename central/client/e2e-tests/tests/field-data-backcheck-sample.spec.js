/* global localStorage, document, window, getComputedStyle */
// O3 random backcheck sample in the browser: docs/field-intelligence/O3-backcheck-sample.md
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

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
  await page.addInitScript(() => {
    if (window === window.top) localStorage.setItem('sessionExpires', String(Date.now() + 3600000));
  });
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
        : path.endsWith('/backcheck-allocation') ? { policy: null, forms: [], collectors: [] }
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

// O6 scheduled samples: docs/field-intelligence/O6-scheduled-backcheck-samples.md
const schedulePath = '/v1/projects/1/forms/household/backcheck-schedule';
const scheduled = { ...detail, id: '22222222-2222-4222-8222-222222222222', drawnBy: null, scheduled: true,
  settings: { rate: 20, minPerCollector: 1, receivedFrom: '2026-10-05', receivedTo: '2026-10-11', periodStart: '2026-10-05T00:00:00.000Z', periodEnd: '2026-10-12T00:00:00.000Z' } };
const saved = (body) => ({
  schedule: { ...body, periodStart: '2026-10-05T00:00:00.000Z', nextRunAt: body.enabled ? '2026-10-19T00:00:00.000Z' : null, updatedAt: '2026-10-11T00:00:00.000Z', updatedByName: 'Fixture' },
  runs: [
    { periodStart: '2026-10-05T00:00:00.000Z', periodEnd: '2026-10-12T00:00:00.000Z', periods: 1, outcome: 'drawn', sampleId: scheduled.id, eligible: 9, sampled: 5, error: null, ranAt: '2026-10-12T00:05:00Z' },
    { periodStart: '2026-09-14T00:00:00.000Z', periodEnd: '2026-10-05T00:00:00.000Z', periods: 3, outcome: 'nothing-eligible', sampleId: null, eligible: 0, sampled: 0, error: null, ranAt: '2026-10-05T00:05:00Z' },
    { periodStart: '2026-09-07T00:00:00.000Z', periodEnd: '2026-09-14T00:00:00.000Z', periods: 1, outcome: 'failed', sampleId: null, eligible: 0, sampled: 0, error: '612 submissions is more than the 500 allowed; lower the rate or draw this period by hand.', ranAt: '2026-09-14T00:05:00Z' }
  ]
});

test('a manager sets a schedule and sees its runs and scheduled samples', async ({ page: p }) => {
  const puts = [];
  let current = { schedule: null, runs: [] };
  const errors = await api(p, managerVerbs, async (route, path) => {
    if (path === schedulePath && route.request().method() === 'PUT') {
      const body = route.request().postDataJSON();
      puts.push(body);
      if (puts.length === 1) { await route.fulfill({ status: 400, json: { code: 400.58, message: 'The rate must be a whole percentage from 1 to 100.' } }); return true; }
      current = saved(body);
      await route.fulfill({ json: current });
      return true;
    }
    if (path === schedulePath) { await route.fulfill({ json: current }); return true; }
    // The latest sample was drawn by hand; the scheduled one is older.
    if (path === samplesPath) { await route.fulfill({ json: [summary, { ...summary, ...scheduled }] }); return true; }
    if (path === `${samplesPath}/${sampleId}`) { await route.fulfill({ json: detail }); return true; }
    if (path === `${samplesPath}/${scheduled.id}`) { await route.fulfill({ json: scheduled }); return true; }
    return false;
  });
  await p.goto(`${appUrl}${page}`);
  const section = p.locator('.backcheck-schedule');
  await expect(section.locator('.backcheck-schedule-status')).toHaveText('No schedule.');
  await expect(section).toContainText('Turning it on starts from now');
  await section.getByLabel('Share of each collector').fill('20');
  await section.getByLabel('Every').selectOption('weekly');
  await section.getByRole('button', { name: 'Save schedule' }).click();
  await expect(section.getByRole('alert')).toHaveText('The rate must be a whole percentage from 1 to 100.');
  await section.getByRole('button', { name: 'Save schedule' }).click();
  await expect(section.locator('.backcheck-schedule-status')).toContainText('On: 20% per collector, at least 1, weekly. Next sample after');
  expect(puts.at(-1)).toEqual({ rate: 20, minPerCollector: 1, frequency: 'weekly', enabled: true });
  const runs = section.locator('.backcheck-schedule-runs li');
  await expect(runs).toHaveCount(3);
  await expect(runs.nth(0)).toContainText('5 of 9 chosen');
  await expect(runs.nth(1)).toContainText('(3 periods, caught up): nothing received to sample');
  await expect(runs.nth(2)).toContainText('not drawn: 612 submissions is more than the 500 allowed');

  // The run's sample opens below, marked as drawn on schedule.
  await expect(p.locator('.backcheck-sample-summary')).toContainText('by Fixture');
  await expect(p.locator('.backcheck-sample-pick option').nth(1)).toContainText('scheduled');
  await runs.nth(0).getByRole('button', { name: 'Show sample' }).click();
  await expect(p.locator('.backcheck-sample-summary')).toContainText('on schedule:');
  await expect(p.locator('.backcheck-sample-summary')).not.toContainText('by Fixture');

  // Turning it off.
  await section.getByLabel('On', { exact: true }).uncheck();
  await section.getByRole('button', { name: 'Save schedule' }).click();
  await expect(section.locator('.backcheck-schedule-status')).toHaveText('Off.');
  expect(puts.at(-1).enabled).toBe(false);
  await p.setViewportSize({ width: 360, height: 800 });
  expect(await p.evaluate(() => document.documentElement.scrollWidth <= 360)).toBe(true);
  expect(errors).toEqual([]);
});

test('a viewer sees the schedule but cannot change it', async ({ page: p }) => {
  const errors = await api(p, viewerVerbs, async (route, path) => {
    if (path === schedulePath) { await route.fulfill({ json: saved({ rate: 10, minPerCollector: 1, frequency: 'daily', enabled: true }) }); return true; }
    if (path === samplesPath) { await route.fulfill({ json: [] }); return true; }
    return false;
  });
  await p.goto(`${appUrl}${page}`);
  const section = p.locator('.backcheck-schedule');
  await expect(section.locator('.backcheck-schedule-status')).toContainText('On: 10% per collector, at least 1, daily.');
  await expect(section.getByRole('button', { name: 'Save schedule' })).toHaveCount(0);
  await expect(section.locator('.backcheck-schedule-runs li')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('a manager configures independent automatic allocation, collector capacity and sees waiting reports', async ({ page: p }) => {
  const allocationPath = '/v1/projects/1/forms/household/backcheck-allocation';
  const forms = [{ id: 2, xmlFormId: 'responses', name: 'Revisit' }];
  const collectors = [{ id: 5, name: 'Checker A', pending: 2, overdue: 1, maxPending: 5 }, { id: 6, name: 'Checker B', pending: 0, overdue: 0, maxPending: 5 }];
  const puts = [];
  let policy = null;
  const errors = await api(p, managerVerbs, async (route, path) => {
    if (path === allocationPath) {
      if (route.request().method() === 'PUT') {
        const settings = route.request().postDataJSON(); puts.push(settings);
        if (puts.length === 1) { await route.fulfill({ status: 500, json: { message: 'Save failed; try again.' } }); return true; }
        policy = { enabled: settings.enabled, settings, report: { at: '2026-10-13T12:00:00Z', examined: 5, assigned: 2, noIndependentCollector: 1, atCapacity: 2, failure: null } };
      }
      await route.fulfill({ json: { policy, forms, collectors } }); return true;
    }
    if (path === samplesPath) { await route.fulfill({ json: [] }); return true; }
    return false;
  });
  await p.goto(`${appUrl}${page}`);
  const section = p.locator('.backcheck-allocation');
  await expect(section).toContainText('never the original collector');
  await section.getByLabel('Automatic response Form').selectOption('responses');
  await section.getByLabel('Backcheck instructions').fill('Verify the visit with the respondent.');
  await section.getByLabel('Due within').fill('7');
  await section.getByLabel('Default pending capacity').fill('3');
  await section.getByLabel('Pending capacity for Checker A').fill('0');
  await section.getByLabel('Enable automatic assignment').check();
  await section.getByRole('button', { name: 'Save allocation policy' }).click();
  await expect(section.getByRole('alert')).toContainText('Save failed');
  await section.getByRole('button', { name: 'Save allocation policy' }).click();
  expect(puts[1]).toEqual({ enabled: true, responseXmlFormId: 'responses', question: 'Verify the visit with the respondent.', dueDays: 7,
    maxPending: 3, respectCalendar: false, collectorLimits: [{ actorId: 5, maxPending: 0 }] });
  expect(puts[0]).toEqual(puts[1]);
  await expect(section).toContainText('2 assigned of 5 considered');
  await expect(section).toContainText('1 waiting for an independent collector');
  await expect(section).toContainText('2 waiting for capacity');
  await section.getByLabel('Enable automatic assignment').uncheck();
  await section.getByRole('button', { name: 'Save allocation policy' }).click();
  await expect(section).toContainText('Paused');
  await section.getByLabel('Respect calendar availability').check();
  await section.getByRole('button', { name: 'Save allocation policy' }).click();
  expect(puts.at(-1).respectCalendar).toBe(true);
  await p.setViewportSize({ width: 390, height: 844 });
  await expect(section.getByRole('button', { name: 'Save allocation policy' })).toBeVisible();
  expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('a viewer reads automatic allocation failure without configuration controls', async ({ page: p }) => {
  await api(p, viewerVerbs, async (route, path) => {
    if (path.endsWith('/backcheck-allocation')) {
      await route.fulfill({ json: { policy: { enabled: false, settings: { responseXmlFormId: 'responses', dueDays: 7, maxPending: 2, question: 'Verify.', collectorLimits: [] },
        report: { failure: 'Automatic allocation paused: access was revoked.' } }, forms: [], collectors: [] } }); return true;
    }
    if (path === samplesPath) { await route.fulfill({ json: [] }); return true; }
    return false;
  });
  await p.goto(`${appUrl}${page}`);
  const section = p.locator('.backcheck-allocation');
  await expect(section).toContainText('access was revoked');
  await expect(section.getByRole('button', { name: 'Save allocation policy' })).toHaveCount(0);
});

test('a manager saves calendar exceptions and exports an itinerary with capacity and exclusion warnings', async ({ page: p }) => {
  let settings = null; const saves = []; const routes = [];
  const plan = { actor: { id: 5, name: 'Checker' }, date: '2026-10-14', capacity: 1, used: 2, unplanned: 1, uncertainLocations: 1,
    truncated: true, needsReview: true, excluded: { permission: 0, inactive: 0, collectorUnavailable: 0, encryptedSource: 0, sourceUnverified: 1, missingLocation: 1 },
    road: { status: 'ok', distanceKm: 3, travelMinutes: 60, maxSnapMeters: 150, legs: [{ distanceKm: 1.5, travelMinutes: 30 }, { distanceKm: 1.5, travelMinutes: 30 }] },
    timing: { totalMinutes: 90, visitMinutes: 30, dayMinutes: 60, overBudget: true },
    route: { distanceKm: 2.2, returnKm: 1.1, stops: [{ id: 'task', instanceId: '=unsafe', order: 1, legKm: 1.1,
      location: { latitude: 8.49, longitude: -13.23, accuracy: null }, uncertain: true }] } };
  const errors = await api(p, managerVerbs, async (route, path) => {
    if (path.endsWith('/backcheck-allocation')) { await route.fulfill({ json: { policy: null, forms: [], collectors: [] } }); return true; }
    if (path === '/v1/projects/1/backcheck-calendars') { await route.fulfill({ json: [{ id: 5, name: 'Checker', settings }] }); return true; }
    if (path === '/v1/projects/1/backcheck-calendars/5') {
      saves.push(route.request().postDataJSON());
      if (saves.length === 1) { await route.fulfill({ status: 500, json: { message: 'Save failed; retry.' } }); return true; }
      settings = saves.at(-1); await route.fulfill({ json: { id: 5, settings } }); return true;
    }
    if (path.endsWith('/backcheck-route')) { routes.push(new URL(route.request().url()).searchParams); await route.fulfill({ json: plan }); return true; }
    if (path === samplesPath) { await route.fulfill({ json: [] }); return true; }
    return false;
  });
  await p.goto(`${appUrl}${page}`);
  const section = p.locator('.backcheck-planning');
  await section.getByLabel('Planning collector').selectOption('5');
  await expect(section).toContainText('No calendar configured.');
  await section.getByLabel('Wednesday visits', { exact: true }).fill('2');
  await section.getByRole('button', { name: 'Add dated exception' }).click();
  await section.getByLabel('Exception date', { exact: true }).fill('2026-10-14');
  await section.getByLabel('Exception visits', { exact: true }).fill('0');
  await section.getByRole('button', { name: 'Save calendar', exact: true }).click();
  await expect(section.getByRole('alert')).toContainText('Save failed');
  await section.getByRole('button', { name: 'Save calendar', exact: true }).click();
  expect(saves[1]).toEqual({ weeklyCapacity: [0, 0, 0, 2, 0, 0, 0], exceptions: [{ date: '2026-10-14', maxVisits: 0 }] });
  expect(saves[0]).toEqual(saves[1]);
  await expect(section).toContainText('Calendar saved.');
  await section.getByLabel('Route date').fill('2026-10-14');
  await section.getByLabel('Start latitude').fill('8.48');
  await section.getByLabel('Start longitude').fill('-13.23');
  await section.getByLabel('Available minutes including travel').fill('60');
  await section.getByRole('button', { name: 'Preview itinerary' }).click();
  await expect(section).toContainText('1 located stops · 2.2 km straight-line total');
  await expect(section).toContainText('This day is over capacity');
  await expect(section).toContainText('60 minutes driving');
  await expect(section).toContainText('This itinerary exceeds the available time');
  await expect(section).toContainText('90 minutes including 30 minutes per visit');
  await expect(section).toContainText('more than 100 metres');
  await expect(section).toContainText('the task list was truncated');
  expect(Object.fromEntries(routes[0])).toEqual({ actorId: '5', date: '2026-10-14', startLat: '8.48', startLon: '-13.23', visitMinutes: '30', dayMinutes: '60' });
  const downloaded = p.waitForEvent('download');
  await section.getByRole('button', { name: 'Download itinerary CSV' }).click();
  const download = await downloaded;
  const csv = await readFile(await download.path(), 'utf8');
  expect(csv).toContain('Driving leg (minutes)'); expect(csv).toContain('Road estimate status');
  expect(csv).toContain("'=" + 'unsafe'); expect(csv).toContain('Review required'); expect(csv).toContain('Truncated'); expect(csv).toContain('"-13.23"');
  await p.setViewportSize({ width: 390, height: 844 });
  await expect(section.getByRole('button', { name: 'Preview itinerary' })).toBeVisible();
  expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  plan.road = { status: 'unavailable' };
  await section.getByRole('button', { name: 'Preview itinerary' }).click();
  await expect(section).toContainText('Travel time remains unknown.');
  expect(errors).toEqual([]);
});

test('a viewer reads availability without calendar edits or route coordinates', async ({ page: p }) => {
  await api(p, viewerVerbs, async (route, path) => {
    if (path.endsWith('/backcheck-allocation')) { await route.fulfill({ json: { policy: null, forms: [], collectors: [] } }); return true; }
    if (path.endsWith('/backcheck-calendars')) { await route.fulfill({ json: [{ id: 5, name: 'Checker', settings: { weeklyCapacity: [0, 2, 2, 2, 2, 2, 0], exceptions: [] } }] }); return true; }
    if (path === samplesPath) { await route.fulfill({ json: [] }); return true; }
    return false;
  });
  await p.goto(`${appUrl}${page}`);
  const section = p.locator('.backcheck-planning');
  await section.getByLabel('Planning collector').selectOption('5');
  await expect(section).toContainText('Weekly visits, Sunday to Saturday: 0, 2, 2, 2, 2, 2, 0');
  await expect(section.getByRole('button', { name: 'Save calendar' })).toHaveCount(0);
  await expect(section.getByRole('button', { name: 'Preview itinerary' })).toHaveCount(0);
});

test('form navigation and submission pagination are readable at desktop and mobile widths', async ({ page: p }) => {
  const errors = await api(p, managerVerbs, async (route, path) => {
    if (path.endsWith('.svc/Submissions')) {
      await route.fulfill({ json: { '@odata.count': 1, value: [{ __id: 'uuid:one', __system: {
        submissionDate: '2026-10-13T12:00:00Z', submitterId: 1, submitterName: 'Fixture',
        reviewState: null, edits: 0, attachmentsPresent: 0, attachmentsExpected: 0
      } }] } }); return true;
    }
    return false;
  });
  await p.goto(`${appUrl}/projects/1/forms/household/submissions`);
  const nav = p.locator('#form-subtabs');
  await expect(nav).toHaveText('Submissions Summary Charts Photos');
  await expect(nav.getByRole('link', { name: 'Submissions', exact: true })).toHaveAttribute('aria-current', 'page');
  const pagination = p.locator('.pagination');
  await expect(pagination).toContainText('Row 1 of 1');
  const select = pagination.locator('select');
  await expect(select).toHaveValue('250');
  for (const width of [1440, 390]) {
    await p.setViewportSize({ width, height: 900 });
    const links = await nav.locator('a').all();
    for (const link of links) expect((await link.boundingBox()).height).toBeGreaterThanOrEqual(44);
    expect((await select.boundingBox()).width).toBeGreaterThanOrEqual(70);
    const label = await pagination.locator('label span').boundingBox();
    const field = await select.boundingBox();
    expect(field.x + field.width).toBeLessThanOrEqual(label.x);
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await p.locator('#page-head-tabs').getByRole('link', { name: 'Verification & planning', exact: true }).click();
  await expect(p).toHaveURL(/\/verification$/);
  expect(errors).toEqual([]);
});

test('submission records show compact details, exact dates and honest evidence with accessible disclosures', async ({ page: p }) => {
  let captureReads = 0;
  const record = { __id: 'uuid:one', meta: { instanceName: 'sl2601 – Fonima' }, __system: {
    submissionDate: '2026-10-09T22:18:39Z', submitterId: 1, submitterName: 'Mohamed Bangura',
    reviewState: null, edits: 0, attachmentsPresent: 0, attachmentsExpected: 0,
    formVersion: '2026100901', deviceId: 'wf:device', status: null
  } };
  const errors = await api(p, [...managerVerbs, 'submission.delete'], async (route, path) => {
    if (path === '/v1/users/current') {
      await route.fulfill({ json: { id: 1, displayName: 'Mohamed Bangura', email: 'fixture@example.org',
        verbs: ['project.list', 'project.create', 'user.list'], preferences: { site: {}, projects: {} } } }); return true;
    }
    if (path.includes('.svc/Submissions(')) { await route.fulfill({ json: { value: [record] } }); return true; }
    if (path.includes('/versions/')) { await route.fulfill({ json: { userAgent: 'Very long browser metadata '.repeat(15) } }); return true; }
    if (path.endsWith('/diffs')) { await route.fulfill({ json: {} }); return true; }
    if (path.endsWith('/audits')) { await route.fulfill({ json: [{ action: 'submission.create', loggedAt: record.__system.submissionDate, actor: { id: 1, displayName: 'Mohamed Bangura' } }] }); return true; }
    if (path.endsWith('/capture-challenges')) {
      captureReads += 1;
      if (captureReads === 1) { await route.fulfill({ status: 503, json: {} }); return true; }
      await route.fulfill({ json: { items: [{ id: '11111111-1111-4111-8111-111111111111', name: 'scene.jpg', code: 'ABCDEF01', status: 'bound',
        issuedAt: '2026-10-09T22:12:00Z', expiresAt: '2026-10-09T22:32:00Z', boundAt: '2026-10-09T22:18:39Z',
        contentHash: 'b'.repeat(64), bindingCurrent: true, sceneReview: 'not-assessed' }] } }); return true;
    }
    if (path.endsWith('/claim')) { await route.fulfill({ json: { currentVersionId: 'v1', versions: [{ id: 'v1', ordinal: 1, current: true,
      provenance: { origin: 'collected', degraded: 'inferred', receivedAt: record.__system.submissionDate, integrityHash: 'a'.repeat(64) } }] } }); return true; }
    if (path.endsWith('/evidence')) { await route.fulfill({ json: { items: [{ id: 'e1', name: 'submission-xml', sourceKind: 'submission-xml', integrityStatus: 'verified', downloadUrl: '/v1/evidence-original' }] } }); return true; }
    return false;
  });
  await p.goto(`${appUrl}/projects/1/forms/household/submissions/uuid%3Aone`);
  await expect(p.locator('.fd-shell')).toBeVisible();
  await expect(p.locator('#page-head-title')).toContainText('sl2601 – Fonima');
  const details = p.locator('#submission-basic-details');
  await expect(details).toContainText('9 Oct 2026 · 22:18:39 UTC');
  await expect(details.locator('.record-technical')).not.toHaveAttribute('open');
  await expect(details.getByText('wf:device', { exact: true })).not.toBeVisible();
  const evidence = p.locator('.claim-evidence');
  await expect(evidence).toContainText('Stored bytes: verified');
  await expect(evidence).toContainText('does not verify the field claim');
  const captureHistory = p.getByRole('region', { name: 'Capture challenges', exact: true });
  await expect(captureHistory.getByRole('alert')).toContainText('could not be loaded');
  await captureHistory.getByRole('button', { name: 'Retry capture challenges' }).click();
  await expect(captureHistory).toContainText('Challenge linked; scene review required');
  await expect(captureHistory).toContainText('References the current attachment');
  await expect(captureHistory).toContainText('Code ABCDEF01');
  await captureHistory.locator('summary').click();
  await expect(captureHistory.locator('code')).toHaveText('b'.repeat(64));

  await evidence.getByText('Integrity details', { exact: true }).click();
  await expect(evidence.locator('code')).toHaveText('a'.repeat(64));
  await details.getByText('Technical details', { exact: true }).click();
  await expect(details.getByText('wf:device', { exact: true })).toBeVisible();
  for (const width of [1440, 390]) {
    await p.setViewportSize({ width, height: 1000 });
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(p.locator('#submission-activity-review-button')).toBeVisible();
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.screenshot({ path: test.info().outputPath(`record-${width}.png`), fullPage: true });
  }
  await details.getByText('Technical details', { exact: true }).click();
  await evidence.getByText('Integrity details', { exact: true }).click();
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.screenshot({ path: test.info().outputPath('record-summary-mobile.png'), fullPage: true });
  await p.locator('#submission-activity .record-more summary').click();
  await expect(p.locator('#submission-activity-delete-button')).toBeVisible();
  expect(errors).toEqual([]);
});

test('map inspector exposes the record summary, recorded timing and permission-gated actions on desktop and mobile', async ({ page: p }) => {
  const record = { __id: 'uuid:one', meta: { instanceName: 'sl2601 – Fonima' },
    start: '2026-10-09T22:12:12Z', end: '2026-10-09T22:18:38Z', location: 'POINT (-13.23 8.49)',
    __system: { submissionDate: '2026-10-09T22:18:39Z', submitterId: 1, submitterName: 'Mohamed Bangura',
      reviewState: null, edits: 0, attachmentsPresent: 0, attachmentsExpected: 0, status: null } };
  const errors = await api(p, [...managerVerbs, 'submission.delete'], async (route, path) => {
    if (path.endsWith('/fields')) { await route.fulfill({ json: [
      { name: 'start', path: '/start', type: 'dateTime' }, { name: 'end', path: '/end', type: 'dateTime' },
      { name: 'location', path: '/location', type: 'geopoint' }
    ] }); return true; }
    if (path.endsWith('/submissions.geojson')) { await route.fulfill({ json: { type: 'FeatureCollection', features: [{
      type: 'Feature', id: 'uuid:one', properties: { fieldpath: '/location' }, geometry: { type: 'Point', coordinates: [-13.23, 8.49] }
    }] } }); return true; }
    if (path.includes('.svc/Submissions')) { await route.fulfill({ json: { '@odata.count': new URL(route.request().url()).searchParams.get('$filter')?.includes('deletedAt') ? 0 : 1, value: [record] } }); return true; }
    return false;
  });
  await p.goto(`${appUrl}/projects/1/forms/household/submissions?map=true`);
  await expect(p.locator('#map-view .ol-viewport')).toBeVisible();
  await expect(p.locator('#map-view > .loading')).toBeHidden();
  const viewport = p.locator('#map-view .ol-viewport');
  const box = await viewport.boundingBox();
  await viewport.click({ position: { x: box.width / 2, y: box.height / 2 } });
  const inspector = p.getByRole('region', { name: 'Submission record' });
  await expect(inspector).toBeVisible();
  await expect(inspector).toContainText('Mohamed Bangura');
  await expect(inspector).toContainText('Recorded duration');
  await expect(inspector).toContainText('6 min 26 sec');
  await expect(inspector.locator('.record-answers')).not.toHaveAttribute('open');
  await p.screenshot({ path: test.info().outputPath('map-inspector-desktop.png') });
  await expect(inspector.getByRole('link', { name: 'View full record' })).toHaveAttribute('href', /submissions\/uuid%3Aone$/);
  await expect(inspector.getByRole('button', { name: 'Delete', exact: true })).not.toBeVisible();
  await inspector.locator('.record-more summary').click();
  await expect(inspector.getByRole('button', { name: 'Delete', exact: true })).toBeVisible();
  await inspector.locator('.record-more summary').click();
  await p.setViewportSize({ width: 390, height: 900 });
  await expect(inspector).toBeVisible();
  expect(await inspector.evaluate(el => getComputedStyle(el).bottom)).toBe('0px');
  await p.screenshot({ path: test.info().outputPath('map-inspector-mobile.png') });
  expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await inspector.getByRole('button', { name: 'Close', exact: true }).focus();
  await p.keyboard.press('Escape');
  await expect(inspector).toBeHidden();
  expect(errors).toEqual([]);
});

test('planning panels keep their identity and retry failed requests independently', async ({ page: p }) => {
  const calls = { samples: 0, allocation: 0, calendars: 0 };
  const errors = await api(p, managerVerbs, async (route, path) => {
    const kind = path === samplesPath ? 'samples' : path.endsWith('/backcheck-allocation') ? 'allocation' : path.endsWith('/backcheck-calendars') ? 'calendars' : null;
    if (kind == null) return false;
    calls[kind] += 1;
    if (calls[kind] === 1) { await route.fulfill({ status: 503, json: { message: 'Temporarily unavailable' } }); return true; }
    await route.fulfill({ json: kind === 'allocation' ? { policy: null, forms: [], collectors: [] } : [] }); return true;
  });
  await p.goto(`${appUrl}${page}`);
  for (const [selector, text] of [['.backcheck-sample', 'Sampling could not be loaded.'], ['.backcheck-allocation', 'Assignment policy could not be loaded.'], ['.backcheck-planning', 'Availability could not be loaded.']]) {
    const section = p.locator(selector);
    const alert = section.getByRole('alert').filter({ hasText: text });
    await expect(alert).toBeVisible();
    await alert.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(alert).toHaveCount(0);
  }
  expect(calls).toEqual({ samples: 2, allocation: 2, calendars: 2 });
  expect(errors).toEqual([]);
});

test('projects can be searched without hiding verification entry points or breaking mobile cards', async ({ page: p }) => {
  const verbs = [...managerVerbs];
  const makeForm = (projectId, xmlFormId, name) => ({ projectId, xmlFormId, name, state: 'open', publishedAt: '2026-10-01T00:00:00Z', submissions: 3,
    reviewStates: { received: 1, hasIssues: 1, edited: 1 }, lastSubmission: '2026-10-09T22:18:39Z', publicLinks: 0, enketoId: null });
  const projects = [{ id: 1, name: 'Housing Survey 2026', archived: false, verbs, forms: 1, datasets: 0,
    formList: [makeForm(1, 'household', 'Housing field test')], datasetList: [] },
  { id: 2, name: 'Water availability', archived: false, verbs, forms: 1, datasets: 0,
    formList: [makeForm(2, 'water', 'Water field test')], datasetList: [] }];
  const errors = await api(p, verbs, async (route, path) => {
    if (path === '/v1/projects') { await route.fulfill({ json: projects }); return true; }
    if (path === '/v1/users/current') { await route.fulfill({ json: { id: 1, displayName: 'Fixture', email: 'fixture@example.org', verbs: ['project.list', 'project.create'], preferences: { site: { whatsNewDismissed: '2026.2' }, projects: {} } } }); return true; }
    return false;
  });
  await p.goto(`${appUrl}/`);
  await expect(p.locator('.fd-project-card')).toHaveCount(2);
  await p.getByRole('searchbox', { name: 'Search active projects' }).fill('  hOuSiNg  ');
  await expect(p.locator('.fd-project-card')).toHaveCount(1);
  await expect(p.locator('#project-list')).toContainText('1 matching project');
  const verification = p.getByRole('link', { name: /Verification & planning\s*:\s*Housing field test/ });
  await expect(verification).toHaveAttribute('href', '/projects/1/forms/household/verification');
  const review = p.locator('.review-link');
  const query = new URL(await review.getAttribute('href'), appUrl).searchParams;
  expect(query.getAll('reviewState')).toEqual(['null', "'hasIssues'", "'edited'"]);
  for (const width of [1440, 320]) {
    await p.setViewportSize({ width, height: 900 });
    await expect(verification).toBeVisible();
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await p.screenshot({ path: test.info().outputPath(`projects-${width}.png`), fullPage: true });
  }
  await p.getByRole('searchbox', { name: 'Search active projects' }).fill('missing project');
  await expect(p.locator('#project-list')).toContainText('No active projects match your search.');
  await p.getByRole('button', { name: 'Clear search' }).click();
  await expect(p.locator('.fd-project-card')).toHaveCount(2);
  await verification.click();
  await expect(p.locator('#page-head-tabs').getByRole('link', { name: 'Verification & planning', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('a manager saves UTC shift windows and previews using persistent visit-time assumptions', async ({ page: p }) => {
  const weekly = Array.from({ length: 7 }, () => ({ start: '08:00', end: '09:30' }));
  let settings = { weeklyCapacity: [2, 2, 2, 2, 2, 2, 2], weeklyShifts: weekly, visitMinutes: 45, exceptions: [] };
  const saves = []; const queries = [];
  const errors = await api(p, managerVerbs, async (route, path) => {
    if (path.endsWith('/backcheck-calendars')) { await route.fulfill({ json: [{ id: 5, name: 'Checker', settings }] }); return true; }
    if (path.endsWith('/backcheck-calendars/5')) {
      settings = route.request().postDataJSON(); saves.push(settings);
      await route.fulfill({ json: { id: 5, settings } }); return true;
    }
    if (path.endsWith('/backcheck-route')) {
      queries.push(Object.fromEntries(new URL(route.request().url()).searchParams));
      await route.fulfill({ json: { actor: { id: 5, name: 'Checker' }, date: '2026-10-15', capacity: 2, used: 1, unplanned: 0,
        excluded: {}, uncertainLocations: 0, truncated: false, needsReview: false, start: { latitude: 8.48, longitude: -13.23 },
        route: { stops: [], distanceKm: 0, returnKm: 0 }, road: { status: 'ok', distanceKm: 0, travelMinutes: 0, legs: [], maxSnapMeters: 0 },
        timing: { visitMinutes: 45, dayMinutes: 90, totalMinutes: 0, shift: { start: '08:00', end: '09:30' }, overBudget: false } } }); return true;
    }
    return false;
  });
  await p.goto(`${appUrl}${page}`);
  const section = p.locator('.backcheck-planning');
  await section.getByLabel('Planning collector').selectOption('5');
  await expect(section.getByLabel('Use saved UTC shift windows', { exact: true })).toBeChecked();
  await expect(section.getByLabel('Expected minutes per visit')).toHaveValue('45');
  await section.getByLabel('Wednesday shift end', { exact: true }).fill('07:00');
  await section.getByRole('button', { name: 'Save calendar', exact: true }).click();
  await expect(section.getByRole('alert')).toContainText('must end after it starts');
  expect(saves).toHaveLength(0);
  await section.getByLabel('Wednesday shift end', { exact: true }).fill('09:30');
  await section.getByRole('button', { name: 'Add dated exception' }).click();
  await section.getByLabel('Exception date', { exact: true }).fill('2026-10-16');
  await section.getByLabel('Exception shift', { exact: true }).selectOption('closed');
  await section.getByRole('button', { name: 'Save calendar', exact: true }).click();
  await expect(section).toContainText('Calendar saved.');
  expect(saves[0]).toEqual({ weeklyCapacity: [2, 2, 2, 2, 2, 2, 2], weeklyShifts: weekly, visitMinutes: 45,
    exceptions: [{ date: '2026-10-16', maxVisits: 0, shift: null }] });
  await section.getByLabel('Route date').fill('2026-10-15');
  await section.getByLabel('Start latitude').fill('8.48'); await section.getByLabel('Start longitude').fill('-13.23');
  await section.getByRole('button', { name: 'Preview itinerary' }).click();
  await expect(section).toContainText('Saved UTC shift: 08:00–09:30');
  expect(queries[0]).toEqual({ actorId: '5', date: '2026-10-15', startLat: '8.48', startLon: '-13.23' });
  await p.setViewportSize({ width: 390, height: 900 });
  expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});


test('road-aware preview exposes the applied order and honest provider fallback', async ({ page: p }) => {
  let attempt = 0; const queries = [];
  const errors = await api(p, managerVerbs, async (route, path) => {
    if (path.endsWith('/backcheck-calendars')) { await route.fulfill({ json: [{ id: 5, name: 'Checker', settings: null }] }); return true; }
    if (path.endsWith('/backcheck-route')) {
      attempt += 1; queries.push(Object.fromEntries(new URL(route.request().url()).searchParams));
      await route.fulfill({ json: { actor: { id: 5, name: 'Checker' }, date: '2026-10-15', capacity: 2, used: 1, unplanned: 0,
        excluded: {}, uncertainLocations: 0, truncated: false, needsReview: attempt > 1,
        route: { stops: [], distanceKm: 0, returnKm: 0 },
        ordering: { requested: 'road', applied: attempt === 1 ? 'road' : 'straight', status: attempt === 1 ? 'ok' : 'unavailable' },
        road: attempt === 1 ? { status: 'ok', distanceKm: 0, travelMinutes: 0, legs: [], maxSnapMeters: 0 } : { status: 'unavailable' },
        timing: { visitMinutes: 30, dayMinutes: 480, totalMinutes: attempt === 1 ? 0 : null } } }); return true;
    }
    return false;
  });
  await p.goto(`${appUrl}${page}`);
  const section = p.locator('.backcheck-planning');
  await section.getByLabel('Planning collector').selectOption('5');
  await section.getByLabel('Stop order', { exact: true }).selectOption('road');
  await section.getByLabel('Start latitude').fill('8.48'); await section.getByLabel('Start longitude').fill('-13.23');
  await section.getByRole('button', { name: 'Preview itinerary' }).click();
  await expect(section).toContainText('Road-aware order suggested by the approved routing service');
  expect(queries[0].order).toBe('road');
  await section.getByRole('button', { name: 'Preview itinerary' }).click();
  await expect(section).toContainText('Road-aware ordering unavailable (unavailable)');
  await expect(section).toContainText('driving time remains unknown');
  await p.setViewportSize({ width: 390, height: 900 });
  expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});


test('a manager explicitly approves a preview with instructions and retains its original query', async ({ page: p }) => {
  const approvals = []; const errors = await api(p, managerVerbs, async (route, path) => {
    if (path.endsWith('/backcheck-calendars')) { await route.fulfill({ json: [{ id: 5, name: 'Checker', settings: null }] }); return true; }
    if (path.endsWith('/backcheck-itineraries')) { approvals.push(route.request().postDataJSON()); await route.fulfill({ status: 201, json: { id: 'approved' } }); return true; }
    if (path.endsWith('/backcheck-route')) {
      await route.fulfill({ json: { actor: { id: 5, name: 'Checker' }, date: '2026-10-15', reviewToken: 'a'.repeat(64), capacity: 2, used: 1, unplanned: 0,
        excluded: {}, uncertainLocations: 0, truncated: false, needsReview: true,
        route: { stops: [{ id: 'task1', order: 1, instanceId: 'visit1', location: { latitude: 8.49, longitude: -13.22, accuracy: 15 }, legKm: 2 }], distanceKm: 4, returnKm: 2 },
        road: { status: 'disabled' }, timing: { visitMinutes: 30, dayMinutes: 480, totalMinutes: null } } }); return true;
    }
    return false;
  });
  await p.goto(`${appUrl}${page}`); const section = p.locator('.backcheck-planning');
  await section.getByLabel('Planning collector').selectOption('5');
  await section.getByLabel('Route date').fill('2026-10-15');
  await section.getByLabel('Start latitude').fill('8.48'); await section.getByLabel('Start longitude').fill('-13.23');
  await section.getByRole('button', { name: 'Preview itinerary' }).click();
  await expect(section.getByRole('heading', { name: 'Approve itinerary for collector' })).toBeVisible();
  await section.getByLabel('Dispatch instructions').fill('Confirm access with the supervisor.');
  await section.getByRole('button', { name: 'Approve and send itinerary' }).click(); expect(approvals).toHaveLength(0);
  await section.getByLabel('I reviewed the warnings', { exact: false }).check();
  await section.getByLabel('Start latitude').fill('9');
  await section.getByRole('button', { name: 'Approve and send itinerary' }).click();
  await expect(section).toContainText('Approved itinerary sent to the collector');
  expect(approvals[0].query.startLat).toBe('8.48'); expect(approvals[0].reviewToken).toBe('a'.repeat(64));
  expect(approvals[0].note).toBe('Confirm access with the supervisor.');
  await expect(section.getByRole('button', { name: 'Approve and send itinerary' })).toBeDisabled();
  expect(errors).toEqual([]);
});

const captureAssessmentRecord = { __id: 'uuid:one', meta: { instanceName: 'Challenged scene' }, __system: {
  submissionDate: '2026-10-09T22:18:39Z', submitterId: 5, submitterName: 'Collector', reviewState: null, edits: 0,
  attachmentsPresent: 1, attachmentsExpected: 1, formVersion: 'v1', deviceId: null, status: null } };
const reviewCapture = { id: sampleId, name: 'scene.jpg', code: 'ABCDEF01', status: 'bound', issuedAt: '2026-10-09T22:12:00Z',
  expiresAt: '2026-10-09T22:32:00Z', boundAt: '2026-10-09T22:18:39Z', contentHash: 'b'.repeat(64), bindingCurrent: true, sceneReview: 'not-assessed', revision: 0,
  canAssess: true, assessments: { items: [], omitted: 0, nextBefore: null } };
const assessmentEntry = (sequence, body = {}) => ({ id: `11111111-1111-4111-8111-${String(sequence).padStart(12, '0')}`, sequence, reviewerId: 1,
  reviewerName: 'Reviewer', reviewedAt: '2026-10-14T11:00:00Z', codeAssessment: 'visible', sceneAssessment: 'supports', note: 'Paper and subject are clear.',
  reviewedOriginal: true, contentHash: 'b'.repeat(64), ...body });
const setupAssessmentRecord = async (p, custom, verbs = managerVerbs) => {
  const errors = await api(p, verbs, async (route, path) => {
    if (await custom(route, path)) return true;
    if (path.includes('.svc/Submissions(')) { await route.fulfill({ json: { value: [captureAssessmentRecord] } }); return true; }
    if (path.includes('/versions/')) { await route.fulfill({ json: { userAgent: 'Fixture' } }); return true; }
    if (path.endsWith('/diffs')) { await route.fulfill({ json: {} }); return true; }
    if (path.endsWith('/audits')) { await route.fulfill({ json: [] }); return true; }
    if (path.endsWith('/claim')) { await route.fulfill({ json: { currentVersionId: null, versions: [] } }); return true; }
    return false;
  });
  await p.goto(`${appUrl}/projects/1/forms/household/submissions/uuid%3Aone`);
  return errors;
};

test('a reviewer assesses the original image and safely retries a lost acknowledgement', async ({ page: p }) => {
  let saved = null; const posts = []; let lost = false;
  const errors = await setupAssessmentRecord(p, async (route, path) => {
    if (path.endsWith('/capture-challenges')) { await route.fulfill({ json: { items: [{ ...reviewCapture, sceneReview: saved ? 'assessed' : 'not-assessed', revision: saved ? 1 : 0,
      assessments: { items: saved ? [saved] : [], omitted: 0, nextBefore: null } }] } }); return true; }
    if (path.endsWith('/assessments') && route.request().method() === 'POST') {
      const body = route.request().postDataJSON(); posts.push(body);
      expect(route.request().headers()['if-match']).toBe('"capture-0"');
      saved ??= assessmentEntry(1, body);
      if (!lost) { lost = true; await route.abort('failed'); return true; }
      await route.fulfill({ json: { assessment: saved, revision: 1, bindingCurrent: true, replayed: true } }); return true;
    }
    return false;
  });
  const panel = p.getByRole('region', { name: 'Capture challenges', exact: true });
  await expect(panel.getByRole('link', { name: 'Download originally challenged image' })).toHaveAttribute('href', /capture-challenges\/11111111-1111-4111-8111-111111111111\/image$/);
  await panel.getByLabel('Code visibility').selectOption('visible');
  await panel.getByLabel('Scene supports the claim').selectOption('supports');
  await panel.getByLabel('Assessment notes').fill('Paper and subject are clear.');
  await expect(panel.getByRole('button', { name: 'Save photo assessment' })).toBeDisabled();
  await panel.getByLabel('I reviewed the originally challenged image for this code and scene.').check();
  await panel.getByRole('button', { name: 'Save photo assessment' }).click();
  await expect(panel.getByRole('alert')).toContainText('Retry the same decision');
  await panel.getByRole('button', { name: 'Save photo assessment' }).click();
  await expect(panel).toContainText('Photo assessment saved.');
  await expect(panel).toContainText('Human assessment recorded');
  await expect(panel).toContainText('Code: Visible · Scene: Supports the claim');
  expect(posts).toHaveLength(2); expect(posts[0].requestId).toBe(posts[1].requestId); expect(posts[0].reviewedOriginal).toBe(true);
  await expect(panel.getByLabel('Code visibility')).toHaveValue('');
  await p.setViewportSize({ width: 320, height: 700 });
  expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('replacement refresh removes assessment controls and preserves decisions as outdated history', async ({ page: p }) => {
  let changed = false; let posts = 0;
  await setupAssessmentRecord(p, async (route, path) => {
    if (path.endsWith('/capture-challenges')) { await route.fulfill({ json: { items: [{ ...reviewCapture, revision: 1, sceneReview: changed ? 'outdated' : 'assessed',
      canAssess: !changed, bindingCurrent: !changed, assessments: { items: [assessmentEntry(1)], omitted: 0, nextBefore: null } }] } }); return true; }
    if (path.endsWith('/assessments') && route.request().method() === 'POST') { posts += 1; changed = true; await route.fulfill({ status: 409, json: {} }); return true; }
    return false;
  });
  const panel = p.getByRole('region', { name: 'Capture challenges', exact: true });
  await panel.getByLabel('Code visibility').selectOption('unclear');
  await panel.getByLabel('Scene supports the claim').selectOption('unclear');
  await panel.getByLabel('Assessment notes').fill('The image was replaced while reviewing.');
  await panel.getByLabel('I reviewed the originally challenged image for this code and scene.').check();
  await panel.getByRole('button', { name: 'Save photo assessment' }).click();
  await expect(panel).toContainText('Assessment outdated');
  await expect(panel).toContainText('Paper and subject are clear.');
  await expect(panel.getByRole('button', { name: 'Save photo assessment' })).toHaveCount(0);
  expect(posts).toBe(1);
});

test('a viewer reads and pages assessment history without decision controls', async ({ page: p }) => {
  await setupAssessmentRecord(p, async (route, path) => {
    if (path.endsWith('/capture-challenges')) { await route.fulfill({ json: { items: [{ ...reviewCapture, revision: 12, canAssess: false, sceneReview: 'assessed',
      assessments: { items: Array.from({ length: 10 }, (_, index) => assessmentEntry(12 - index)), omitted: 2, nextBefore: 3 } }] } }); return true; }
    if (path.endsWith('/assessments')) { await route.fulfill({ json: { items: [assessmentEntry(2), assessmentEntry(1)], omitted: 0, nextBefore: null, bindingCurrent: true, revision: 12 } }); return true; }
    return false;
  }, viewerVerbs);
  const panel = p.getByRole('region', { name: 'Capture challenges', exact: true });
  await expect(panel.getByLabel('Code visibility')).toHaveCount(0);
  await expect(panel.locator('.assessment-history > li')).toHaveCount(10);
  await panel.getByRole('button', { name: 'Load earlier assessments' }).click();
  await expect(panel.locator('.assessment-history > li')).toHaveCount(12);
  await expect(panel.getByRole('button', { name: 'Load earlier assessments' })).toHaveCount(0);
});
