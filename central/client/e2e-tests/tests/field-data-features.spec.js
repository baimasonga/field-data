import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
const appUrl = process.env.ODK_URL || 'http://127.0.0.1:8989';
const fields = [{ path: '/name', name: 'Name', type: 'string' }, { path: '/age', name: 'Age', type: 'int' }];
const definition = { version: 1, source: { kind: 'form', id: 1 }, columns: ['/name', '/age'], query: [], chart: null, geometry: null, tab: 'table' };
const result = name => ({ total: 1, fields, availableFields: fields, definition, rows: [{ instanceId: 'uuid:1', sourceForm: 'simple', data: { '/name': name, '/age': '42' } }], nextOffset: null, map: null });
const api = async (page, custom) => {
  await page.addInitScript(() => localStorage.setItem('sessionExpires', String(Date.now() + 3600000)));
  await page.route('**/client-config.json', r => r.fulfill({ json: {} }));
  await page.route('**/version.txt', r => r.fulfill({ body: 'fixture' }));
  await page.route('**/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (await custom(route, path)) return;
    const project = { id: 1, name: 'Synthetic', forms: 1, datasets: 0, archived: false, verbs: ['project.read','project.update','form.create','form.list','form.read','submission.list','submission.read','submission.create'] };
    const json = path === '/v1/sessions/restore' ? { expiresAt: '2099-01-01T00:00:00Z', csrf: 'fixture' }
      : path === '/v1/users/current' ? { id: 1, displayName: 'Fixture', verbs: ['project.create','backup.run','config.set'], preferences: { site: {}, projects: {} } }
        : path === '/v1/projects' ? [project] : path === '/v1/projects/1' ? project : [];
    await route.fulfill({ json });
  });
};
test('analysis ignores a late source response and restores a saved selection after reload', async ({ page }) => {
  let release; const wait = new Promise(resolve => { release = resolve; });
  await api(page, async (route, path) => {
    if (path.endsWith('/sources')) { await route.fulfill({ json: { forms: [{ id: 1, name: 'First' }, { id: 2, name: 'Second' }], filtered: [], merged: [] } }); return true; }
    if (path.endsWith('/views')) { await route.fulfill({ json: [{ id: 'saved', title: 'Saved selection', definition: { ...definition, source: { kind: 'form', id: 2 } }, revision: 1 }] }); return true; }
    if (path.endsWith('/query')) {
      const source = route.request().postDataJSON().source.id;
      if (source === 1) await wait;
      await route.fulfill({ json: result(source === 1 ? 'Old source' : 'Current source') }); return true;
    }
    return false;
  });
  await page.goto(`${appUrl}/field-data/analysis`); await page.getByLabel('Project', { exact: true }).selectOption('1');
  await page.getByLabel('Source', { exact: true }).selectOption('form:1');
  await page.getByLabel('Source', { exact: true }).selectOption('form:2');
  await expect(page.locator('#fd-analysis')).toContainText('Current source'); release();
  await expect(page.locator('#fd-analysis')).not.toContainText('Old source');
  await page.getByLabel('Saved view').selectOption('saved'); await page.reload();
  await expect(page.getByLabel('Source', { exact: true })).toHaveValue('form:2');
  await expect(page.locator('#fd-analysis')).toContainText('Current source');
});
test('analysis distinguishes failure from empty results and offers a retry', async ({ page }) => {
  let attempts = 0;
  await api(page, async (route, path) => {
    if (path.endsWith('/sources')) { await route.fulfill({ json: { forms: [{ id: 1, name: 'Survey' }], filtered: [], merged: [] } }); return true; }
    if (path.endsWith('/query')) { attempts += 1; await route.fulfill(attempts === 1 ? { status: 503, json: { message: 'Fixture unavailable' } } : { json: { ...result(''), total: 0, rows: [] } }); return true; } return false;
  });
  await page.goto(`${appUrl}/field-data/analysis`); await page.getByLabel('Project', { exact: true }).selectOption('1'); await page.getByLabel('Source', { exact: true }).selectOption('form:1');
  await expect(page.getByRole('alert')).toContainText('Fixture unavailable'); await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0); await expect(page.locator('#fd-analysis')).toContainText('0');
});
test('catalogue management loads project forms and displays approved public project metadata', async ({ page }) => {
  await api(page, async (route, path) => {
    if (path.endsWith('/sources')) { await route.fulfill({ json: { forms: [{ id: 1, name: 'Survey' }], filtered: [], merged: [] } }); return true; } return false;
  });
  await page.goto(`${appUrl}/field-data/catalog`); await page.getByLabel('Project', { exact: true }).selectOption('1');
  await expect(page.getByLabel('Published form')).toContainText('Survey');
  await expect(page.getByLabel('Public projectTitle')).toBeVisible();
});
test('advanced authoring flags references immediately and links compiler diagnostics', async ({ page }) => {
  await api(page, async (route, path) => {
    if (path.endsWith('/builder-definition')) { await route.fulfill({ json: { definition: { schemaVersion: 2, title: 'Logic', formId: 'logic', questions: [{ id: 'age', type: 'integer', name: 'age', label: 'Age', constraint: '. >= 0' }, { id: 'adult', type: 'calculate', name: 'adult', label: '', calculation: '${age} >= 18' }] } } }); return true; }
    if (path.endsWith('/form-builder/validate')) { await route.fulfill({ json: { valid: false, diagnostics: [{ questionId: 'age', path: '/age', message: 'Fixture compiler diagnostic' }] } }); return true; }
    return false;
  });
  await page.goto(`${appUrl}/projects/1/new-form`); await page.getByRole('tab', { name: 'Build a Form' }).click();
  await page.getByLabel('Advanced authoring').check(); await page.getByLabel('Reopen saved form ID').fill('logic'); await page.getByRole('button', { name: 'Load builder definition' }).click();
  await expect(page.getByRole('heading', { name: 'Expression dependencies' })).toBeVisible();
  await page.locator('#builder-question-age').getByLabel('Name', { exact: true }).fill('renamed');
  await expect(page.getByText('— missing: repair this reference before compiling')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Validate with compiler' })).toBeDisabled();
  await page.locator('#builder-question-age').getByLabel('Name', { exact: true }).fill('age');
  await page.getByRole('button', { name: 'Validate with compiler' }).click();
  await expect(page.getByText('Fixture compiler diagnostic')).toBeVisible();
  await page.getByRole('button', { name: '/age', exact: true }).click(); await expect(page.locator('#builder-question-age')).toBeFocused();
});
test('compiled advanced form enforces repeat constraints, calculates relevance and submits real answers', async ({ page }) => {
  const xml = readFileSync(new URL('../fixtures/advanced.xml', import.meta.url), 'utf8'); let submitted;
  await api(page, async (route, path) => {
    if (path.endsWith('/browser_acceptance.xml') || path.endsWith('/browser_acceptance/draft.xml')) { await route.fulfill({ contentType: 'text/xml', body: xml }); return true; }
    if (path.endsWith('/browser_acceptance')) { await route.fulfill({ json: { name: 'Browser acceptance', xmlFormId: 'browser_acceptance', projectId: 1, webformsEnabled: true, state: 'open', publishedAt: '2026-10-01T00:00:00Z' } }); return true; }
    if (path.endsWith('/browser_acceptance/submissions')) { submitted = route.request().postData(); await route.fulfill({ json: { instanceId: 'fixture' } }); return true; }
    return false;
  });
  await page.goto(`${appUrl}/projects/1/forms/browser_acceptance/submissions/new`);
  await page.getByLabel('North', { exact: true }).check();
  const ages = page.getByRole('spinbutton'); await expect(ages).toHaveCount(2);
  await ages.nth(0).pressSequentially('-1'); await ages.nth(1).pressSequentially('20');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  expect(submitted).toBeUndefined();
  await expect(page.getByText('Age must be nonnegative.')).toBeVisible();
  await ages.nth(0).press('ControlOrMeta+A'); await ages.nth(0).press('Backspace'); await ages.nth(0).pressSequentially('17'); await ages.nth(1).blur();
  await expect(page.getByRole('textbox')).toHaveCount(1);
  await page.getByRole('textbox').fill('Synthetic adult');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Form successfully sent!', exact: true })).toBeVisible();
  expect(submitted).toContain('<adult>0</adult>'); expect(submitted).toContain('<adult>1</adult>'); expect(submitted).toContain('Synthetic adult');
});

test('sidebar opens advanced form authoring through an editable project', async ({ page }) => {
  await api(page, async () => false);
  await page.goto(`${appUrl}/field-data/form-builder`);
  await expect(page.getByRole('link', { name: 'Form Builder', exact: true })).toBeVisible();
  await page.getByLabel('Project', { exact: true }).selectOption('1');
  await page.getByRole('link', { name: 'Open Advanced Form Builder' }).click();
  await expect(page).toHaveURL(/\/projects\/1\/new-form\?builder=advanced$/);
  await expect(page.locator('#form-builder')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Advanced authoring (groups, repeats, logic and translations)' })).toBeChecked();
});

test('builder explains missing creation permissions', async ({ page }) => {
  await api(page, async (route, path) => {
    if (path === '/v1/projects') { await route.fulfill({ json: [{ id: 1, name: 'Read only', verbs: ['project.read'] }] }); return true; }
    return false;
  });
  await page.goto(`${appUrl}/field-data/form-builder`);
  await expect(page.getByText('You need permission to create forms in a project. Ask a project manager for access.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open Advanced Form Builder' })).toHaveCount(0);
});

test('export jobs survive reload and explain an expired download on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await api(page, async (route, path) => {
    if (path.endsWith('/jobs')) { await route.fulfill({ json: [{ id: 'completed-job', format: 'sav', status: 'Success', completed: 5101, total: 5101, expiresAt: '2026-10-05' }] }); return true; }
    if (path.endsWith('/download')) { await route.fulfill({ status: 404, json: { code: 404.1, message: 'Expired' } }); return true; }
    return false;
  });
  await page.goto(`${appUrl}/field-data/analysis?project=1`);
  await page.getByLabel('Project', { exact: true }).selectOption('1');
  await expect(page.getByRole('region', { name: 'Export jobs' })).toContainText('5101/5101');
  await page.reload();
  await expect(page.getByRole('region', { name: 'Export jobs' })).toContainText('5101/5101');
  await page.getByRole('button', { name: 'Download export', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Download failed. Check expiry and current source permissions.');
});

test('map layer retry clears failure and reference properties remain inert text', async ({ page }) => {
  let attempts = 0;
  await page.route('**/*.tile.openstreetmap.org/**', route => route.abort());
  await api(page, async (route, path) => {
    if (path.endsWith('/sources')) { await route.fulfill({ json: { forms: [{ id: 1, name: 'Survey' }], filtered: [], merged: [] } }); return true; }
    if (path.endsWith('/query')) { await route.fulfill({ json: { ...result('Map'), map: { type: 'FeatureCollection', features: [] } } }); return true; }
    if (path.endsWith('/map-layers')) {
      attempts += 1;
      await route.fulfill(attempts === 1 ? { status: 503, json: { message: 'Unavailable' } } : { json: [{ id: 'reference', title: 'Synthetic reference', revision: 1,
        definition: { visible: true, attribution: 'Fixture', style: { mode: 'categorical', property: 'category', categories: [{ value: 'Known', color: '#137d92' }], missingColor: '#777777' } },
        data: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [-11.79, 8.46] }, properties: { category: '<img src=x onerror="window.injected=true">' } }] }
      }] }); return true;
    }
    return false;
  });
  await page.goto(`${appUrl}/field-data/analysis?project=1`);
  await page.getByLabel('Source', { exact: true }).selectOption('form:1');
  await page.getByRole('button', { name: 'map', exact: true }).click();
  await page.getByRole('button', { name: 'Retry reference layers' }).click();
  await expect(page.getByRole('button', { name: 'Retry reference layers' })).toHaveCount(0);
  await expect(page.getByLabel('Layer legend')).toContainText('Missing or unclassified');
  await page.getByText('Reference feature properties (table alternative)').click();
  await expect(page.locator('.reference-layer details')).toContainText('<img src=x');
  await page.locator('.leaflet-interactive').first().click();
  await expect(page.locator('.leaflet-popup-content')).toContainText('<img src=x');
  await expect(page.locator('.leaflet-popup-content img')).toHaveCount(0);
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
});
