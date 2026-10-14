const { test } = require('node:test');
const assert = require('node:assert/strict');
const commit = 'a'.repeat(40);
const cfg = { repository: 'owner/repository', commit, token: 'test-only-read-access' };
let nextCheckId = 1;
const check = (status, extra = {}) => ({ id: nextCheckId += 1, app: { slug: 'cloudflare-workers-and-pages' }, name: 'Workers Builds: field-data', head_sha: commit, status, ...extra });
const reply = (checks, more = false) => Response.json({ check_runs: checks }, { headers: more ? { link: '<https://api.github.com/next>; rel="next"' } : {} });
test('waits for pending registration and active automatic builds on the exact commit', async () => {
  const { waitForWorkersBuild } = await import('../cloudflare/wait-for-workers-build.mjs');
  let calls = 0; let pauses = 0;
  const result = await waitForWorkersBuild({ ...cfg, pause: async () => { pauses += 1; }, fetcher: async (url, options) => {
    assert.ok(url.includes(`/commits/${commit}/check-runs?filter=all`)); assert.equal(options.headers.Authorization, `Bearer ${cfg.token}`);
    calls += 1; return reply(calls === 1 ? [] : [check(calls === 2 ? 'in_progress' : 'completed')]);
  } });
  assert.equal(calls, 3); assert.equal(pauses, 2); assert.equal(result.completed, 1);
});
test('requires every matching build to finish, including a paginated build', async () => {
  const { waitForWorkersBuild } = await import('../cloudflare/wait-for-workers-build.mjs'); let passes = 0;
  const result = await waitForWorkersBuild({ ...cfg, pause: async () => { passes += 1; }, fetcher: async url => {
    if (url.endsWith('page=1')) return reply([check('completed')], true);
    return reply([check(passes === 0 ? 'queued' : 'completed')]);
  } });
  assert.equal(result.completed, 2); assert.equal(passes, 1);
});
test('a failed automatic build is terminal and permits the independently validated deployment', async () => {
  const { waitForWorkersBuild } = await import('../cloudflare/wait-for-workers-build.mjs');
  assert.equal((await waitForWorkersBuild({ ...cfg, fetcher: async () => reply([check('completed', { conclusion: 'failure' })]) })).completed, 1);
});
test('ignores other publishers, worker names and commits and stops when status cannot be confirmed', async () => {
  const { waitForWorkersBuild } = await import('../cloudflare/wait-for-workers-build.mjs');
  const unrelated = [check('completed', { head_sha: 'b'.repeat(40) }), check('completed', { app: { slug: 'github-actions' } }), check('completed', { name: 'Workers Builds: another-worker' })];
  await assert.rejects(waitForWorkersBuild({ ...cfg, timeoutMs: 0, fetcher: async () => reply(unrelated) }), /terminal state/);
  await assert.rejects(waitForWorkersBuild({ ...cfg, fetcher: async () => new Response('', { status: 403 }) }), /HTTP 403/);
  await assert.rejects(waitForWorkersBuild({ ...cfg, fetcher: async () => Response.json({}) }), /Invalid/);
  await assert.rejects(waitForWorkersBuild({ ...cfg, fetcher: async () => { throw new Error('Network failed'); } }), /Network failed/);
  await assert.rejects(waitForWorkersBuild({ ...cfg, commit: 'wrong' }), /exact commit/);
});
test('times out on an active build and rejects incomplete pagination', async () => {
  const { waitForWorkersBuild } = await import('../cloudflare/wait-for-workers-build.mjs');
  await assert.rejects(waitForWorkersBuild({ ...cfg, timeoutMs: 0, fetcher: async () => reply([check('in_progress')]) }), /terminal state/);
  await assert.rejects(waitForWorkersBuild({ ...cfg, fetcher: async () => reply([], true) }), /pagination/);
});

test('a newer terminal check supersedes only the same external Cloudflare build', async () => {
  const { waitForWorkersBuild } = await import('../cloudflare/wait-for-workers-build.mjs');
  const rows = [check('completed', { id: 12, external_id: 'one-build' }), check('in_progress', { id: 11, external_id: 'one-build' })];
  assert.equal((await waitForWorkersBuild({ ...cfg, timeoutMs: 0, fetcher: async () => reply(rows) })).completed, 1);
  await assert.rejects(waitForWorkersBuild({ ...cfg, timeoutMs: 0, fetcher: async () => reply([...rows, check('in_progress', { external_id: 'another-build' })]) }), /terminal state/);
  await assert.rejects(waitForWorkersBuild({ ...cfg, timeoutMs: 0, fetcher: async () => reply([check('completed', { id: null })]) }), /identity/);
});
