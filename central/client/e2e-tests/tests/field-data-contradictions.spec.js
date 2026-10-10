/* global localStorage */
// F1 answer contradictions in the browser: docs/field-intelligence/F1-answer-contradictions.md
import { expect, test } from '@playwright/test';

const appUrl = process.env.ODK_URL || 'http://127.0.0.1:8989';
const managerVerbs = ['project.read', 'project.update', 'form.read', 'form.list', 'submission.list', 'submission.read', 'submission.update'];
const reviewerVerbs = managerVerbs.filter((v) => v !== 'project.update');

const fields = [
  { path: '/meta', name: 'meta', type: 'structure', binary: null, selectMultiple: null },
  { path: '/meta/instanceID', name: 'instanceID', type: 'string', binary: null, selectMultiple: null },
  // The current form version no longer asks about electricity (see fridgeRule).
  { path: '/assets', name: 'assets', type: 'string', binary: null, selectMultiple: true },
  { path: '/hh_size', name: 'hh_size', type: 'int', binary: null, selectMultiple: null },
  { path: '/adult_count', name: 'adult_count', type: 'int', binary: null, selectMultiple: null },
  { path: '/photo', name: 'photo', type: 'binary', binary: true, selectMultiple: null },
  { path: '/member', name: 'member', type: 'repeat', binary: null, selectMultiple: null },
  { path: '/member/age', name: 'age', type: 'int', binary: null, selectMultiple: null },
  { path: '/member/relation', name: 'relation', type: 'string', binary: null, selectMultiple: null }
];
const adultsRule = {
  id: 'rule-1', title: 'Adults in roster differ from adult count', version: 1, revision: 1, active: true,
  explanation: 'The roster lists a different number of adults.', benignExplanations: ['A member turned 18 recently.'],
  nextStep: 'Recount the roster.', status: { usable: true },
  conditions: [{ count: { repeat: '/member', where: [{ field: '/member/age', op: '>=', value: '18' }] }, op: '<>', otherField: '/adult_count' }]
};
const fridgeRule = {
  id: 'rule-2', title: 'No electricity but a fridge', version: 2, revision: 3, active: true,
  explanation: 'A household without electricity reports a fridge.', benignExplanations: ['Owned but not in use.'],
  nextStep: 'Ask whether it is used.', status: { usable: false, reason: 'missing-fields', missing: ['/electricity'] },
  conditions: [{ field: '/electricity', op: '=', value: 'none' }, { field: '/assets', op: 'selected', value: 'fridge' }]
};
const finding = {
  id: 9, rule: 'contradiction:rule-1', ruleVersion: 1, formId: 1, instanceId: 'uuid:bad', relatedInstanceId: null, outcome: 'concern',
  status: 'open', decision: null, note: null, decidedBy: null, decidedAt: null, createdAt: '2026-10-10T09:00:00Z',
  evidence: {
    ruleId: 'rule-1', title: adultsRule.title, explanation: adultsRule.explanation,
    alternatives: adultsRule.benignExplanations, nextStep: adultsRule.nextStep,
    conditions: [{ ...adultsRule.conditions[0], counted: 2, compareAnswer: '3' }, { field: '/electricity', op: '=', value: 'none', answer: null }]
  }
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

test('a manager writes a roster rule with the editor and the API receives exactly that rule', async ({ page: p }) => {
  const rules = [];
  let posted;
  const errors = await api(p, managerVerbs, async (route, path) => {
    if (path === '/v1/projects/1/forms/household/contradiction-rules') {
      if (route.request().method() === 'POST') {
        posted = route.request().postDataJSON();
        rules.push({ ...posted, id: 'rule-new', version: 1, revision: 1, status: { usable: true } });
        await route.fulfill({ status: 201, json: rules[0] }); return true;
      }
      await route.fulfill({ json: rules }); return true;
    }
    if (path === '/v1/projects/1/forms/household/integrity') { await route.fulfill({ json: [] }); return true; }
    return false;
  });
  await p.goto(`${appUrl}${page}`);
  const section = p.locator('.contradiction-rules');
  await expect(section).toContainText('No rules yet.');
  await section.getByRole('button', { name: 'New rule' }).click();
  await section.getByLabel('Title').fill('Adults in roster differ from adult count');
  await section.getByLabel('Condition 1 kind').selectOption('count');
  // Only top-level repeats, and only questions directly inside the chosen repeat.
  await section.getByLabel('Condition 1 repeat').selectOption('/member');
  await section.getByRole('button', { name: 'Only count entries where…' }).click();
  await expect(section.getByLabel('Condition 1 filter 1 question').locator('option')).toHaveText(['Choose a question', '/member/age', '/member/relation']);
  await section.getByLabel('Condition 1 filter 1 question').selectOption('/member/age');
  await section.getByLabel('Condition 1 test').first().selectOption('>=');
  await section.getByLabel('Condition 1 value').first().fill('18');
  await section.getByLabel('Condition 1 test').last().selectOption('<>');
  await section.getByLabel('Condition 1 compare with').selectOption('other');
  await section.getByLabel('Condition 1 other question').selectOption('/adult_count');
  await section.getByLabel('What the conflict means').fill('The roster lists a different number of adults.');
  await section.getByLabel(/Ordinary reasons/).fill('A member turned 18 recently.\n\nThe count was asked of a different person.');
  await section.getByLabel('What a reviewer should do').fill('Recount the roster.');
  await section.getByRole('button', { name: 'Save rule' }).click();
  await expect(section.locator('.rule')).toContainText('Flags when number of member entries where age is at least "18" is not adult_count.');
  expect(posted).toEqual({
    title: 'Adults in roster differ from adult count', explanation: 'The roster lists a different number of adults.',
    nextStep: 'Recount the roster.', active: true,
    benignExplanations: ['A member turned 18 recently.', 'The count was asked of a different person.'],
    conditions: [{ count: { repeat: '/member', where: [{ field: '/member/age', op: '>=', value: '18' }] }, op: '<>', otherField: '/adult_count' }]
  });
  expect(errors).toEqual([]);
});

test('the editor offers only tests that fit the question, and a stale save reloads the rule', async ({ page: p }) => {
  let puts = 0;
  const errors = await api(p, managerVerbs, async (route, path) => {
    if (path === '/v1/projects/1/forms/household/contradiction-rules') { await route.fulfill({ json: [fridgeRule] }); return true; }
    if (path === '/v1/projects/1/forms/household/contradiction-rules/rule-2') {
      puts += 1;
      expect(route.request().headers()['if-match']).toBe('"rule-3"');
      await route.fulfill({ status: 412, json: { code: 412.4, message: 'The contradiction rule has changed. Reload it before saving.' } });
      return true;
    }
    if (path === '/v1/projects/1/forms/household/integrity') { await route.fulfill({ json: [] }); return true; }
    return false;
  });
  await p.goto(`${appUrl}${page}`);
  const section = p.locator('.contradiction-rules');
  // A rule the current form cannot support says so instead of running quietly.
  await expect(section).toContainText('Not run: the current Form version no longer has /electricity.');
  await section.getByRole('button', { name: 'Edit' }).click();
  await expect(section.getByLabel('Condition 2 test').locator('option')).toHaveText(['includes', 'does not include', 'is blank', 'is answered']);
  // The dropped question cannot be chosen, so the rule cannot be saved until it is replaced.
  await expect(section.getByLabel('Condition 1 question')).toHaveValue('');
  await section.getByLabel('Condition 1 question').selectOption('/adult_count');
  await expect(section.getByLabel('Condition 1 test').locator('option'))
    .toHaveText(['is', 'is not', 'is more than', 'is less than', 'is at least', 'is at most', 'is blank', 'is answered']);
  // Switching to a number question offers ordering tests and resets an unsupported one.
  await section.getByLabel('Condition 2 question').selectOption('/hh_size');
  await expect(section.getByLabel('Condition 2 test')).toHaveValue('=');
  await expect(section.getByLabel('Condition 2 test').locator('option')).toContainText(['is more than']);
  await section.getByRole('button', { name: 'Save rule' }).click();
  await expect(section.getByRole('alert')).toContainText('The contradiction rule has changed. Reload it before saving.');
  expect(puts).toBe(1);
  expect(errors).toEqual([]);
});

test('a reviewer sees a contradiction finding with the answers behind it, and cannot edit rules', async ({ page: p }) => {
  const errors = await api(p, reviewerVerbs, async (route, path) => {
    if (path === '/v1/projects/1/forms/household/contradiction-rules') { await route.fulfill({ json: [adultsRule] }); return true; }
    if (path === '/v1/projects/1/forms/household/integrity') { await route.fulfill({ json: [finding] }); return true; }
    if (path === '/v1/projects/1/forms/household/integrity/run') {
      await route.fulfill({ json: { rule: 'implausible-travel', ruleVersion: 1, thresholds: { maxSpeedKmh: 120 }, examined: 3, collectors: 1, concerns: 0, inconclusive: 0, plausible: 0, withdrawn: 0,
        projectArea: { status: 'unusable', reason: 'no-area-set' }, encrypted: false, locationRules: [],
        contradictionRules: [
          { id: 'rule-1', title: adultsRule.title, version: 1, status: { usable: true }, examined: 3, matched: 1, notEvaluated: 1 },
          { id: 'rule-2', title: fridgeRule.title, version: 2, status: { usable: false, reason: 'missing-fields', missing: ['/electricity'] } }
        ] } });
      return true;
    }
    return false;
  });
  await p.goto(`${appUrl}${page}`);
  const section = p.locator('.contradiction-rules');
  await expect(section).toContainText(adultsRule.title);
  await expect(section.getByRole('button', { name: 'Edit' })).toHaveCount(0);
  await expect(section.getByRole('button', { name: 'New rule' })).toHaveCount(0);

  const item = p.locator('.finding');
  await expect(item).toContainText(`Contradiction: ${adultsRule.title}`);
  await expect(item).toContainText(adultsRule.explanation);
  await expect(item).toContainText('number of member entries where age is at least "18" is not adult_count');
  await expect(item).toContainText('counted 2 (compared with 3)');
  await expect(item).toContainText('(blank)');
  await expect(item).toContainText('A member turned 18 recently.');
  await expect(item).toContainText('Recount the roster.');

  await p.getByRole('button', { name: 'Run checks' }).click();
  const report = p.locator('.run-report');
  await expect(report).toContainText(`Contradiction "${adultsRule.title}" v1: 1 found, 1 could not be checked.`);
  await expect(report).toContainText(`Contradiction "${fridgeRule.title}": not run, the Form no longer has what it checks.`);
  await p.setViewportSize({ width: 360, height: 800 });
  expect(await p.evaluate(() => document.documentElement.scrollWidth <= 360)).toBe(true);
  expect(errors).toEqual([]);
});
