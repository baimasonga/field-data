const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runMonitor } = require('../tools/external-monitor.cjs');
test('external probes detect separate failures, deduplicate notifications and record recovery', async () => {
  const env = { FIELD_DATA_MONITOR_BASE_URL: 'https://example.org', FIELD_DATA_MONITOR_FAIL_AFTER: '2', FIELD_DATA_ALERT_DELIVERY_ENABLED: 'true', FIELD_DATA_ALERT_WEBHOOK_URL: 'https://alerts.example.org/hook' };
  let failed = true; const notifications = [];
  const send = async (url, options) => {
    if (url.startsWith('https://alerts.')) { notifications.push(JSON.parse(options.body)); return { status: 200, body: '' }; }
    if (url.endsWith('/v1/field-data/catalog')) return { status: 200, body: '[]' };
    return { status: failed ? 503 : 200, body: '<html></html>' };
  };
  let state = await runMonitor(env, {}, send); assert.equal(notifications.length,0);
  state = await runMonitor(env, state, send); assert.equal(notifications.length,1);
  state = await runMonitor(env, state, send); assert.equal(notifications.length,1);
  assert.equal(state.checks['authenticated-api'].status,'unknown');
  failed = false; state = await runMonitor(env, state, send);
  assert.equal(notifications.length,2); assert.equal(notifications[1].transition,'recovery');
});
test('monitor defaults to no notifications and removes its temporary authenticated session', async () => {
  const calls = [];
  const env = { FIELD_DATA_MONITOR_BASE_URL: 'https://example.org', FIELD_DATA_MONITOR_EMAIL: 'synthetic@example.org', FIELD_DATA_MONITOR_PASSWORD: 'fixture-only' };
  const state = await runMonitor(env, {}, async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET' });
    return { status: 200, body: url.endsWith('/v1/sessions') ? '{"token":"fixture-session"}' : url.endsWith('/v1/users/current') ? '{"id":1}' : url.endsWith('/v1/field-data/catalog') ? '[]' : '<html></html>' };
  });
  assert.equal(state.checks['authenticated-api'].status,'healthy');
  assert.ok(calls.some(c => c.method === 'DELETE' && c.url.endsWith('/v1/sessions/current')));
  assert.ok(!JSON.stringify(state).includes('fixture-session'));
});
test('monitor refuses an insecure origin before sending credentials', async () => {
  await assert.rejects(() => runMonitor({ FIELD_DATA_MONITOR_BASE_URL: 'http://localhost' }));
});

test('container preflight permits unset optional alert settings and preserves required database checks', () => {
  const { readFileSync } = require('node:fs');
  const { spawnSync } = require('node:child_process');
  const script = readFileSync(new URL('../cloudflare/entrypoint.sh', `file://${__filename}`), 'utf8').split('export DB_SSL=null')[0];
  const env = { PATH: process.env.PATH, DOMAIN: 'example.test', SYSADMIN_EMAIL: 'admin@example.test', PGHOST: 'database', PGPORT: '5432', PGDATABASE: 'test', PGUSER: 'test', PGPASSWORD: 'synthetic-only', SUPABASE_S3_ENDPOINT: 'https://example.test', SUPABASE_S3_ACCESS_KEY_ID: 'synthetic-only', SUPABASE_S3_SECRET_ACCESS_KEY: 'synthetic-only', SUPABASE_STORAGE_BUCKET: 'test', SUPABASE_REGION: 'test', FIELD_DATA_BACKUP_PASSPHRASE: 'synthetic-only', FIELD_DATA_WEBHOOK_ENCRYPTION_KEY: 'synthetic-only' };
  const valid = spawnSync('bash', ['-c', `${script}\ntest "$FIELD_DATA_ALERT_DELIVERY_ENABLED" = false\ntest -z "$FIELD_DATA_ALERT_WEBHOOK_URL"\ntest -z "$FIELD_DATA_ALERT_WEBHOOK_SECRET"`], { env });
  assert.equal(valid.status, 0, valid.stderr.toString());
  const invalid = spawnSync('bash', ['-c', script], { env: { ...env, PGHOST: '' } });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr.toString(), /PGHOST is missing/);
});
