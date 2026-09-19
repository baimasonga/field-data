import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Evaluate the actual route configuration without loading Vue components.
// Only imported helpers/components are stubbed; preservation callbacks run as written.
const source = readFileSync(new URL('../central/client/apps/central/src/routes.js', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '')
  .replace('export default', 'return');
const createRoutes = new Function('always', 'equals', 'AccountLogin', 'Landing', 'AccountPage', 'AsyncRoute', 'routeProps', source)(
  value => () => value,
  (a, b) => JSON.stringify(a) === JSON.stringify(b),
  {}, {}, {}, {}, () => ({})
);
const resources = Object.fromEntries([
  'session', 'currentUser', 'config', 'centralVersion', 'analyticsConfig', 'roles',
  'serverConfig', 'project', 'form', 'dataset'
].map(name => [name, { name }]));
const routes = createRoutes({ i18n: { t: value => value }, requestData: resources, config: {} });
const byName = new Map();
function collect(list) {
  for (const route of list) {
    if (route.children) collect(route.children);
    else byName.set(route.name, route);
  }
}
collect(routes);
function preserves(toName, fromName, toParams, fromParams = toParams) {
  const to = { name: toName, params: toParams };
  const from = { name: fromName, params: fromParams };
  return byName.get(toName).meta.preserveData.map(fn => fn(to, from));
}
for (const names of [
  ['ProjectOverview', 'ProjectSummary', 'ProjectSettings'],
  ['FormSubmissions', 'SubmissionSummary', 'SubmissionPhotos', 'FormSettings']
]) {
  for (const from of names) for (const to of names) {
    test(`${from} → ${to} retains mounted page data`, () => {
      assert.ok(preserves(to, from, { projectId: '1', xmlFormId: 'survey' }).includes(true));
    });
  }
}
test('summary and photo navigation does not preserve all data across forms', () => {
  assert.ok(!preserves('SubmissionPhotos', 'SubmissionSummary',
    { projectId: '1', xmlFormId: 'b' }, { projectId: '1', xmlFormId: 'a' }).includes(true));
});
test('summary navigation across projects does not preserve the old project', () => {
  const results = preserves('ProjectSummary', 'ProjectOverview', { projectId: '2' }, { projectId: '1' });
  assert.ok(!results.includes(true));
  assert.ok(!results.some(value => Array.isArray(value) && value.includes(resources.project)));
});
