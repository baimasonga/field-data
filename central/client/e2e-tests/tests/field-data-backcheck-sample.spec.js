/* global localStorage, document, window, getComputedStyle */
// O3 random backcheck sample in the browser: docs/field-intelligence/O3-backcheck-sample.md
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash, createPublicKey, generateKeyPairSync, randomUUID, sign, verify } from 'node:crypto';

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

test('a manager groups by an area answer with retry, escaped coverage and mobile controls', async ({ page: p }) => {
  const posts = []; let saved = false; let fieldFailures = 1;
  const grouped = { ...detail, settings: { ...detail.settings, groupField: '/district' },
    groups: [{ value: '<img src=x onerror=alert(1)>', eligible: 6, sampled: 3, requested: 1, linked: 1 },
      { value: null, eligible: 3, sampled: 2, requested: 0, linked: 0 }],
    items: detail.items.map(i => ({ ...i, groupValue: i.submitterId === 5 ? '<img src=x onerror=alert(1)>' : null })) };
  const errors = await api(p, managerVerbs, async (route, path) => {
    if (path.endsWith('/backcheck-samples/fields')) {
      if (fieldFailures-- > 0) await route.fulfill({ status: 503, json: {} });
      else await route.fulfill({ json: { fields: [{ path: '/district', type: 'string' }] } });
      return true;
    }
    if (path === samplesPath && route.request().method() === 'POST') {
      posts.push(route.request().postDataJSON());
      if (posts.length === 1) await route.fulfill({ status: 503, json: { message: 'Retry this draw.' } });
      else { saved = true; await route.fulfill({ status: 201, json: grouped }); }
      return true;
    }
    if (path === samplesPath) { await route.fulfill({ json: saved ? [grouped] : [] }); return true; }
    if (path === `${samplesPath}/${sampleId}`) { await route.fulfill({ json: grouped }); return true; }
    return false;
  });
  await p.goto(`${appUrl}${page}`); const section = p.locator('.backcheck-sample');
  await section.getByRole('combobox', { name: 'Group submissions', exact: true }).selectOption('field');
  await expect(section.getByText('Grouping questions could not be loaded.', { exact: false })).toBeVisible();
  await section.getByText('Grouping questions could not be loaded.', { exact: false }).getByRole('button', { name: 'Retry' }).click();
  await section.getByRole('combobox', { name: 'Area or answer question', exact: true }).selectOption('/district');
  await section.getByRole('button', { name: 'Draw sample', exact: true }).click();
  await expect(section.getByRole('alert')).toContainText('Retry this draw.');
  await section.getByRole('button', { name: 'Draw sample', exact: true }).click();
  await expect(section.locator('.backcheck-group-coverage')).toContainText('Missing answer');
  await expect(section.locator('.backcheck-group-coverage')).toContainText('<img src=x onerror=alert(1)>');
  await expect(section.locator('.backcheck-group-coverage img')).toHaveCount(0);
  expect(posts[1]).toEqual(posts[0]); expect(posts[0].groupField).toBe('/district');
  await expect(section.locator('.backcheck-sample-summary')).toContainText('per collector and answer group for /district');
  await section.getByText('Chosen Submissions (5)').click();
  await expect(section.locator('.backcheck-sample-items')).toContainText('Group: Missing answer');
  await p.setViewportSize({ width: 360, height: 800 });
  expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
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

test('a manager saves scheduled answer grouping, opens its coverage, and clears it on mobile', async ({ page: p }) => {
  const puts = []; let current = saved({ rate: 10, minPerCollector: 1, frequency: 'daily', enabled: false, groupField: '/district' });
  current.runs = [{ ...current.runs[2], error: 'Grouping answers are unreadable. Schedule paused.' }];
  const grouped = { ...scheduled, settings: { ...scheduled.settings, groupField: '/district' }, groups: [{ value: 'North', eligible: 6, sampled: 3, requested: 1, linked: 1 },
    { value: null, eligible: 3, sampled: 2, requested: 0, linked: 0 }] };
  let failSave = true;
  const errors = await api(p, managerVerbs, async (route, path) => {
    if (path === `${samplesPath}/fields`) { await route.fulfill({ json: { fields: [{ path: '/district', type: 'string' }] } }); return true; }
    if (path === schedulePath && route.request().method() === 'PUT') {
      puts.push(route.request().postDataJSON());
      if (failSave) { failSave = false; await route.fulfill({ status: 503, json: { message: 'Schedule unavailable; retry.' } }); }
      else { current = saved(puts.at(-1)); await route.fulfill({ json: current }); }
      return true;
    }
    if (path === schedulePath) { await route.fulfill({ json: current }); return true; }
    if (path === samplesPath) { await route.fulfill({ json: [grouped] }); return true; }
    if (path === `${samplesPath}/${scheduled.id}`) { await route.fulfill({ json: grouped }); return true; }
    return false;
  });
  await p.goto(`${appUrl}${page}`); const panel = p.locator('.backcheck-schedule');
  await expect(panel.getByRole('combobox', { name: 'Schedule grouping', exact: true })).toHaveValue('field');
  await expect(panel.getByRole('combobox', { name: 'Scheduled area or answer question', exact: true })).toHaveValue('/district');
  await expect(panel).toContainText('Schedule paused.');
  await panel.getByLabel('On', { exact: true }).check();
  await panel.getByRole('combobox', { name: 'Every', exact: true }).selectOption('weekly');
  await panel.getByRole('button', { name: 'Save schedule', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('retry');
  await panel.getByRole('button', { name: 'Save schedule', exact: true }).click();
  expect(puts[1]).toEqual(puts[0]); expect(puts[1].groupField).toBe('/district');
  await expect(panel).toContainText('per collector and answer group');
  await panel.getByRole('button', { name: 'Show sample', exact: true }).click();
  await expect(p.locator('.backcheck-group-coverage')).toContainText('Missing answer');
  await panel.getByRole('combobox', { name: 'Schedule grouping', exact: true }).selectOption('collector');
  await panel.getByRole('button', { name: 'Save schedule', exact: true }).click();
  expect(puts.at(-1)).not.toHaveProperty('groupField');
  await expect(panel).not.toContainText('Scheduled grouping question:');
  await p.setViewportSize({ width: 360, height: 800 });
  expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('group rates survive retries, schedule reloads and mobile clearing', async ({ page: p }) => {
  const rules = [{ value: 'North', rate: 100 }, { value: null, rate: 50 }];
  const grouped = { ...detail, settings: { ...detail.settings, groupField: '/district', groupRates: rules },
    groups: [{ value: 'North', rate: 100, eligible: 6, sampled: 6, requested: 0, linked: 0 }] };
  const posts = []; const puts = [];
  let current = saved({ rate: 10, minPerCollector: 1, frequency: 'daily', enabled: true, groupField: '/district', groupRates: rules });
  const errors = await api(p, managerVerbs, async (route, path) => {
    if (path === `${samplesPath}/fields`) { await route.fulfill({ json: { fields: [{ path: '/district', type: 'string' }, { path: '/other', type: 'string' }] } }); return true; }
    if (path === schedulePath) {
      if (route.request().method() === 'PUT') { puts.push(route.request().postDataJSON()); current = saved(puts.at(-1)); }
      await route.fulfill({ json: current }); return true;
    }
    if (path === samplesPath && route.request().method() === 'POST') {
      posts.push(route.request().postDataJSON());
      await route.fulfill(posts.length === 1 ? { status: 503, json: { message: 'Retry the rates.' } } : { status: 201, json: grouped }); return true;
    }
    if (path === samplesPath) { await route.fulfill({ json: [grouped] }); return true; }
    if (path === `${samplesPath}/${sampleId}`) { await route.fulfill({ json: grouped }); return true; }
    return false;
  });
  await p.goto(`${appUrl}${page}`);
  const manual = p.locator('.backcheck-sample-form').first(); const panel = p.locator('.backcheck-schedule');
  await expect(panel.locator('.sampling-group-rate')).toHaveCount(2);
  await expect(panel.getByLabel('Group rate answer')).toHaveValue('North');
  await expect(panel.locator('.backcheck-schedule-rates')).toContainText('Missing answer: 50%');
  await expect(p.locator('.backcheck-group-coverage tbody tr').first().locator('td')).toHaveText(['100%', '6', '6', '0', '0']);
  await manual.getByRole('combobox', { name: 'Group submissions', exact: true }).selectOption('field');
  await manual.getByRole('combobox', { name: 'Area or answer question', exact: true }).selectOption('/district');
  await manual.getByRole('button', { name: 'Add group rate', exact: true }).click();
  await manual.getByLabel('Group rate answer').fill('North');
  await manual.getByRole('button', { name: 'Add group rate', exact: true }).click();
  await manual.getByRole('combobox', { name: 'Group rate target', exact: true }).nth(1).selectOption('missing');
  await manual.getByLabel('Group rate percentage').nth(1).fill('50');
  await manual.getByRole('button', { name: 'Draw sample', exact: true }).click();
  await expect(p.locator('.backcheck-sample-error').first()).toContainText('Retry the rates.');
  await manual.getByRole('button', { name: 'Draw sample', exact: true }).click();
  await expect.poll(() => posts.length).toBe(2);
  expect(posts[0].groupRates).toEqual(rules); expect(posts[1]).toEqual(posts[0]);
  await panel.getByLabel('Group rate percentage').first().fill('80');
  await panel.getByRole('button', { name: 'Save schedule', exact: true }).click();
  await expect(panel.locator('.backcheck-schedule-rates')).toContainText('North: 80%');
  await p.reload();
  await expect(panel.getByLabel('Group rate percentage').first()).toHaveValue('80');
  await p.setViewportSize({ width: 360, height: 800 });
  expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await panel.getByRole('combobox', { name: 'Scheduled area or answer question', exact: true }).selectOption('/other');
  await expect(panel.locator('.sampling-group-rate')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Save schedule', exact: true }).click();
  await expect.poll(() => puts.length).toBe(2); expect(puts.at(-1)).not.toHaveProperty('groupRates');
  expect(errors).toEqual([]);
});

test('numeric ranges support manual retries, schedule editing, coverage and mobile clearing', async ({ page: p }) => {
  const posts = []; const puts = [];
  const grouped = { ...detail, settings: { ...detail.settings, groupField: '/age', groupBreaks: ['18', '35'] },
    groups: [{ value: 'Below 18', rate: 25, eligible: 6, sampled: 2, requested: 0, linked: 0 }, { value: null, rate: 25, eligible: 3, sampled: 1, requested: 0, linked: 0 }] };
  let current = saved({ rate: 10, minPerCollector: 1, frequency: 'daily', enabled: true, groupField: '/age', groupBreaks: ['18', '35'], groupRates: [{ value: 'Below 18', rate: 100 }] });
  const errors = await api(p, managerVerbs, async (route, path) => {
    if (path === `${samplesPath}/fields`) { await route.fulfill({ json: { fields: [{ path: '/age', type: 'int' }, { path: '/district', type: 'string' }] } }); return true; }
    if (path === schedulePath) {
      if (route.request().method() === 'PUT') { puts.push(route.request().postDataJSON()); current = saved(puts.at(-1)); }
      await route.fulfill({ json: current }); return true;
    }
    if (path === samplesPath && route.request().method() === 'POST') {
      posts.push(route.request().postDataJSON());
      await route.fulfill(posts.length === 1 ? { status: 503, json: { message: 'Retry numeric draw.' } } : { status: 201, json: grouped }); return true;
    }
    if (path === samplesPath) { await route.fulfill({ json: [grouped] }); return true; }
    if (path === `${samplesPath}/${sampleId}`) { await route.fulfill({ json: grouped }); return true; }
    return false;
  });
  await p.goto(`${appUrl}${page}`);
  const manual = p.locator('.backcheck-sample-form').first(); const panel = p.locator('.backcheck-schedule');
  await expect(panel.getByLabel('Range boundary 1', { exact: true })).toHaveValue('18');
  await expect(panel.locator('.backcheck-schedule-ranges')).toContainText('18 to below 35');
  await expect(p.locator('.backcheck-sample-ranges')).toContainText('Recorded ranges: Below 18');
  await expect(p.locator('.backcheck-group-coverage tbody tr').first().locator('td')).toHaveText(['25%', '6', '2', '0', '0']);
  await manual.getByRole('combobox', { name: 'Group submissions', exact: true }).selectOption('field');
  await manual.getByRole('combobox', { name: 'Area or answer question', exact: true }).selectOption('/age');
  await manual.getByRole('combobox', { name: 'Group numeric answers', exact: true }).selectOption('ranges');
  await manual.getByLabel('Range boundary 1', { exact: true }).fill('18');
  await manual.getByRole('button', { name: 'Add boundary', exact: true }).click();
  await manual.getByLabel('Range boundary 2', { exact: true }).fill('35');
  await expect(manual.locator('.sampling-numeric-ranges')).toContainText('Ranges: Below 18; 18 to below 35; 35 or above; Missing answer.');
  await manual.getByRole('button', { name: 'Add group rate', exact: true }).click();
  await manual.getByRole('combobox', { name: 'Group rate answer', exact: true }).selectOption('35 or above');
  await manual.getByRole('button', { name: 'Draw sample', exact: true }).click();
  await expect(p.locator('.backcheck-sample-error').first()).toContainText('Retry numeric draw.');
  await manual.getByRole('button', { name: 'Draw sample', exact: true }).click();
  await expect.poll(() => posts.length).toBe(2);
  expect(posts[1]).toEqual(posts[0]); expect(posts[0].groupBreaks).toEqual(['18', '35']);
  expect(posts[0].groupRates).toEqual([{ value: '35 or above', rate: 100 }]);
  await manual.getByLabel('Range boundary 2', { exact: true }).fill('40');
  await expect(manual.locator('.sampling-group-rate')).toHaveCount(0);
  await panel.getByLabel('Range boundary 1', { exact: true }).fill('16');
  await expect(panel.locator('.sampling-group-rate')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Add group rate', exact: true }).click();
  await panel.getByRole('button', { name: 'Save schedule', exact: true }).click();
  await expect(panel.locator('.backcheck-schedule-ranges')).toContainText('Below 16');
  expect(puts[0].groupBreaks).toEqual(['16', '35']); expect(puts[0].groupRates).toEqual([{ value: 'Below 16', rate: 100 }]);
  await p.reload();
  await expect(panel.getByLabel('Range boundary 1', { exact: true })).toHaveValue('16');
  await p.setViewportSize({ width: 360, height: 800 });
  expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await panel.getByRole('combobox', { name: 'Group numeric answers', exact: true }).selectOption('exact');
  await panel.getByRole('button', { name: 'Save schedule', exact: true }).click();
  await expect.poll(() => puts.length).toBe(2); expect(puts[1]).not.toHaveProperty('groupBreaks'); expect(puts[1]).not.toHaveProperty('groupRates');
  await expect(panel.locator('.backcheck-schedule-ranges')).toHaveCount(0);
  await panel.getByRole('combobox', { name: 'Scheduled area or answer question', exact: true }).selectOption('/district');
  await expect(panel.locator('.sampling-numeric-ranges')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('polygon areas upload safely, retry manual draws, persist schedules and clear on mobile', async ({ page: p }) => {
  const area = value => ({ value, geometry: { type: 'Polygon', coordinates: [[[10, 10], [12, 10], [12, 12], [10, 12], [10, 10]]] } });
  const file = value => ({ name: 'areas.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: value }, geometry: area(value).geometry }] })) });
  const groupAreas = [area('North')]; const posts = []; const puts = [];
  const grouped = { ...detail, settings: { ...detail.settings, groupField: '/location', groupAreas },
    groups: [{ value: 'North', rate: 25, eligible: 6, sampled: 2, requested: 0, linked: 0 }, { value: 'Outside areas', rate: 25, eligible: 2, sampled: 1, requested: 0, linked: 0 }, { value: null, rate: 25, eligible: 1, sampled: 1, requested: 0, linked: 0 }] };
  let current = saved({ rate: 10, minPerCollector: 1, frequency: 'daily', enabled: true, groupField: '/location', groupAreas, groupRates: [{ value: 'North', rate: 100 }] });
  const errors = await api(p, managerVerbs, async (route, path) => {
    if (path === `${samplesPath}/fields`) { await route.fulfill({ json: { fields: [{ path: '/location', type: 'geopoint' }, { path: '/name', type: 'string' }] } }); return true; }
    if (path === schedulePath) {
      if (route.request().method() === 'PUT') { puts.push(route.request().postDataJSON()); current = saved(puts.at(-1)); }
      await route.fulfill({ json: current }); return true;
    }
    if (path === samplesPath && route.request().method() === 'POST') {
      posts.push(route.request().postDataJSON());
      await route.fulfill(posts.length === 1 ? { status: 503, json: { message: 'Retry geographic draw.' } } : { status: 201, json: grouped }); return true;
    }
    if (path === samplesPath) { await route.fulfill({ json: [grouped] }); return true; }
    if (path === `${samplesPath}/${sampleId}`) { await route.fulfill({ json: grouped }); return true; }
    return false;
  });
  await p.goto(`${appUrl}${page}`);
  const manual = p.locator('.backcheck-sample-form').first(); const panel = p.locator('.backcheck-schedule');
  await expect(panel.locator('.backcheck-schedule-areas')).toContainText('Scheduled areas: North; Outside areas; Overlapping areas; Missing answer.');
  await expect(panel.locator('.sampling-polygon-areas li')).toHaveText(['North']);
  await expect(p.locator('.backcheck-sample-areas')).toContainText('Recorded areas: North');
  await expect(p.locator('.backcheck-group-coverage')).toContainText('Outside areas');
  await manual.getByRole('combobox', { name: 'Group submissions', exact: true }).selectOption('field');
  await manual.getByRole('combobox', { name: 'Area or answer question', exact: true }).selectOption('/location');
  await manual.getByRole('button', { name: 'Draw sample', exact: true }).click();
  await expect(p.locator('.backcheck-sample-error').first()).toContainText('Upload named polygon areas');
  await manual.getByLabel('Sampling areas GeoJSON').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{') });
  await expect(manual.locator('.sampling-polygon-areas [role="alert"]')).toContainText('not valid');
  await manual.getByLabel('Sampling areas GeoJSON').setInputFiles(file('North'));
  await expect(manual.locator('.sampling-polygon-areas li')).toHaveText(['North']);
  await manual.getByRole('button', { name: 'Add group rate', exact: true }).click();
  await expect(manual.getByRole('combobox', { name: 'Group rate answer', exact: true })).toHaveValue('North');
  await manual.getByRole('button', { name: 'Draw sample', exact: true }).click();
  await expect(p.locator('.backcheck-sample-error').first()).toContainText('Retry geographic draw.');
  await manual.getByRole('button', { name: 'Draw sample', exact: true }).click();
  await expect.poll(() => posts.length).toBe(2); expect(posts[1]).toEqual(posts[0]); expect(posts[0].groupAreas).toEqual(groupAreas);
  await manual.getByLabel('Sampling areas GeoJSON').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{') });
  await expect(manual.locator('.sampling-polygon-areas li')).toHaveCount(0); await expect(manual.locator('.sampling-group-rate')).toHaveCount(0);
  await panel.getByLabel('Sampling areas GeoJSON').setInputFiles(file('South'));
  await expect(panel.locator('.sampling-group-rate')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Add group rate', exact: true }).click();
  await panel.getByRole('button', { name: 'Save schedule', exact: true }).click();
  await expect(panel.locator('.backcheck-schedule-areas')).toContainText('Scheduled areas: South');
  expect(puts[0].groupAreas).toEqual([area('South')]); expect(puts[0].groupRates).toEqual([{ value: 'South', rate: 100 }]);
  const [download] = await Promise.all([p.waitForEvent('download'), panel.getByRole('link', { name: 'Download saved areas', exact: true }).click()]);
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(exported.features).toEqual([{ type: 'Feature', properties: { name: 'South' }, geometry: area('South').geometry }]);
  const [recorded] = await Promise.all([p.waitForEvent('download'), p.getByRole('link', { name: 'Download recorded areas', exact: true }).click()]);
  expect(JSON.parse(await readFile(await recorded.path(), 'utf8')).features[0].properties.name).toBe('North');
  await p.reload();
  await expect(panel.locator('.sampling-polygon-areas li')).toHaveText(['South']);
  await p.setViewportSize({ width: 360, height: 800 });
  expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await panel.getByRole('combobox', { name: 'Schedule grouping', exact: true }).selectOption('collector');
  await panel.getByRole('button', { name: 'Save schedule', exact: true }).click();
  await expect.poll(() => puts.length).toBe(2); expect(puts[1]).not.toHaveProperty('groupAreas'); expect(puts[1]).not.toHaveProperty('groupRates');
  await expect(panel.locator('.backcheck-schedule-areas')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('readers inspect, retry and export snapshot weights without treating unavailable history as valid', async ({ page: p }) => {
  let attempts = 0;
  const weights = { sampleId, available: true, method: 'stratum-expansion-v1', scope: 'recorded-eligible-submissions', eligible: 9, sampled: 5, groupField: '/district',
    strata: [{ submitterId: 5, groupValue: 'North', eligible: 6, sampled: 3, inclusionProbability: 0.5, designWeight: 2 },
      { submitterId: 6, groupValue: null, eligible: 3, sampled: 2, inclusionProbability: 2 / 3, designWeight: 1.5 }],
    items: detail.items.map(item => ({ instanceId: item.instanceId, designWeight: item.submitterId === 5 ? 2 : 1.5 })) };
  const errors = await api(p, viewerVerbs, async (route, path) => {
    if (path === `${samplesPath}/${sampleId}/weights`) {
      attempts += 1;
      await route.fulfill(attempts === 1 ? { status: 503, json: {} } : attempts === 2 ? { json: weights } : { json: { available: false, reason: 'Recorded membership is inconsistent. Weights are unavailable.' } }); return true;
    }
    if (path === samplesPath) { await route.fulfill({ json: [summary, scheduled] }); return true; }
    if (path === `${samplesPath}/${sampleId}`) { await route.fulfill({ json: detail }); return true; }
    if (path === `${samplesPath}/${scheduled.id}`) { await route.fulfill({ json: scheduled }); return true; }
    return false;
  });
  await p.goto(`${appUrl}${page}`); const panel = p.locator('.backcheck-weights');
  await expect(panel).toContainText('do not adjust for missing backchecks'); expect(attempts).toBe(0);
  await panel.getByRole('button', { name: 'Show sampling weights', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('could not be loaded');
  await panel.getByRole('button', { name: 'Show sampling weights', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('5 selected from 9 recorded eligible');
  await expect(panel.locator('tbody tr').first().locator('td')).toHaveText(['North', '6', '3', '0.5', '2']);
  await expect(panel.locator('tbody tr').nth(1)).toContainText('Missing answer');
  const [download] = await Promise.all([p.waitForEvent('download'), panel.getByRole('link', { name: 'Download sampling weights JSON', exact: true }).click()]);
  expect(JSON.parse(await readFile(await download.path(), 'utf8'))).toEqual(weights);
  await p.setViewportSize({ width: 360, height: 800 });
  expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await panel.getByRole('button', { name: 'Refresh sampling weights', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Weights are unavailable');
  await expect(panel.getByRole('link')).toHaveCount(0); await expect(panel.locator('table')).toHaveCount(0);
  await p.locator('.backcheck-sample-pick select').selectOption(scheduled.id);
  await expect(panel.getByRole('button', { name: 'Show sampling weights', exact: true })).toBeVisible();
  await expect(panel).not.toContainText('Weights are unavailable'); expect(attempts).toBe(3);
  expect(errors).toEqual([]);
});

test('calibrated estimates require explicit outcomes and response assumptions, export diagnostics and clear stale inputs', async ({ page: p }) => {
  const posts = []; const ids = ['uuid:a1', 'uuid:a2'];
  const weights = { sampleId, available: true, groupField: null, eligible: 4, sampled: 2, strata: [{ submitterId: 5, eligible: 4, sampled: 2, inclusionProbability: 0.5, designWeight: 2 }], items: ids.map(instanceId => ({ instanceId })) };
  const errors = await api(p, viewerVerbs, async (route, path) => {
    if (path === samplesPath) { await route.fulfill({ json: [summary] }); return true; }
    if (path === `${samplesPath}/${sampleId}`) { await route.fulfill({ json: detail }); return true; }
    if (path === `${samplesPath}/${sampleId}/weights`) { await route.fulfill({ json: weights }); return true; }
    if (path === `${samplesPath}/${sampleId}/estimate`) {
      const body = route.request().postDataJSON(); posts.push(body);
      if (posts.length === 1) { await route.fulfill({ status: 503, json: { message: 'Retry the calculation.' } }); return true; }
      const reviewed = body.outcomes.filter(row => row.value !== null).length;
      if (reviewed < 2 && !body.assumeRandomResponse) { await route.fulfill({ json: { available: false, reason: 'Some selected outcomes are unknown. Explicitly acknowledge random response.', strata: [] } }); return true; }
      await route.fulfill({ json: { available: true, eligible: 4, sampled: 2, reviewed, missing: 2 - reviewed, estimatedProportion: reviewed === 1 ? 1 : 0.5, estimatedPositiveTotal: reviewed === 1 ? 4 : 2,
        responseAssumption: reviewed === 1 ? 'random-within-each-stratum' : 'not-required-all-selected-reviewed', interval: { lower: 0, upper: 1 }, input: body,
        strata: [{ submitterId: 5, eligible: 4, sampled: 2, reviewed, positive: 1, calibratedWeight: 4 / reviewed }] } }); return true;
    }
    return false;
  });
  await p.goto(`${appUrl}${page}`);
  await p.locator('.backcheck-weights').getByRole('button', { name: 'Show sampling weights', exact: true }).click();
  const panel = p.locator('.backcheck-estimate');
  const [template] = await Promise.all([p.waitForEvent('download'), panel.getByRole('link', { name: 'Download outcome template', exact: true }).click()]);
  const data = JSON.parse(await readFile(await template.path(), 'utf8'));
  expect(data).toEqual({ sampleId, definition: '', source: '', outcomes: ids.map(instanceId => ({ instanceId, value: null })) });
  const upload = value => panel.getByLabel('Reviewed outcomes JSON').setInputFiles({ name: 'outcomes.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
  await upload({ ...data, sampleId: 'other' });
  await expect(panel.getByRole('alert')).toContainText('this sample');
  await expect(panel.getByRole('button', { name: 'Calculate calibrated estimate', exact: true })).toBeDisabled();
  const partial = { ...data, definition: 'Reviewed discrepancy', source: 'Review register 2026-10-24', outcomes: [{ instanceId: ids[0], value: 1 }, { instanceId: ids[1], value: null }] };
  await upload(partial);
  const calculate = panel.getByRole('button', { name: 'Calculate calibrated estimate', exact: true });
  await calculate.click(); await expect(panel.getByRole('alert')).toContainText('Retry the calculation');
  await calculate.click(); await expect(panel.locator('.backcheck-estimate-result')).toContainText('Explicitly acknowledge random response');
  await expect(panel).not.toContainText('Estimated proportion:');
  await panel.getByRole('checkbox').check(); await expect(panel.locator('.backcheck-estimate-result')).toHaveCount(0);
  await calculate.click(); await expect(panel.locator('.backcheck-estimate-result')).toContainText('Estimated proportion: 100%');
  await expect(panel).toContainText('unverified random-response assumption');
  const [download] = await Promise.all([p.waitForEvent('download'), panel.getByRole('link', { name: 'Download estimate and diagnostics JSON', exact: true }).click()]);
  expect(JSON.parse(await readFile(await download.path(), 'utf8')).input.assumeRandomResponse).toBe(true);
  await upload({ ...partial, outcomes: [{ instanceId: ids[0], value: 1 }, { instanceId: ids[1], value: 0 }] });
  await expect(panel.getByRole('checkbox')).not.toBeChecked(); await expect(panel.locator('.backcheck-estimate-result')).toHaveCount(0);
  await calculate.click(); await expect(panel.locator('.backcheck-estimate-result')).toContainText('Estimated proportion: 50%');
  await p.setViewportSize({ width: 360, height: 800 });
  expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
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
  const plan = { scope: 'combined-visits@1', actor: { id: 5, name: 'Checker' }, date: '2026-10-14', capacity: 1, used: 2, unplanned: 1, uncertainLocations: 1,
    truncated: true, needsReview: true, excluded: { permission: 0, inactive: 0, collectorUnavailable: 0, encryptedSource: 0, sourceUnverified: 1, missingLocation: 1 },
    road: { status: 'ok', distanceKm: 3, travelMinutes: 60, maxSnapMeters: 150, legs: [{ distanceKm: 1.5, travelMinutes: 30 }, { distanceKm: 1.5, travelMinutes: 30 }] },
    timing: { totalMinutes: 90, visitMinutes: 30, dayMinutes: 60, overBudget: true },
    route: { distanceKm: 2.2, returnKm: 1.1, stops: [{ kind: 'reverification', id: 'task', instanceId: '=unsafe', order: 1, legKm: 1.1,
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
  expect(csv).toContain('Visit type'); expect(csv).toContain('Re-verification');
  await expect(section).toContainText('Backchecks and re-verification stops are included together.');
  await expect(section.getByRole('cell', { name: 'Re-verification', exact: true })).toBeVisible();
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

test('native download offers explicit value recodes with a manifest and retains stored-answer downloads on mobile', async ({ page: p }) => {
  const errors = await api(p, managerVerbs, async (route, path) => {
    if (path.endsWith('.svc/Submissions')) { await route.fulfill({ json: { '@odata.count': 1, value: [{ __id: 'uuid:one', choice: 'old', __system: { submissionDate: '2026-10-13T12:00:00Z', submitterId: 1, submitterName: 'Fixture', reviewState: null, edits: 0, attachmentsPresent: 0, attachmentsExpected: 0 } }] } }); return true; }
    if (path.endsWith('/fields')) { await route.fulfill({ json: [{ path: '/choice', name: 'choice', type: 'string', selectMultiple: true }] }); return true; }
    return false;
  });
  await p.goto(`${appUrl}/projects/1/forms/household/submissions`);
  await p.locator('#submission-download-button > button').click();
  const panel = p.locator('#submission-download-container'); const link = panel.getByRole('link', { name: 'Download recoded CSV ZIP' });
  await expect(link).toBeVisible(); await expect(panel).toContainText('field-data-recodes.json');
  await expect(panel).toContainText('moved questions and unsupported fields are listed as skipped');
  await panel.locator('input[type="checkbox"]').first().check();
  const recoded = new URL(await link.getAttribute('href'), appUrl);
  expect(recoded.pathname).toBe('/v1/projects/1/forms/household/submissions.csv.zip');
  expect(recoded.searchParams.get('valueRecodes')).toBe('true'); expect(recoded.searchParams.get('attachments')).toBe('false'); expect(recoded.searchParams.get('splitSelectMultiples')).toBe('false');
  const raw = new URL(await panel.locator('a[href*="submissions.csv?"]').first().getAttribute('href'), appUrl);
  expect(raw.searchParams.has('valueRecodes')).toBe(false); expect(raw.searchParams.get('splitSelectMultiples')).toBe('true');
  await p.setViewportSize({ width: 320, height: 800 }); expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); expect(errors).toEqual([]);
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


test('a manager explicitly saves overnight UTC shifts, recovers from overlap and previews both dates', async ({ page: p }) => {
  const saves = []; let rejectOverlap = true;
  const errors = await api(p, managerVerbs, async (route, path) => {
    if (path.endsWith('/backcheck-calendars')) {
      await route.fulfill({ json: [{ id: 5, name: 'Checker', settings: { weeklyCapacity: Array(7).fill(2), visitMinutes: 30,
        weeklyShifts: Array(7).fill({ start: '22:00', end: '23:00' }), exceptions: [] } }] }); return true;
    }
    if (path.endsWith('/backcheck-calendars/5')) {
      if (rejectOverlap) { rejectOverlap = false; await route.fulfill({ status: 400, json: {} }); return true; }
      const settings = route.request().postDataJSON(); saves.push(settings);
      await route.fulfill({ json: { id: 5, settings } }); return true;
    }
    if (path.endsWith('/backcheck-route')) {
      await route.fulfill({ json: { actor: { id: 5, name: 'Checker' }, date: '2026-10-14', capacity: 2, used: 0, unplanned: 0,
        excluded: {}, uncertainLocations: 0, truncated: false, needsReview: false, start: { latitude: 8.48, longitude: -13.23 },
        route: { stops: [], distanceKm: 0, returnKm: 0 }, road: { status: 'ok', distanceKm: 0, travelMinutes: 0, legs: [] },
        timing: { visitMinutes: 30, dayMinutes: 300, totalMinutes: 0, overBudget: false,
          shift: { start: '22:00', end: '06:00', endNextDay: true, startAt: '2026-10-14T22:00:00.000Z', endAt: '2026-10-15T06:00:00.000Z' } } } }); return true;
    }
    return false;
  });
  await p.goto(`${appUrl}${page}`); const section = p.locator('.backcheck-planning');
  await section.getByLabel('Planning collector').selectOption('5');
  await section.getByLabel('Wednesday shift end', { exact: true }).fill('06:00');
  await section.getByRole('button', { name: 'Save calendar', exact: true }).click();
  await expect(section.getByRole('alert')).toContainText('select end next day'); expect(saves).toHaveLength(0);
  await section.getByLabel('Wednesday end next day', { exact: true }).check();
  await section.getByRole('button', { name: 'Add dated exception' }).click();
  await section.getByLabel('Exception date', { exact: true }).fill('2026-10-16');
  await section.getByLabel('Exception visits', { exact: true }).fill('1');
  await section.getByLabel('Exception shift', { exact: true }).selectOption('custom');
  await section.getByLabel('Exception shift start', { exact: true }).fill('23:00');
  await section.getByLabel('Exception shift end', { exact: true }).fill('05:00');
  await section.getByLabel('Exception end next day', { exact: true }).check();
  await section.getByRole('button', { name: 'Save calendar', exact: true }).click();
  await expect(section.getByRole('alert')).toContainText('Check adjacent UTC shifts for overlap');
  await section.getByRole('button', { name: 'Save calendar', exact: true }).click();
  await expect(section).toContainText('Calendar saved.');
  expect(saves[0].weeklyShifts[3]).toEqual({ start: '22:00', end: '06:00', endNextDay: true });
  expect(saves[0].exceptions).toEqual([{ date: '2026-10-16', maxVisits: 1, shift: { start: '23:00', end: '05:00', endNextDay: true } }]);
  expect(saves[0].weeklyShifts[4]).toEqual({ start: '22:00', end: '23:00' });
  await section.getByLabel('Route date').fill('2026-10-14');
  await section.getByLabel('Start latitude').fill('8.48'); await section.getByLabel('Start longitude').fill('-13.23');
  await section.getByRole('button', { name: 'Preview itinerary' }).click();
  await expect(section).toContainText('Saved UTC shift: 22:00–06:00 next day');
  await expect(section).toContainText('UTC window: 2026-10-14T22:00:00.000Z to 2026-10-15T06:00:00.000Z');
  const downloaded = p.waitForEvent('download');
  await section.getByRole('button', { name: 'Download itinerary CSV' }).click();
  const csv = await readFile(await (await downloaded).path(), 'utf8');
  expect(csv).toContain('UTC shift starts at'); expect(csv).toContain('2026-10-15T06:00:00.000Z');
  expect(csv).toContain('Ends next UTC day');
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
    if (path.endsWith('/witnesses')) { await route.fulfill({ json: { items: [], bindingCurrent: true, canWitness: false, context: null } }); return true; }
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

const clearKeyTrust = record => ({ ...record, keyTrust: { status: 'clear', checkedAt: new Date().toISOString(), canRevoke: false, signingAvailable: true,
  keys: [...new Set([record, ...(record.events ?? [])].map(row => createHash('sha256').update(createPublicKey({ key: row.publicKey, format: 'jwk' }).export({ type: 'spki', format: 'der' })).digest('hex')))].map(keyHash => ({ keyHash, revocation: null })) } });
const witnessContext = { purpose: 'field-data.capture-witness@1', challengeId: sampleId, projectId: 1, submissionDefId: 7,
  xmlFormId: 'household', instanceId: 'uuid:one', name: 'scene.jpg', code: 'ABCDEF01', contentHash: 'b'.repeat(64), witnessId: 1 };
test('a witness signs exact image bytes, retries an interrupted submission, and exports a verifiable statement on mobile', async ({ page: p }) => {
  const posts = []; let stored = null;
  const errors = await setupAssessmentRecord(p, async (route, path) => {
    if (path.endsWith('/capture-challenges')) { await route.fulfill({ json: { items: [reviewCapture] } }); return true; }
    if (!path.endsWith('/witnesses')) return false;
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { items: stored ? [clearKeyTrust(stored)] : [], bindingCurrent: true, canWitness: !stored, context: stored ? null : witnessContext } }); return true;
    }
    const body = route.request().postDataJSON(); posts.push(body);
    expect(verify('sha256', Buffer.from(body.payload, 'base64url'), { key: createPublicKey({ key: body.publicKey, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(body.signature, 'base64url'))).toBe(true);
    expect(JSON.parse(Buffer.from(body.payload, 'base64url').toString()).contentHash).toBe(reviewCapture.contentHash);
    stored ??= { id: sampleId, witnessId: 1, witnessName: 'Witness', receivedAt: new Date().toISOString(), algorithm: 'ES256', payload: body.payload, publicKey: body.publicKey, signature: body.signature };
    if (posts.length === 1) await route.abort('failed'); else await route.fulfill({ json: { witness: stored, bindingCurrent: true, replayed: true } });
    return true;
  });
  const section = p.getByRole('region', { name: 'Signed witness statements' });
  await section.getByLabel('Describe what you personally observed').fill('I observed the pump and matching paper code.');
  await expect(section.getByRole('button', { name: 'Sign and submit witness statement' })).toBeDisabled();
  await section.getByLabel('I reviewed the original challenged image and am signing my own statement for this photo.').check();
  await section.getByRole('button', { name: 'Sign and submit witness statement' }).click();
  await expect(section.getByRole('alert')).toContainText('Retry the same statement');
  await section.getByRole('button', { name: 'Sign and submit witness statement' }).click();
  await expect(section).toContainText('Signature verified'); expect(posts).toHaveLength(2); expect(posts[1]).toEqual(posts[0]);
  await expect(section.getByRole('button', { name: 'Sign and submit witness statement' })).toHaveCount(0);
  const [download] = await Promise.all([p.waitForEvent('download'), section.getByRole('button', { name: 'Download signed statement' }).click()]);
  const exported = JSON.parse(await readFile(await download.path(), 'utf8')); expect(exported.payload).toBe(stored.payload); expect(exported.signature).toBe(stored.signature);
  await p.setViewportSize({ width: 320, height: 700 });
  expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); expect(errors).toEqual([]);
});

test('a viewer cannot sign and tampered witness signatures are not displayed as verified', async ({ page: p }) => {
  await setupAssessmentRecord(p, async (route, path) => {
    if (path.endsWith('/capture-challenges')) { await route.fulfill({ json: { items: [{ ...reviewCapture, canAssess: false }] } }); return true; }
    if (path.endsWith('/witnesses')) { await route.fulfill({ json: { items: [{ algorithm: 'ES256', payload: 'tampered', signature: 'a'.repeat(86), publicKey: { kty: 'EC', crv: 'P-256' } }], bindingCurrent: false, canWitness: false, context: null } }); return true; }
    return false;
  }, viewerVerbs);
  const section = p.getByRole('region', { name: 'Signed witness statements' });
  await expect(section.getByRole('alert')).toContainText('could not be loaded or verified');
  await expect(section).not.toContainText('Signature verified'); await expect(section.getByRole('button', { name: 'Sign and submit witness statement' })).toHaveCount(0);
});

test('reviewers see device-reported location limits and historical context after replacement', async ({ page: p }) => {
  await setupAssessmentRecord(p, async (route, path) => {
    if (path.endsWith('/capture-challenges')) { await route.fulfill({ json: { items: [{ ...reviewCapture, bindingCurrent: false, canAssess: false,
      captureLocation: { source: 'browser-geolocation', latitude: 8.48, longitude: -13.23, accuracy: 15, sampledAt: '2026-10-14T11:00:00.000Z', capturedAt: '2026-10-14T11:00:05.000Z' } }] } }); return true; }
    return false;
  }, viewerVerbs);
  const panel = p.getByRole('region', { name: 'Capture challenges', exact: true });
  await expect(panel).toContainText('Device-reported location'); await expect(panel).toContainText('8.480000, -13.230000');
  await expect(panel).toContainText('Reported accuracy ±15 m'); await expect(panel).toContainText('Historical reading');
  await expect(panel).toContainText('This does not establish presence');
  await p.setViewportSize({ width: 320, height: 700 }); expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});


const witnessHash = record => createHash('sha256').update(Buffer.from(record.payload, 'base64url')).digest('hex');
const witnessChangeContext = record => ({ ...witnessContext, purpose: 'field-data.capture-witness-change@1', witnessRecordId: record.id,
  originalPayloadHash: witnessHash(record), sequence: record.events.length + 1, previousPayloadHash: witnessHash(record.events.at(-1) ?? record) });
const signedWitnessFixture = data => {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  return { algorithm: 'ES256', payload, publicKey: publicKey.export({ format: 'jwk' }),
    signature: sign('sha256', Buffer.from(payload, 'base64url'), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url') };
};
test('a witness corrects and withdraws through signed retryable history while the original remains verifiable', async ({ page: p }) => {
  let stored = null; let bindingCurrent = true; const changes = [];
  const errors = await setupAssessmentRecord(p, async (route, path) => {
    if (path.endsWith('/capture-challenges')) { await route.fulfill({ json: { items: [reviewCapture] } }); return true; }
    if (path.endsWith('/witnesses')) {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: { items: stored ? [{ ...clearKeyTrust(stored), canCorrect: true,
          changeContext: stored.status === 'active' ? witnessChangeContext(stored) : null }] : [],
        bindingCurrent, canWitness: !stored, context: stored ? null : witnessContext } });
      } else {
        const body = route.request().postDataJSON();
        stored = { id: sampleId, witnessId: 1, witnessName: 'Witness', receivedAt: new Date().toISOString(), algorithm: 'ES256',
          payload: body.payload, publicKey: body.publicKey, signature: body.signature, events: [], status: 'active', revision: 0 };
        await route.fulfill({ json: { witness: stored, bindingCurrent: true } });
      }
      return true;
    }
    if (path.endsWith(`/witnesses/${sampleId}/events`)) {
      const body = route.request().postDataJSON(); changes.push(body);
      expect(verify('sha256', Buffer.from(body.payload, 'base64url'), { key: createPublicKey({ key: body.publicKey, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(body.signature, 'base64url'))).toBe(true);
      const data = JSON.parse(Buffer.from(body.payload, 'base64url').toString());
      if (!stored.events.some(event => JSON.parse(Buffer.from(event.payload, 'base64url').toString()).requestId === body.requestId)) {
        stored.events.push({ id: randomUUID(), actorId: 1, actorName: 'Witness', sequence: data.sequence, action: body.action,
          receivedAt: new Date().toISOString(), algorithm: 'ES256', payload: body.payload, publicKey: body.publicKey, signature: body.signature });
        stored.status = body.action === 'withdraw' ? 'withdrawn' : 'active'; stored.revision = stored.events.length;
      }
      if (changes.length === 1) await route.abort('failed'); else await route.fulfill({ json: { witness: stored, bindingCurrent, replayed: changes.length === 2 } });
      return true;
    }
    return false;
  });
  const section = p.getByRole('region', { name: 'Signed witness statements' });
  const originalText = 'I personally observed the pump and paper code.';
  await section.getByLabel('Describe what you personally observed').fill(originalText);
  await section.getByLabel('I reviewed the original challenged image and am signing my own statement for this photo.').check();
  await section.getByRole('button', { name: 'Sign and submit witness statement' }).click();
  await expect(section).toContainText('1 active statements for the current image');
  const originalPayload = stored.payload;
  await section.getByRole('button', { name: 'Correct or withdraw your statement' }).click();
  await section.getByLabel('Corrected statement').fill('I could confirm the paper code but not the pump operation.');
  const reason = 'I need to clarify the limitations of the observation.';
  await section.getByLabel('Reason for this change').fill(reason);
  await section.getByLabel('I am signing this change to my own witness statement.').check();
  await section.getByRole('button', { name: 'Sign and submit correction' }).click();
  await expect(section.getByRole('alert')).toContainText('Retry the same change');
  await section.getByLabel('Reason for this change').fill('Trying to change the interrupted signed request.');
  await section.getByRole('button', { name: 'Sign and submit correction' }).click();
  await expect(section.getByRole('alert')).toContainText('Retry that exact change'); expect(changes).toHaveLength(1);
  await section.getByLabel('Reason for this change').fill(reason);
  await section.getByRole('button', { name: 'Sign and submit correction' }).click();
  await expect(section).toContainText('I could confirm the paper code but not the pump operation.');
  expect(changes[1]).toEqual(changes[0]); expect(stored.events).toHaveLength(1); expect(stored.payload).toBe(originalPayload);
  bindingCurrent = false;
  await section.getByRole('button', { name: 'Correct or withdraw your statement' }).click();
  await section.getByLabel('Change type').selectOption('withdraw');
  await section.getByLabel('Reason for this change').fill('I can no longer stand behind this witness statement.');
  await section.getByLabel('I am signing this change to my own witness statement.').check();
  await section.getByRole('button', { name: 'Sign and withdraw statement' }).click();
  await expect(section).toContainText('Withdrawn — not active corroboration.');
  await expect(section).toContainText('0 active statements for the current image');
  await expect(section.getByRole('button', { name: 'Correct or withdraw your statement' })).toHaveCount(0);
  await section.getByText('Original statement and signed change history', { exact: true }).click();
  await expect(section).toContainText(originalText); await expect(section).toContainText(reason);
  const [download] = await Promise.all([p.waitForEvent('download'), section.getByRole('button', { name: 'Download signed statement' }).click()]);
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
  const { verifyCaptureWitness } = await import('../../../../cloudflare/verify-capture-witness.mjs');
  expect(verifyCaptureWitness(exported, reviewCapture.contentHash).lifecycle.status).toBe('withdrawn');
  expect(exported.payload).toBe(originalPayload); expect(exported.events).toHaveLength(2);
  await p.setViewportSize({ width: 320, height: 700 });
  expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); expect(errors).toEqual([]);
});

test('viewers see verified corrected history without change controls and a tampered change hides active corroboration', async ({ page: p }) => {
  const original = signedWitnessFixture({ ...witnessContext, requestId: randomUUID(), signedAt: new Date().toISOString(), statement: 'I personally observed the pump and matching code.' });
  const stored = { ...original, id: sampleId, witnessId: 1, witnessName: 'Witness', events: [], revision: 0, status: 'active', receivedAt: new Date().toISOString() };
  stored.events.push({ ...signedWitnessFixture({ ...witnessChangeContext(stored), requestId: randomUUID(), signedAt: new Date().toISOString(), action: 'correct',
    statement: 'I saw the code but could not confirm the pump operation.', reason: 'The original statement overstated the scope of observation.' }),
  id: randomUUID(), sequence: 1, action: 'correct', actorId: 1, actorName: 'Witness', receivedAt: new Date().toISOString() });
  stored.revision = 1;
  await setupAssessmentRecord(p, async (route, path) => {
    if (path.endsWith('/capture-challenges')) { await route.fulfill({ json: { items: [reviewCapture] } }); return true; }
    if (path.endsWith('/witnesses')) { await route.fulfill({ json: { items: [clearKeyTrust(stored)], bindingCurrent: true, canWitness: false, context: null } }); return true; }
    return false;
  });
  const section = p.getByRole('region', { name: 'Signed witness statements' });
  await expect(section).toContainText('I saw the code but could not confirm the pump operation.');
  await expect(section.getByRole('button', { name: 'Correct or withdraw your statement' })).toHaveCount(0);
  stored.events[0].signature = 'a'.repeat(86);
  await p.reload(); await expect(section.getByRole('alert')).toContainText('could not be loaded or verified');
  await expect(section).not.toContainText('Signature verified'); await expect(section).not.toContainText('1 active statements');
});


test('retained signing keys can be revoked with retry-safe attestation and exported trust checks', async ({ page: p }) => {
  const original = signedWitnessFixture({ ...witnessContext, requestId: randomUUID(), signedAt: new Date().toISOString(), statement: 'I personally observed the pump and matching code.' });
  const record = { ...original, id: sampleId, witnessId: 1, witnessName: 'Witness', events: [], revision: 0, status: 'active', receivedAt: new Date().toISOString() };
  const keyHash = clearKeyTrust(record).keyTrust.keys[0].keyHash;
  const root = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }); const issuer = 'https://field.example.test';
  const publicKey = root.publicKey.export({ format: 'jwk' });
  const keyId = createHash('sha256').update(root.publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
  let attestation = null; let tampered = false; const requests = [];
  const errors = await setupAssessmentRecord(p, async (route, path) => {
    if (path.endsWith('/capture-challenges')) { await route.fulfill({ json: { items: [reviewCapture] } }); return true; }
    if (path.endsWith('/witnesses')) {
      const row = clearKeyTrust(record); row.keyTrust.canRevoke = !attestation;
      if (attestation) { row.keyTrust.status = 'revoked'; row.keyTrust.keys[0].revocation = tampered ? { ...attestation, signature: 'a'.repeat(86) } : attestation; }
      await route.fulfill({ json: { items: [row], bindingCurrent: true, canWitness: false, context: null } }); return true;
    }
    if (path.endsWith(`/witnesses/${sampleId}/key-revocations`)) {
      const body = route.request().postDataJSON(); requests.push(body);
      const bytes = Buffer.from(JSON.stringify({ ...body, purpose: 'field-data.witness-key-revocation@1', issuer, projectId: 1, referenceWitnessId: sampleId, witnessAccountId: 1, revokedBy: 1, revokedAt: new Date().toISOString() }));
      attestation ??= { algorithm: 'ES256', keyId, publicKey, payload: bytes.toString('base64url'), signature: sign('sha256', bytes, { key: root.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url') };
      if (requests.length === 1) await route.abort('failed'); else await route.fulfill({ json: { attestation, replayed: true } });
      return true;
    }
    return false;
  });
  const section = p.getByRole('region', { name: 'Signed witness statements' });
  await expect(section).toContainText('1 active statements');
  await section.getByLabel('Reason for key revocation').fill('The signing environment was compromised.');
  await section.getByRole('button', { name: 'Revoke witness signing key', exact: true }).click();
  await expect(section.getByRole('alert')).toContainText('Revocation could not be confirmed');
  await section.getByRole('button', { name: 'Revoke witness signing key', exact: true }).click();
  await expect(section).toContainText('0 active statements'); await expect(section).toContainText('A signing key is revoked');
  await expect(section).toContainText('Signature verified'); expect(requests).toHaveLength(2); expect(requests[1]).toEqual(requests[0]);
  const downloadPromise = p.waitForEvent('download'); await section.getByRole('button', { name: 'Download signed statement' }).click();
  const exported = JSON.parse(await readFile(await (await downloadPromise).path(), 'utf8'));
  const { verifyWitnessKeyRevocation } = await import('../../../../cloudflare/verify-witness-key-revocation.mjs');
  expect(verifyWitnessKeyRevocation(exported.keyTrust.keys[0].revocation, { publicKey, issuer, projectId: 1, keyHash }).keyHash).toBe(keyHash);
  expect(exported.payload).toBe(original.payload);
  tampered = true; await p.reload(); await expect(section).toContainText('Key revocation status is unavailable');
  await expect(section).toContainText('0 active statements'); await expect(section.getByRole('button', { name: 'Revoke witness signing key', exact: true })).toHaveCount(0);
  await p.setViewportSize({ width: 320, height: 700 });
  expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); expect(errors).toEqual([]);
});

const extractedMedia = () => ({ id: sampleId, name: 'scene.jpg', submissionDefId: 1, contentHash: 'b'.repeat(64), contentType: 'image/png', kind: 'photo',
  provider: 'OpenAI', model: 'fixture-photo-model', actorId: 1, actorName: 'Requester', requestedAt: '2026-10-16T12:00:00Z', finishedAt: '2026-10-16T12:00:01Z',
  status: 'ready', failure: null, proposal: 'Pump label 12?4', bindingCurrent: true, revision: 0, reviews: [], decision: 'unreviewed' });
const extractionList = (items, canWrite = true) => ({ enabled: true, canRequest: canWrite, canReview: canWrite,
  media: [{ name: 'scene.jpg', contentType: 'image/png', kind: 'photo' }, { name: 'voice.wav', contentType: 'audio/wav', kind: 'audio' }], mediaOmitted: 0, items });

test('media extraction requires consent and supports corrected review, safe retries and rejection history', async ({ page: p }) => {
  let stored = null; const requests = []; const reviews = [];
  const errors = await setupAssessmentRecord(p, async (route, path) => {
    if (path.endsWith('/capture-challenges')) { await route.fulfill({ json: { items: [] } }); return true; }
    if (path.endsWith('/media-extractions')) {
      if (route.request().method() === 'POST') {
        requests.push(route.request().postDataJSON()); stored ??= extractedMedia();
        if (requests.length === 1) await route.abort('failed'); else await route.fulfill({ json: { item: stored, replayed: true } });
      } else await route.fulfill({ json: extractionList(stored ? [stored] : []) });
      return true;
    }
    if (path.endsWith(`/media-extractions/${sampleId}/source`)) { await route.fulfill({ body: Buffer.from('fixture image'), contentType: 'image/png' }); return true; }
    if (path.endsWith(`/media-extractions/${sampleId}/reviews`)) {
      const body = route.request().postDataJSON(); reviews.push(body);
      if (reviews.length !== 2) {
        stored.reviews.push({ id: randomUUID(), sequence: stored.revision + 1, action: body.action, text: body.text, reason: body.reason,
          actorId: 1, actorName: 'Reviewer', reviewedAt: new Date().toISOString() }); stored.revision += 1; stored.decision = body.action;
      }
      if (reviews.length === 1) await route.abort('failed'); else await route.fulfill({ json: { item: structuredClone(stored) } }); return true;
    }
    return false;
  });
  const section = p.getByRole('region', { name: 'Media extraction', exact: true });
  await expect(section).toContainText('No extraction has been requested');
  await section.getByLabel('Source media').selectOption('scene.jpg');
  await expect(section.getByRole('button', { name: 'Request extraction', exact: true })).toBeDisabled();
  await section.getByLabel('I am authorized to send this media to OpenAI for extraction.').check();
  await section.getByRole('button', { name: 'Request extraction', exact: true }).click();
  await expect(section.getByRole('alert')).toContainText('Request could not be confirmed');
  await expect(section.getByLabel('Source media')).toBeDisabled();
  await section.getByRole('button', { name: 'Retry same extraction request' }).click(); expect(requests[1]).toEqual(requests[0]);
  await expect(section).toContainText('Pump label 12?4');
  const record = section.locator('.media-extraction-record');
  const confirmed = record.getByLabel('I reviewed the original media and checked this decision. Download the original first.');
  await expect(confirmed).toBeDisabled();
  await Promise.all([p.waitForEvent('download'), record.getByRole('button', { name: 'Download original media', exact: true }).click()]);
  await record.getByLabel('Reviewed text', { exact: true }).fill('Pump label 1234');
  await record.getByLabel('Review reason').fill('The final digit is clearly 3 on the original label.'); await confirmed.check();
  await record.getByRole('button', { name: 'Save review decision' }).click();
  await expect(record.getByRole('alert')).toContainText('Review could not be confirmed');
  await expect(record.getByLabel('Reviewed text', { exact: true })).toBeDisabled();
  await record.getByRole('button', { name: 'Retry same review' }).click(); expect(reviews[1]).toEqual(reviews[0]);
  await expect(record).toContainText('Approved by a reviewer'); await expect(record).toContainText('Pump label 1234');
  await expect(record).toContainText('Pump label 12?4');
  await record.getByRole('combobox', { name: /^Decision/ }).selectOption('reject');
  await Promise.all([p.waitForEvent('download'), record.getByRole('button', { name: 'Download original media', exact: true }).click()]);
  await record.getByLabel('Review reason').fill('A second review finds the original label is unreadable.'); await confirmed.check();
  await record.getByRole('button', { name: 'Save review decision' }).click(); await expect(record).toContainText('Rejected by a reviewer');
  expect(reviews[2].text).toBeNull();
  await record.getByText('Review history (2)', { exact: true }).click(); await expect(record).toContainText('Pump label 1234');
  const [download] = await Promise.all([p.waitForEvent('download'), record.getByRole('button', { name: 'Download extraction history' }).click()]);
  const exported = JSON.parse(await readFile(await download.path(), 'utf8')); expect(exported.proposal).toBe('Pump label 12?4'); expect(exported.reviews).toHaveLength(2);
  await p.setViewportSize({ width: 320, height: 700 }); expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); expect(errors).toEqual([]);
});

test('media extraction viewers see historical audio corrections without write controls or current approval', async ({ page: p }) => {
  const item = { ...extractedMedia(), kind: 'audio', contentType: 'audio/wav', name: 'voice.wav', proposal: 'Original transcript', revision: 1, bindingCurrent: false, decision: 'outdated',
    reviews: [{ id: randomUUID(), sequence: 1, action: 'approve', text: 'Corrected original-language transcript', reason: 'Listened to the original recording.', actorName: 'Reviewer', reviewedAt: '2026-10-16T12:01:00Z' }] };
  const errors = await setupAssessmentRecord(p, async (route, path) => {
    if (path.endsWith('/capture-challenges')) { await route.fulfill({ json: { items: [] } }); return true; }
    if (path.endsWith('/media-extractions')) { await route.fulfill({ json: extractionList([item], false) }); return true; } return false;
  }, viewerVerbs);
  const section = p.getByRole('region', { name: 'Media extraction', exact: true });
  await expect(section).toContainText('Voice transcript'); await expect(section).toContainText('Outdated source');
  await expect(section).toContainText('Historical reviewed text'); await expect(section).toContainText('No current approval');
  await expect(section.getByRole('button', { name: 'Request extraction', exact: true })).toHaveCount(0); await expect(section.getByRole('button', { name: 'Save review decision' })).toHaveCount(0);
  await p.setViewportSize({ width: 320, height: 700 }); expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); expect(errors).toEqual([]);
});

test('media extraction displays provider readiness and rejects malformed history on refresh', async ({ page: p }) => {
  let invalid = false;
  await setupAssessmentRecord(p, async (route, path) => {
    if (path.endsWith('/capture-challenges')) { await route.fulfill({ json: { items: [] } }); return true; }
    if (path.endsWith('/media-extractions')) { await route.fulfill({ json: invalid ? extractionList([{ ...extractedMedia(), revision: 1, reviews: [] }]) : { ...extractionList([]), enabled: false } }); return true; }
    return false;
  });
  const section = p.getByRole('region', { name: 'Media extraction', exact: true });
  await expect(section).toContainText('External extraction is not configured'); await expect(section.getByRole('button', { name: 'Request extraction', exact: true })).toHaveCount(0);
  invalid = true; await section.getByRole('button', { name: 'Refresh extraction history' }).click(); await expect(section.getByRole('alert')).toContainText('could not be loaded');
  await expect(section.locator('.media-extraction-record')).toHaveCount(0);
});

const geoSource = () => ({ submissionDefId: 1, versionId: 'uuid:one', formDefId: 1, xmlHash: 'c'.repeat(64), attachmentsHash: 'd'.repeat(64),
  fingerprint: 'a'.repeat(64), geopointField: '/location', location: { latitude: 8.4801, longitude: -13.2344, accuracy: 5 }, visitAt: '2026-09-20T10:30:00Z', visitBasis: 'receipt', encrypted: false });
const geoScene = { id: 'scene-1', at: '2026-09-18T12:00:00Z', cloud: 41.7, fingerprint: 'b'.repeat(64), metadataUrl: 'https://catalogue.example.test/v1/collections/sentinel-2-l2a/items/scene-1' };
const geoView = (items = [], extra = {}) => ({ source: geoSource(), revision: items[0]?.sequence ?? 0, canAssess: true, canCheck: true,
  catalogue: { enabled: true, status: 'complete', scenes: [geoScene], checkedAt: '2026-09-21T10:30:00Z', stale: true, cellDegrees: 0.05, windowDays: 30, omitted: 0 }, items, ...extra });
const geoRecord = (body, sequence) => ({ id: randomUUID(), sequence, source: geoSource(), sourceFingerprint: body.sourceFingerprint, outcome: body.outcome, claim: body.claim, reason: body.reason,
  limitations: body.limitations, reviewedImage: body.reviewedImage, reviewedAt: '2026-10-16T13:00:00Z', actorName: 'Reviewer', state: 'current', bindingCurrent: true, sourceCurrent: true,
  citationStatus: body.citation?.kind === 'catalogue' ? 'catalogue-current' : body.citation ? 'reviewer-reference' : 'none',
  citation: body.citation?.kind === 'catalogue' ? { ...body.citation, at: geoScene.at, cloud: geoScene.cloud, metadataUrl: geoScene.metadataUrl, staleAtReview: true } : body.citation });

test('geospatial review cites catalogue imagery, retries safely and retains a revised dated-reference assessment', async ({ page: p }) => {
  const posts = []; const checks = []; let items = [];
  const errors = await setupAssessmentRecord(p, async (route, path) => {
    if (path.endsWith('/geo-assessments/catalogue/check')) { checks.push(route.request().postDataJSON()); await route.fulfill({ json: { ok: false, reason: 'catalogue-unavailable' } }); return true; }
    if (path.endsWith('/geo-assessments')) {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON(); posts.push(body);
        if (posts.length !== 2) { items = items.map(i => ({ ...i, state: 'superseded' })); items.unshift(geoRecord(body, items.length + 1)); }
        if (posts.length === 1) await route.abort('failed'); else await route.fulfill({ json: { item: items[0], revision: items.length } });
      } else await route.fulfill({ json: geoView(items) }); return true;
    }
    return false;
  });
  const section = p.getByRole('region', { name: 'Geospatial verification', exact: true });
  await expect(section).toContainText('Server receipt time; visit time unavailable'); await expect(section).toContainText('reported accuracy 5 m');
  await section.getByText('Inspect candidate dates and cloud cover').click(); await expect(section).toContainText('2 days before the receipt'); await expect(section).toContainText('41.7% scene cloud');
  await expect(section.getByRole('link', { name: 'scene-1 metadata' })).toHaveAttribute('rel', 'noopener noreferrer');
  await section.getByRole('button', { name: "Check this location's imagery availability" }).click(); await expect(section).toContainText('Catalogue unavailable. No empty imagery result was substituted');
  expect(checks).toEqual([{ sourceFingerprint: 'a'.repeat(64) }]);
  await section.getByLabel('Claim being assessed').fill('The claimed structure exists at the reported location.');
  await section.getByRole('combobox', { name: /^Evidence outcome/ }).selectOption('supports'); await section.getByRole('combobox', { name: /^Imagery citation/ }).selectOption('catalogue');
  await section.getByRole('combobox', { name: /^Catalogue scene/ }).selectOption('scene-1');
  await section.getByLabel('Image reference URL').fill('https://images.example.test/scene-1'); await section.getByLabel('I inspected the cited image, its date and the reported location.').check();
  await section.getByLabel('Assessment reasoning').fill('The cited image shows a structure matching the reported claim.');
  await section.getByLabel('Evidence limitations').fill('Cloud cover and seasonal appearance limit interpretation; visit time is unknown.');
  await section.getByRole('button', { name: 'Save geospatial assessment', exact: true }).click(); await expect(section.getByRole('alert')).toContainText('Assessment could not be confirmed');
  await expect(section.getByLabel('Claim being assessed')).toBeDisabled();
  await section.getByRole('button', { name: 'Retry same geospatial assessment' }).click(); expect(posts[1]).toEqual(posts[0]);
  await expect(section).toContainText('Latest assessment for current evidence'); await expect(section).toContainText('cache was older than seven days at review');
  await section.getByRole('combobox', { name: /^Evidence outcome/ }).selectOption('conflicts');
  await section.getByRole('combobox', { name: /^Imagery citation/ }).selectOption('reference');
  await section.getByLabel('Reference title').fill('Second dated imagery inspection'); await section.getByLabel('Image date', { exact: true }).fill('2026-09-19');
  await section.getByLabel('Image reference URL').fill('https://images.example.test/second'); await section.getByLabel('I inspected the cited image, its date and the reported location.').check();
  await section.getByLabel('Assessment reasoning').fill('The second reference shows a different feature at that location.');
  await section.getByLabel('Evidence limitations').fill('Different viewing angle and receipt time prevent a definitive conclusion.');
  await section.getByRole('button', { name: 'Save geospatial assessment', exact: true }).click();
  await expect(section).toContainText('Superseded assessment'); await expect(section).toContainText('Conflicts with the claim'); await expect(section).toContainText('external changes are not monitored');
  const [download] = await Promise.all([p.waitForEvent('download'), section.getByRole('button', { name: 'Download geospatial assessment history' }).click()]);
  const exported = JSON.parse(await readFile(await download.path(), 'utf8')); expect(exported.items).toHaveLength(2); expect(exported.items[1].citation.sceneFingerprint).toBe('b'.repeat(64)); expect(exported.items[0].citation.date).toBe('2026-09-19');
  await p.setViewportSize({ width: 320, height: 700 }); expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); expect(errors).toEqual([]);
});

test('geospatial viewers see outdated source and catalogue history with the original receipt-time citation', async ({ page: p }) => {
  const item = geoRecord({ sourceFingerprint: 'a'.repeat(64), outcome: 'unclear', claim: 'The structure cannot be distinguished.', reason: 'Cloud obscures the relevant area.', limitations: 'Cloud, season and resolution are limiting.', citation: { kind: 'catalogue', sceneId: geoScene.id, sceneFingerprint: geoScene.fingerprint, url: null }, reviewedImage: false }, 1);
  item.state = 'outdated'; item.bindingCurrent = false; item.sourceCurrent = false; item.citationStatus = 'catalogue-changed';
  const errors = await setupAssessmentRecord(p, async (route, path) => {
    if (path.endsWith('/geo-assessments')) { await route.fulfill({ json: geoView([item], { source: { ...geoSource(), fingerprint: 'e'.repeat(64), visitBasis: 'device-audit-log' }, canAssess: false, canCheck: false }) }); return true; } return false;
  }, viewerVerbs);
  const section = p.getByRole('region', { name: 'Geospatial verification', exact: true });
  await expect(section).toContainText('Latest assessment outdated'); await expect(section).toContainText('Cited catalogue metadata changed');
  await expect(section).toContainText('Metadata-only assessment'); await expect(section).toContainText('2 days before the receipt');
  await expect(section.getByRole('button', { name: 'Save geospatial assessment', exact: true })).toHaveCount(0);
  await expect(section.getByRole('button', { name: "Check this location's imagery availability" })).toHaveCount(0);
  await p.setViewportSize({ width: 320, height: 700 }); expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); expect(errors).toEqual([]);
});

test('geospatial review allows unavailable evidence with no location and refreshes after a stale revision', async ({ page: p }) => {
  let items = []; const posts = []; let stale = false;
  await setupAssessmentRecord(p, async (route, path) => {
    if (path.endsWith('/geo-assessments')) {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON(); posts.push(body);
        if (!stale) { stale = true; await route.fulfill({ status: 409, json: { code: 409.51, message: 'Source changed' } }); }
        else { const item = geoRecord(body, 1); item.source.location = null; items = [item]; await route.fulfill({ json: { item, revision: 1 } }); }
      } else await route.fulfill({ json: geoView(items, { source: { ...geoSource(), location: null }, canCheck: false, catalogue: { enabled: false, status: 'no-location', scenes: [], cellDegrees: 0.05 } }) }); return true;
    } return false;
  });
  const section = p.getByRole('region', { name: 'Geospatial verification', exact: true }); await expect(section).toContainText('No usable reported location');
  await expect(section.locator('option[value="supports"]')).toHaveAttribute('disabled', '');
  const fill = async () => {
    await section.getByLabel('Claim being assessed').fill('The location claim cannot be assessed with current evidence.');
    await section.getByRole('combobox', { name: /^Evidence outcome/ }).selectOption('unavailable');
    await section.getByLabel('Assessment reasoning').fill('There is no usable reported location for this record.');
    await section.getByLabel('Evidence limitations').fill('Location and visit time are missing; imagery was not inspected.');
  };
  await fill(); await section.getByRole('button', { name: 'Save geospatial assessment', exact: true }).click(); await expect(section.getByRole('alert')).toContainText('Source, citation or revision changed');
  await section.getByRole('button', { name: 'Refresh geospatial history' }).click(); await fill(); await section.getByRole('button', { name: 'Save geospatial assessment', exact: true }).click();
  await expect(section).toContainText('Unavailable · Latest assessment for current evidence'); expect(posts[1].citation).toBeNull(); expect(posts[1].reviewedImage).toBe(false); expect(posts[1].requestId).not.toBe(posts[0].requestId);
});
