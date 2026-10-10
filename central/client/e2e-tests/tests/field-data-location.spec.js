/* global localStorage */
// G1 location evidence in the browser: docs/field-intelligence/G1-location-evidence.md
import { expect, test } from '@playwright/test';

const appUrl = process.env.ODK_URL || 'http://127.0.0.1:8989';
const verbs = ['project.read', 'project.update', 'form.read', 'form.list', 'submission.list', 'submission.read', 'submission.update'];

const area = { status: 'set', layerId: 'area', layerRevision: 2, title: 'Freetown study area', geometrySha256: 'f'.repeat(64) };
const evidence = (projectArea = area) => ({
  submissions: [],
  projectArea,
  encrypted: false,
  coverage: {
    total: 7, withCaptureTime: 0, withLocation: 6,
    byAccuracyBand: { '≤10': 4, '≤100': 1, '>100': 1, none: 1 },
    byProjectArea: { inside: 4, 'near-edge': 1, outside: 1, 'not-checked': 1 }
  },
  limits: ['A location reading shows where a device believed it was, not that anybody was present.']
});

const flag = (id, rule, outcome, ev, extra = {}) => ({
  id, rule, ruleVersion: 1, formId: 1, instanceId: `uuid:${id}`, relatedInstanceId: null, outcome, evidence: ev,
  status: 'open', decision: null, note: null, decidedBy: null, decidedAt: null, createdAt: '2026-10-10T09:00:00Z', ...extra
});
const findings = () => [
  flag(1, 'outside-project-area', 'concern', {
    distanceOutsideM: 1103.4, toleranceM: 5, toleranceSource: 'reported-accuracy',
    explanation: 'The reading is 1103.4 m outside the project area, more than its 5 m uncertainty.',
    alternatives: ['The project area boundary is incomplete or out of date.'], nextStep: 'Check the boundary first, then ask the collector where the interview took place.'
  }),
  flag(2, 'repeated-location', 'concern', {
    coordinates: '8.465712 -13.231755', groupSize: 2, sameSubmitter: false, sameDevice: true,
    explanation: 'This location is identical, to every digit reported, to 1 other submission(s) of this form.',
    alternatives: ['The device re-used a cached location instead of taking a new reading.'], nextStep: 'Compare the submissions.'
  }, { relatedInstanceId: 'uuid:first' }),
  flag(3, 'location-accuracy', 'withdrawn', {
    reportedAccuracyM: 250, thresholdM: 100, explanation: 'The device reported this reading as accurate only to 250 m, worse than 100 m.',
    withdrawnAt: '2026-10-10T10:00:00Z'
  }, { status: 'investigating', note: 'Asked the collector.' }),
  flag(4, 'implausible-travel', 'concern', {
    straightLineM: 160000, leastDistanceM: 159990, secondsBetween: 1800, impliedSpeedKmh: 320, thresholdKmh: 120,
    alternatives: ['The device clock was wrong.'], nextStep: 'Compare the two submissions with the collector.'
  }, { relatedInstanceId: 'uuid:before' })
];

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

test('verification shows location coverage, rule-specific findings, withdrawn findings and the run report', async ({ page }) => {
  let ran = false;
  const errors = await api(page, async (route, path) => {
    if (path === '/v1/projects/1/forms/geo_survey/evidence') { await route.fulfill({ json: evidence() }); return true; }
    if (path === '/v1/projects/1/forms/geo_survey/integrity/run') {
      ran = true;
      await route.fulfill({ json: {
        rule: 'implausible-travel', ruleVersion: 1, thresholds: { maxSpeedKmh: 120, minSecondsBetween: 120, maxUsableAccuracyM: 100 },
        examined: 7, collectors: 2, concerns: 1, inconclusive: 0, plausible: 3, withdrawn: 1, projectArea: area, encrypted: false,
        locationRules: [
          { rule: 'location-accuracy', ruleVersion: 1, ran: true, concern: 0, thresholds: { maxAccuracyM: 100 } },
          { rule: 'outside-project-area', ruleVersion: 1, ran: true, concern: 1, nearEdge: 1, thresholds: { defaultToleranceM: 100 } },
          { rule: 'repeated-location', ruleVersion: 1, ran: true, concern: 1, thresholds: { minDecimals: 5 } }
        ]
      } });
      return true;
    }
    if (path === '/v1/projects/1/forms/geo_survey/integrity') { await route.fulfill({ json: findings() }); return true; }
    return false;
  });
  await page.goto(`${appUrl}/projects/1/forms/geo_survey/verification`);
  const panel = page.locator('#submission-verification');

  // What the evidence carries, in named parts.
  const coverage = panel.locator('.location-coverage');
  await expect(coverage).toContainText('Freetown study area');
  await expect(coverage).toContainText('4 inside · 1 near the edge · 1 outside · 1 without a location');
  await expect(coverage).toContainText('4 within 10 m · 1 within 100 m · 1 worse than 100 m · 1 without a location');

  const items = panel.locator('.finding');
  await expect(items).toHaveCount(4);
  // Each location finding says what it is and shows its own figures, not the travel rule's.
  const outside = items.nth(0);
  await expect(outside).toContainText('Outside the project area');
  await expect(outside).toContainText('1103.4 m outside the project area');
  await expect(outside).toContainText('Outside by');
  await expect(outside).toContainText('5 m (reported accuracy)');
  await expect(outside).not.toContainText('Implied speed');
  const repeat = items.nth(1);
  await expect(repeat).toContainText('8.465712 -13.231755');
  await expect(repeat.getByRole('link', { name: 'Open the earliest with this location' })).toHaveAttribute('href', /uuid%3Afirst/);
  const withdrawn = items.nth(2);
  await expect(withdrawn).toContainText('No longer found');
  await expect(withdrawn).toContainText('It no longer holds up a review');
  await expect(withdrawn).toContainText('250 m');
  // The travel rule is unchanged.
  const travel = items.nth(3);
  await expect(travel).toContainText('Travel between Submissions');
  await expect(travel).toContainText('Implied speed');
  await expect(travel).toContainText('320 km/h');
  await expect(travel.getByRole('link', { name: 'Open the previous one' })).toBeVisible();

  await panel.getByRole('button', { name: 'Run checks' }).click();
  const report = panel.locator('.run-report');
  await expect(report).toContainText('Outside the project area v1: 1 to look at.');
  await expect(report).toContainText('Repeated location v1: 1 to look at.');
  await expect(report).toContainText('1 earlier location findings are no longer found and were withdrawn.');
  expect(ran).toBe(true);

  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= 360)).toBe(true);
  expect(errors).toEqual([]);
});

test('verification says why locations are not checked against an area', async ({ page }) => {
  const errors = await api(page, async (route, path) => {
    if (path === '/v1/projects/1/forms/geo_survey/evidence') {
      await route.fulfill({ json: { ...evidence({ status: 'unusable', reason: 'no-area-set', layerId: null }), coverage: { total: 1, withCaptureTime: 0, withLocation: 1, byAccuracyBand: { '≤10': 1 }, byProjectArea: { 'no-area-set': 1 } } } });
      return true;
    }
    if (path === '/v1/projects/1/forms/geo_survey/integrity') { await route.fulfill({ json: [] }); return true; }
    return false;
  });
  await page.goto(`${appUrl}/projects/1/forms/geo_survey/verification`);
  const coverage = page.locator('.location-coverage');
  await expect(coverage).toContainText('Not set. Upload a boundary and mark it as the project area');
  await expect(coverage).toContainText('1 not checked (no area)');
  expect(errors).toEqual([]);
});

test('a manager marks an uploaded boundary as the project area and sees a refusal explained', async ({ page }) => {
  const layers = [
    { id: 'boundary', title: 'Study area', revision: 1, definition: { sourceType: 'geojson-upload', visible: true, attribution: 'Survey office', style: { mode: 'single', color: '#137d92', missingColor: '#777777' } },
      data: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[-13.3, 8.4], [-13.15, 8.4], [-13.15, 8.52], [-13.3, 8.52], [-13.3, 8.4]]] }, properties: {} }] } },
    { id: 'wells', title: 'Wells', revision: 1, definition: { sourceType: 'geojson-upload', visible: true, attribution: 'Survey office', style: { mode: 'single', color: '#137d92', missingColor: '#777777' } },
      data: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [-13.2, 8.45] }, properties: {} }] } }
  ];
  const puts = [];
  const errors = await api(page, async (route, path) => {
    if (path.endsWith('/sources')) { await route.fulfill({ json: { forms: [{ id: 1, name: 'Survey' }], filtered: [], merged: [] } }); return true; }
    if (path.endsWith('/query')) {
      const fields = [{ path: '/name', name: 'Name', type: 'string' }];
      await route.fulfill({ json: { total: 1, fields, availableFields: fields, definition: { version: 1, source: { kind: 'form', id: 1 }, columns: ['/name'], query: [], chart: null, geometry: null, tab: 'table' },
        rows: [{ instanceId: 'uuid:1', sourceForm: 'geo_survey', data: { '/name': 'Map' } }], nextOffset: null, map: { type: 'FeatureCollection', features: [] } } });
      return true;
    }
    if (path.endsWith('/map-layers')) { await route.fulfill({ json: layers }); return true; }
    const match = /\/map-layers\/(\w+)$/.exec(path);
    if (match && route.request().method() === 'PUT') {
      const body = route.request().postDataJSON(); puts.push({ id: match[1], body, ifMatch: route.request().headers()['if-match'] });
      if (match[1] === 'wells') { await route.fulfill({ status: 400, json: { code: 400.54, message: 'The project area must contain at least one polygon.', details: { reason: 'no-polygon' } } }); return true; }
      const layer = layers.find(l => l.id === match[1]);
      layer.definition = { ...layer.definition, role: body.role ?? undefined }; layer.revision += 1;
      await route.fulfill({ json: { success: true } }); return true;
    }
    return false;
  });
  await page.goto(`${appUrl}/field-data/analysis?project=1`);
  await page.getByLabel('Source', { exact: true }).selectOption('form:1');
  await page.getByRole('button', { name: 'map', exact: true }).click();
  const boundary = page.locator('.reference-layer').filter({ hasText: 'Study area' });
  await boundary.getByRole('button', { name: 'Use as project area' }).click();
  await expect(boundary).toContainText('Project area. Location checks flag readings outside this boundary');
  expect(puts[0]).toEqual({ id: 'boundary', body: { role: 'project-area' }, ifMatch: '"layer-1"' });
  await expect(boundary.getByRole('button', { name: 'Stop using as project area' })).toBeVisible();

  const wells = page.locator('.reference-layer').filter({ hasText: 'Wells' });
  await wells.getByRole('button', { name: 'Use as project area' }).click();
  // Shown once, beside the layers, not also in the global banner.
  await expect(page.getByRole('alert')).toHaveCount(1);
  await expect(page.getByRole('alert')).toContainText('The project area must contain at least one polygon.');
  await expect(wells).not.toContainText('Project area.');

  await boundary.getByRole('button', { name: 'Stop using as project area' }).click();
  expect(puts.at(-1)).toEqual({ id: 'boundary', body: { role: null }, ifMatch: '"layer-2"' });
  await expect(boundary).not.toContainText('Project area.');
  expect(errors).toEqual([]);
});

test('a manager sets the project area from the verification screen, and the summary refreshes', async ({ page }) => {
  let evidenceCalls = 0;
  const layers = [{ id: 'boundary', title: 'Study area', revision: 1, definition: { sourceType: 'geojson-upload', visible: true, attribution: 'Survey office', style: { mode: 'single', color: '#137d92', missingColor: '#777777' } },
    data: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[-13.3, 8.4], [-13.15, 8.4], [-13.15, 8.52], [-13.3, 8.52], [-13.3, 8.4]]] }, properties: {} }] } }];
  const errors = await api(page, async (route, path) => {
    if (path === '/v1/projects/1/forms/geo_survey/evidence') {
      evidenceCalls += 1;
      await route.fulfill({ json: evidence(layers[0].definition.role === 'project-area' ? { ...area, title: 'Study area' } : { status: 'unusable', reason: 'no-area-set', layerId: null }) });
      return true;
    }
    if (path === '/v1/projects/1/forms/geo_survey/integrity') { await route.fulfill({ json: [] }); return true; }
    if (path === '/v1/projects/1/map-layers') { await route.fulfill({ json: layers }); return true; }
    if (path === '/v1/projects/1/map-layers/boundary' && route.request().method() === 'PUT') {
      layers[0].definition = { ...layers[0].definition, role: route.request().postDataJSON().role ?? undefined }; layers[0].revision += 1;
      await route.fulfill({ json: { success: true } }); return true;
    }
    return false;
  });
  await page.goto(`${appUrl}/projects/1/forms/geo_survey/verification`);
  const coverage = page.locator('.location-coverage');
  await expect(coverage).toContainText('Not set.');
  await coverage.getByRole('button', { name: 'Set project area' }).click();
  const panel = page.locator('.project-area-panel');
  await expect(panel.getByLabel('GeoJSON (WGS84, up to 2 MB)')).toBeVisible();
  await panel.locator('.reference-layer').getByRole('button', { name: 'Use as project area' }).click();
  await expect(coverage).toContainText('Study area');
  expect(evidenceCalls).toBe(2);
  await expect(coverage.getByRole('button', { name: 'Close' })).toHaveAttribute('aria-expanded', 'true');
  expect(errors).toEqual([]);
});

test('reviewers without project management do not see the project area control', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sessionExpires', String(Date.now() + 3600000)));
  const errors = await api(page, async (route, path) => {
    if (path === '/v1/projects/1') { await route.fulfill({ json: { id: 1, name: 'Synthetic', forms: 1, datasets: 0, archived: false, verbs: verbs.filter((v) => v !== 'project.update') } }); return true; }
    if (path === '/v1/projects') { await route.fulfill({ json: [{ id: 1, name: 'Synthetic', forms: 1, datasets: 0, archived: false, verbs: verbs.filter((v) => v !== 'project.update') }] }); return true; }
    if (path === '/v1/projects/1/forms/geo_survey/evidence') { await route.fulfill({ json: evidence() }); return true; }
    if (path === '/v1/projects/1/forms/geo_survey/integrity') { await route.fulfill({ json: [] }); return true; }
    return false;
  });
  await page.goto(`${appUrl}/projects/1/forms/geo_survey/verification`);
  await expect(page.locator('.location-coverage')).toContainText('Freetown study area');
  await expect(page.getByRole('button', { name: 'Set project area' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the analysis map lists GPS questions first and explains a repeat scope without one', async ({ page }) => {
  const fields = [{ path: '/name', name: 'name', type: 'string' }, { path: '/home_gps', name: 'home_gps', type: 'geopoint' }];
  const memberFields = [{ path: '/member/age', name: 'age', type: 'int' }];
  const errors = await api(page, async (route, path) => {
    if (path.endsWith('/sources')) { await route.fulfill({ json: { forms: [{ id: 1, name: 'Survey' }], filtered: [], merged: [] } }); return true; }
    if (path.endsWith('/query')) {
      const scope = route.request().postDataJSON().repeatPath;
      const available = scope ? memberFields : fields;
      await route.fulfill({ json: { total: 1, fields: available, availableFields: available, repeatPaths: ['/member'],
        definition: { version: 1, source: { kind: 'form', id: 1 }, columns: available.map((f) => f.path), query: [], chart: null, geometry: null, tab: 'table', ...(scope ? { repeatPath: scope } : {}) },
        rows: [], nextOffset: null, map: null } });
      return true;
    }
    return false;
  });
  await page.goto(`${appUrl}/field-data/analysis?project=1`);
  await page.getByLabel('Source', { exact: true }).selectOption('form:1');
  await page.getByRole('button', { name: 'map', exact: true }).click();
  await expect(page.getByLabel('Location field').locator('optgroup').first()).toHaveAttribute('label', 'GPS questions');
  await expect(page.getByLabel('Location field').locator('optgroup').first().locator('option')).toHaveText(['home_gps']);
  await page.getByLabel('Analysis scope').selectOption('/member');
  await expect(page.getByText('This repeat has no GPS question. To map a GPS question from the main form, set Analysis scope to Parent submissions.')).toBeVisible();
  expect(errors).toEqual([]);
});
