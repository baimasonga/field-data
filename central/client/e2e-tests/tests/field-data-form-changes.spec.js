/* global localStorage */
// S3 version changes in the browser: docs/field-intelligence/S3-version-changes.md
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

const change = (effect, code, path, detail, fromPath = path) => ({ effect, code, path, fromPath, detail });
const report = (changes, from = { version: '1', hash: form.hash }) => {
  const summary = { meaning: 0, continuity: 0, population: 0, wording: 0, unchanged: 9 };
  for (const c of changes) summary[c.effect] += 1;
  return { changesVersion: 1, summary, changes, truncated: false, from, to: { version: '2', hash: draft.hash, draft: true } };
};
const withChanges = report([
  change('meaning', 'choice-relabelled', '/data/water', { value: 'tap', language: '', from: 'Public tap', to: 'Standpipe' }),
  change('meaning', 'repeat-changed', '/data/member/age', { from: null, to: 'member' }, '/data/age'),
  change('continuity', 'moved', '/data/member/age', { from: '/data/age', to: '/data/member/age' }, '/data/age'),
  change('continuity', 'added', '/data/phone', { kind: 'a question' }, null),
  change('population', 'constraint-changed', '/data/hh_size', { from: '.>=1', to: '.>=1 and .<=30' }),
  change('population', 'choices-added', '/data/water', { values: ['river', 'rain'] }),
  change('wording', 'label-changed', '/data/name', { language: 'French', from: 'Nom', to: 'Nom complet' })
]);
const api = async (page, changes, versions = [form]) => {
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
    if (pathname.endsWith('/changes')) { await changes(route, pathname); return; }
    // The form check on the same page finds nothing.
    if (pathname.endsWith('/doctor')) {
      await route.fulfill({ json: { doctorVersion: 1, findings: [], notChecked: [], summary: { questions: 9, expressions: 0, errors: 0, warnings: 0, notes: 0 } } });
      return;
    }
    const project = { id: 1, name: 'Synthetic', forms: 1, datasets: 0, archived: false, verbs };
    const base = '/v1/projects/1/forms/household';
    const json = pathname === '/v1/sessions/restore' ? { expiresAt: '2099-01-01T00:00:00Z', csrf: 'fixture' }
      : pathname === '/v1/users/current' ? { id: 1, displayName: 'Fixture', verbs: [], preferences: { site: {}, projects: {} } }
        : pathname === '/v1/projects' ? [project]
          : pathname === '/v1/projects/1' ? project
            : pathname === base ? form
              : pathname === `${base}/draft` ? draft
                : pathname === `${base}/versions` ? versions
                  : pathname.endsWith('.svc/Submissions') ? { value: [], '@odata.count': 0 }
                    : [];
    await route.fulfill({ json });
  });
  return { errors, calls };
};
const draftPage = `${appUrl}/projects/1/forms/household/draft`;

test('the Draft page lists the changes from the published version by effect, and the publish dialog counts those to meaning', async ({ page }) => {
  const { errors, calls } = await api(page, (route) => route.fulfill({ json: withChanges }));
  await page.goto(draftPage);
  const section = page.locator('#form-edit-changes');
  await expect(section).toContainText('compared with version “1”');
  await expect(section.locator('.changes-summary')).toContainText('2 changes to meaning · 2 added, removed or moved · 2 to who is asked or what is accepted · 1 to wording');
  await expect(section.locator('.changes-summary')).toContainText('(9 questions unchanged)');

  const meaning = section.locator('.changes-group.changes-meaning');
  await expect(meaning).toHaveAttribute('open', '');
  await expect(meaning.locator('.changes-item')).toHaveCount(2);
  await expect(meaning.locator('.changes-item').first()).toContainText('Choice relabelled');
  await expect(meaning.locator('.changes-item').first()).toContainText('Value “tap”: “Public tap” → “Standpipe”. The stored value is the same; what people saw is not.');
  await expect(meaning.locator('.changes-item').nth(1)).toContainText('Was collected once per submission; now in member.');
  const continuity = section.locator('.changes-group.changes-continuity');
  await expect(continuity).toContainText('Was /data/age; the export column is renamed.');
  await expect(continuity).toContainText('A question in this version only.');
  const population = section.locator('.changes-group.changes-population');
  await expect(population).toContainText('.>=1 → .>=1 and .<=30');
  await expect(population).toContainText('river, rain');
  // Wording is collapsed.
  const wording = section.locator('.changes-group.changes-wording');
  await expect(wording).not.toHaveAttribute('open', '');
  await expect(wording).toContainText('French: “Nom” → “Nom complet”');
  expect(calls.filter((c) => c === '/v1/projects/1/forms/household/draft/changes')).toHaveLength(1);

  await page.getByRole('button', { name: 'Publish Draft' }).click();
  const modal = page.locator('#form-draft-publish');
  await expect(modal.locator('.changes-warning')).toContainText('This Draft makes 2 changes that may change what answers mean');
  await expect(modal.locator('.changes-warning')).toContainText('You can still publish.');
  await expect(modal.getByRole('button', { name: 'Proceed' })).not.toHaveAttribute('aria-disabled', 'true');

  await page.setViewportSize({ width: 360, height: 800 });
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= 360)).toBe(true);
  expect(errors).toEqual([]);
});

test('a draft with no changes says so, compares again on request, and the publish dialog has no changes warning', async ({ page }) => {
  let count = 0;
  const { errors } = await api(page, (route) => { count += 1; return route.fulfill({ json: report([]) }); });
  await page.goto(draftPage);
  const section = page.locator('#form-edit-changes');
  await expect(section).toContainText('No changes to the data collected.');
  await expect(section.locator('.changes-group')).toHaveCount(0);
  await section.getByRole('button', { name: 'Compare again' }).click();
  await expect.poll(() => count).toBe(2);
  await page.getByRole('button', { name: 'Publish Draft' }).click();
  await expect(page.locator('#form-draft-publish .changes-warning')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a comparison that fails is explained and does not break the Draft page', async ({ page }) => {
  const { errors } = await api(page, (route) => route.fulfill({ status: 400, json: { code: 400.57, message: 'This form is too large for the form check (more than 5,000 questions or 5 MB), so it was not checked.' } }));
  await page.goto(draftPage);
  await expect(page.locator('#form-edit-changes').getByRole('alert')).toContainText('too large');
  await expect(page.getByRole('button', { name: 'Publish Draft' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('compare the draft with an earlier version without changing the publish warning', async ({ page }) => {
  const older = { ...form, version: '', hash: 'c'.repeat(32), publishedAt: '2026-09-01T00:00:00Z' };
  const historical = report([change('continuity', 'added', '/data/old', { kind: 'a question' }, null)], { version: '', hash: older.hash });
  const requested = [];
  const { errors } = await api(page, route => {
    const from = new URL(route.request().url()).searchParams.get('from'); requested.push(from);
    return route.fulfill({ json: from === '___' ? historical : withChanges });
  }, [form, older]);
  await page.goto(draftPage);
  const section = page.locator('#form-edit-changes');
  await expect(section.locator('.changes-summary')).toContainText('2 changes to meaning');
  await section.getByRole('button', { name: 'Choose an earlier version' }).click();
  await section.getByLabel('Compare with').selectOption('version:1');
  await expect(section.locator('.changes-summary')).toContainText('0 changes to meaning');
  await expect(section).toContainText('compared with version “(no version string)”');
  await expect(section).toContainText('/data/old'); expect(requested).toContain('___');
  await page.getByRole('button', { name: 'Publish Draft' }).click();
  await expect(page.locator('#form-draft-publish .changes-warning')).toContainText('2 changes');
  await page.keyboard.press('Escape');
  await section.getByLabel('Compare with').selectOption('current');
  await expect(section.locator('.changes-summary')).toContainText('2 changes to meaning');
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await section.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('a denied historical comparison clears its result and retains the current publish warning', async ({ page }) => {
  const older = { ...form, version: 'old', hash: 'c'.repeat(32), publishedAt: '2026-09-01T00:00:00Z' };
  await api(page, route => route.fulfill(new URL(route.request().url()).searchParams.has('from')
    ? { status: 403, json: { message: 'Access denied' } } : { json: withChanges }), [form, older]);
  await page.goto(draftPage); const section = page.locator('#form-edit-changes');
  await expect(section.locator('.changes-summary')).toBeVisible();
  await section.getByRole('button', { name: 'Choose an earlier version' }).click();
  await section.getByLabel('Compare with').selectOption('version:1');
  await expect(section.getByRole('alert')).toContainText('Access denied');
  await expect(section.locator('.changes-summary')).toHaveCount(0);
  await page.getByRole('button', { name: 'Publish Draft' }).click();
  await expect(page.locator('#form-draft-publish .changes-warning')).toContainText('2 changes');
});

test('historical comparison rejects a changed definition and clears old results', async ({ page }) => {
  const older = { ...form, version: 'old', hash: 'c'.repeat(32), publishedAt: '2026-09-01T00:00:00Z' };
  await api(page, route => route.fulfill({ json: new URL(route.request().url()).searchParams.has('from')
    ? report([], { version: 'old', hash: 'd'.repeat(32) }) : withChanges }), [form, older]);
  await page.goto(draftPage); const section = page.locator('#form-edit-changes');
  await expect(section.locator('.changes-summary')).toBeVisible();
  await section.getByRole('button', { name: 'Choose an earlier version' }).click();
  await section.getByLabel('Compare with').selectOption('version:1');
  await expect(section.getByRole('alert')).toContainText('form or published version changed');
  await expect(section.locator('.changes-summary')).toHaveCount(0);
});

test('a slow historical comparison cannot replace the newer selection', async ({ page }) => {
  const older = { ...form, version: 'old', hash: 'c'.repeat(32), publishedAt: '2026-09-01T00:00:00Z' };
  let release; const wait = new Promise(resolve => { release = resolve; }); let started = false;
  await api(page, async route => {
    if (new URL(route.request().url()).searchParams.has('from')) {
      started = true; await wait;
      await route.fulfill({ json: report([], { version: 'old', hash: older.hash }) });
    } else await route.fulfill({ json: withChanges });
  }, [form, older]);
  await page.goto(draftPage); const section = page.locator('#form-edit-changes');
  await expect(section.locator('.changes-summary')).toContainText('2 changes to meaning');
  await section.getByRole('button', { name: 'Choose an earlier version' }).click();
  await section.getByLabel('Compare with').selectOption('version:1');
  await expect.poll(() => started).toBe(true);
  await section.getByLabel('Compare with').selectOption('current');
  await expect(section.locator('.changes-summary')).toContainText('2 changes to meaning');
  const historicalResponse = page.waitForResponse(response => new URL(response.url()).searchParams.has('from'));
  release(); await historicalResponse; await expect(section.locator('.changes-summary')).toContainText('2 changes to meaning');
});
