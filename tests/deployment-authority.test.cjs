const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const repo = file => resolve(__dirname, '..', file);
const context = { FIELD_DATA_PUBLISH_AUTHORITY: 'github-actions', GITHUB_ACTIONS: 'true', GITHUB_WORKFLOW: 'Deploy Field Data',
  GITHUB_REPOSITORY: 'baimasonga/field-data', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: 'a'.repeat(40), GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1' };
test('only the authoritative main workflow may publish, for every commit and retry', async () => {
  const { authorizeDeployment } = await import('../cloudflare/authorize-deployment.mjs');
  assert.equal(authorizeDeployment(context), 'publication');
  assert.equal(authorizeDeployment({ ...context, GITHUB_SHA: 'b'.repeat(40), GITHUB_RUN_ATTEMPT: '2' }), 'publication');
  for (const key of Object.keys(context)) assert.throws(() => authorizeDeployment({ ...context, [key]: '' }), /restricted/);
  assert.throws(() => authorizeDeployment({ ...context, GITHUB_REF: 'refs/heads/feature' }), /restricted/);
});
test('competing Cloudflare automatic builds cannot publish either the same or a different commit', async () => {
  const { authorizeDeployment } = await import('../cloudflare/authorize-deployment.mjs');
  for (const commit of ['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)]) {
    assert.throws(() => authorizeDeployment({ WORKERS_CI: '1', CF_BUILD_ID: 'automatic', GITHUB_SHA: commit }), /restricted/);
  }
  assert.throws(() => authorizeDeployment({}), /restricted/);
});
test('validation is a dry run and the hook is wired into Wrangler and the deployment workflow', async () => {
  const { authorizeDeployment } = await import('../cloudflare/authorize-deployment.mjs');
  assert.equal(authorizeDeployment({ FIELD_DATA_DEPLOY_DRY_RUN: 'true' }), 'validation');
  const pkg = require('../package.json');
  assert.match(pkg.scripts.check, /FIELD_DATA_DEPLOY_DRY_RUN=true.*wrangler deploy --dry-run$/);
  assert.equal(pkg.scripts.deploy, 'wrangler deploy');
  assert.match(readFileSync(repo('wrangler.jsonc'), 'utf8'), /"build":\s*\{\s*"command": "node cloudflare\/authorize-deployment.mjs"/);
  const workflow = readFileSync(repo('.github/workflows/deploy-field-data.yml'), 'utf8');
  assert.match(workflow, /group: field-data-production/);
  assert.match(workflow, /FIELD_DATA_PUBLISH_AUTHORITY: github-actions/);
  assert.doesNotMatch(workflow, /wait-for-workers-build/);
});
