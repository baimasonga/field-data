/* global localStorage */
// F2 identity reuse in the browser: docs/field-intelligence/F2-identity-reuse.md
import { expect, test } from '@playwright/test';

const appUrl = process.env.ODK_URL || 'http://127.0.0.1:8989';
const managerVerbs = ['project.read', 'project.update', 'form.read', 'form.list', 'submission.list', 'submission.read', 'submission.update'];
const reviewerVerbs = managerVerbs.filter((v) => v !== 'project.update');

const fields = [
  { path: '/meta', name: 'meta', type: 'structure', binary: null, selectMultiple: null },
  { path: '/meta/instanceID', name: 'instanceID', type: 'string', binary: null, selectMultiple: null },
  { path: '/hh_code', name: 'hh_code', type: 'string', binary: null, selectMultiple: null },
  { path: '/phone', name: 'phone', type: 'string', binary: null, selectMultiple: null },
  { path: '/district', name: 'district', type: 'string', binary: null, selectMultiple: null },
  { path: '/visit_date', name: 'visit_date', type: 'date', binary: null, selectMultiple: null },
  { path: '/assets', name: 'assets', type: 'string', binary: null, selectMultiple: true },
  { path: '/location', name: 'location', type: 'geopoint', binary: null, selectMultiple: null },
  { path: '/photo', name: 'photo', type: 'binary', binary: true, selectMultiple: null },
  { path: '/member', name: 'member', type: 'repeat', binary: null, selectMultiple: null },
  { path: '/member/member_id', name: 'member_id', type: 'string', binary: null, selectMultiple: null }
];
const householdKey = {
  id: 'key-1', title: 'Household code', version: 1, revision: 1, active: true,
  explanation: 'Each household is interviewed once.', benignExplanations: ['A follow-up visit.'],
  nextStep: 'Ask which visit is right.', status: { usable: true },
  fields: [{ field: '/hh_code', match: 'exact' }], sameFields: ['/district'], maxUses: 1, windowDays: null,
  ignoreValues: ['none'], minLength: 3
};
const common = { keyId: 'key-1', title: householdKey.title, explanation: householdKey.explanation,
  alternatives: householdKey.benignExplanations, nextStep: householdKey.nextStep, fields: ['/hh_code'] };
const reused = {
  id: 21, rule: 'identity-reused:key-1', ruleVersion: 1, formId: 1, instanceId: 'uuid:again', relatedInstanceId: 'uuid:first', outcome: 'concern',
  status: 'open', decision: null, note: null, decidedBy: null, decidedAt: null, createdAt: '2026-10-10T09:00:00Z',
  evidence: { ...common, kind: 'reused', sharedBy: 3, earlierInWindow: 2, maxUses: 1, windowDays: null,
    submission: { instanceId: 'uuid:again', receivedAt: '2026-10-09T10:00:00Z', submitter: 5 },
    others: [{ instanceId: 'uuid:first', receivedAt: '2026-10-01T10:00:00Z', submitter: 5 }, { instanceId: 'uuid:gone', receivedAt: '2026-10-05T10:00:00Z', submitter: 6 }] },
  answers: { 'uuid:again': { '/hh_code': 'wa0001' }, 'uuid:first': { '/hh_code': 'WA0001' }, 'uuid:gone': null }
};
const inconsistent = {
  ...reused, id: 22, rule: 'identity-inconsistent:key-1',
  evidence: { ...common, kind: 'inconsistent', differing: ['/district'],
    submission: reused.evidence.submission, others: [reused.evidence.others[0]] },
  answers: { 'uuid:again': { '/hh_code': 'wa0001', '/district': 'Kenema' }, 'uuid:first': { '/hh_code': 'WA0001', '/district': 'Bo' } }
};

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

test('a manager writes a phone key with the editor and the API receives exactly that key', async ({ page: p }) => {
  const keys = [];
  let posted;
  const errors = await api(p, managerVerbs, async (route, path) => {
    if (path === '/v1/projects/1/forms/household/identity-keys') {
      if (route.request().method() === 'POST') {
        posted = route.request().postDataJSON();
        keys.push({ ...posted, id: 'key-new', version: 1, revision: 1, status: { usable: true } });
        await route.fulfill({ status: 201, json: keys[0] }); return true;
      }
      await route.fulfill({ json: keys }); return true;
    }
    if (path === '/v1/projects/1/forms/household/contradiction-rules') { await route.fulfill({ json: [] }); return true; }
    if (path === '/v1/projects/1/forms/household/integrity') { await route.fulfill({ json: [] }); return true; }
    return false;
  });
  await p.goto(`${appUrl}${page}`);
  const section = p.locator('.identity-keys');
  await expect(section).toContainText('No identity keys yet.');
  await section.getByRole('button', { name: 'New identity key' }).click();
  // Only top-level text or number questions can be a key: not a choice list,
  // a location, a photo, a question inside a repeat, or the form's metadata.
  await expect(section.getByLabel('Key question 1', { exact: true }).locator('option'))
    .toHaveText(['Choose a question', '/hh_code', '/phone', '/district']);
  await section.getByLabel('Title').fill('Phone number');
  await section.getByLabel('Key question 1', { exact: true }).selectOption('/phone');
  await section.getByLabel('Key question 1 match').selectOption('digits');
  // The key's own question is not offered as one that should stay the same.
  await expect(section.getByRole('checkbox', { name: '/phone' })).toHaveCount(0);
  await section.getByRole('checkbox', { name: '/district' }).check();
  await section.getByLabel('Submissions allowed per key').fill('2');
  await section.getByLabel(/Only within this many days/).fill('30');
  await section.getByLabel(/Placeholder values/).fill('none\n\nno phone');
  await section.getByLabel('Why a repeated key matters').fill('A phone number usually belongs to one household.');
  await section.getByLabel(/Ordinary reasons/).fill('A family phone shared between households.\n\nA village phone kept by the chief.');
  await section.getByLabel('What a reviewer should do').fill('Call the number.');
  await section.getByRole('button', { name: 'Save key' }).click();
  await expect(section.locator('.key')).toContainText('Flags when /phone (digits only) appears more than 2 times within 30 days, or appears again with a different /district.');
  expect(posted).toEqual({
    title: 'Phone number', explanation: 'A phone number usually belongs to one household.', nextStep: 'Call the number.', active: true,
    benignExplanations: ['A family phone shared between households.', 'A village phone kept by the chief.'],
    fields: [{ field: '/phone', match: 'digits' }], sameFields: ['/district'], maxUses: 2, windowDays: 30,
    ignoreValues: ['none', 'no phone'], minLength: 3
  });
  expect(errors).toEqual([]);
});

test('a stale key save is explained, and a key whose question was dropped says it is not run', async ({ page: p }) => {
  let puts = 0; let sent;
  const unusable = { ...householdKey, revision: 4, status: { usable: false, reason: 'missing-fields', missing: ['/old_code'] } };
  const errors = await api(p, managerVerbs, async (route, path) => {
    if (path === '/v1/projects/1/forms/household/identity-keys') { await route.fulfill({ json: [unusable] }); return true; }
    if (path === '/v1/projects/1/forms/household/identity-keys/key-1') {
      puts += 1;
      expect(route.request().headers()['if-match']).toBe('"key-4"');
      sent = route.request().postDataJSON();
      await route.fulfill({ status: 412, json: { code: 412.5, message: 'The identity key has changed. Reload it before saving.' } });
      return true;
    }
    if (path === '/v1/projects/1/forms/household/contradiction-rules') { await route.fulfill({ json: [] }); return true; }
    if (path === '/v1/projects/1/forms/household/integrity') { await route.fulfill({ json: [] }); return true; }
    return false;
  });
  await p.goto(`${appUrl}${page}`);
  const section = p.locator('.identity-keys');
  await expect(section).toContainText('Not run: the current Form version no longer has /old_code.');
  await section.getByRole('button', { name: 'Edit' }).click();
  await section.getByRole('button', { name: 'Save key' }).click();
  await expect(section.getByRole('alert')).toContainText('The identity key has changed. Reload it before saving.');
  expect(puts).toBe(1);
  // The stored key goes back as it was: no window stays no window.
  expect(sent).toMatchObject({ fields: householdKey.fields, sameFields: ['/district'], maxUses: 1, windowDays: null, ignoreValues: ['none'], minLength: 3, benignExplanations: ['A follow-up visit.'] });
  expect(errors).toEqual([]);
});

test('a reviewer sees reused and changed identities with the answers read from the Submissions', async ({ page: p }) => {
  const errors = await api(p, reviewerVerbs, async (route, path) => {
    if (path === '/v1/projects/1/forms/household/identity-keys') { await route.fulfill({ json: [householdKey] }); return true; }
    if (path === '/v1/projects/1/forms/household/contradiction-rules') { await route.fulfill({ json: [] }); return true; }
    if (path === '/v1/projects/1/forms/household/integrity') { await route.fulfill({ json: [reused, inconsistent] }); return true; }
    if (path === '/v1/projects/1/forms/household/integrity/run') {
      await route.fulfill({ json: { rule: 'implausible-travel', ruleVersion: 1, thresholds: { maxSpeedKmh: 120 }, examined: 3, collectors: 1, concerns: 0, inconclusive: 0, plausible: 0, withdrawn: 0,
        projectArea: { status: 'unusable', reason: 'no-area-set' }, encrypted: false, locationRules: [], contradictionRules: [],
        identityKeys: [
          { id: 'key-1', title: 'Household code', version: 1, status: { usable: true }, examined: 3, noKey: 1, distinct: 1, reused: 2, inconsistent: 1 },
          { id: 'key-2', title: 'Phone', version: 1, status: { usable: false, reason: 'encrypted-form' } }
        ] } });
      return true;
    }
    return false;
  });
  await p.goto(`${appUrl}${page}`);
  const keys = p.locator('.identity-keys');
  await expect(keys).toContainText('Household code');
  await expect(keys.getByRole('button', { name: 'Edit' })).toHaveCount(0);
  await expect(keys.getByRole('button', { name: 'New identity key' })).toHaveCount(0);

  const [first, second] = [p.locator('.finding').nth(0), p.locator('.finding').nth(1)];
  await expect(first).toContainText('Repeated identity: Household code');
  await expect(first).toContainText('3 Submissions share this key; 1 allowed.');
  await expect(first.locator('tbody tr')).toHaveCount(3);
  await expect(first.locator('tbody tr').nth(0)).toContainText('This one');
  await expect(first.locator('tbody tr').nth(0)).toContainText('wa0001');
  await expect(first.locator('tbody tr').nth(1)).toContainText('WA0001');
  // A deleted Submission's answers are not shown.
  await expect(first.locator('tbody tr').nth(2)).toContainText('Deleted; answers no longer shown');
  await expect(first).toContainText('A follow-up visit.');
  await expect(first.getByRole('link', { name: 'Open the earliest with this key' })).toHaveAttribute('href', /uuid%3Afirst/);

  await expect(second).toContainText('Changed details: Household code');
  await expect(second.locator('thead')).toContainText('/district');
  await expect(second.locator('tbody tr').nth(0)).toContainText('Kenema');
  await expect(second.locator('tbody tr').nth(1)).toContainText('Bo');

  await p.getByRole('button', { name: 'Run checks' }).click();
  const report = p.locator('.run-report');
  await expect(report).toContainText('Identity "Household code" v1: 2 used too often, 1 with changed answers, 1 without a usable key.');
  await expect(report).toContainText('Identity "Phone": not run, the Form is encrypted.');
  await p.setViewportSize({ width: 360, height: 800 });
  expect(await p.evaluate(() => document.documentElement.scrollWidth <= 360)).toBe(true);
  expect(errors).toEqual([]);
});
