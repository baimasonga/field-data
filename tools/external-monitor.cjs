const https = require('node:https');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { resolveWebhookUrl } = require('../central/server/lib/util/safe-webhook-url');
const request = async (url, { method = 'GET', headers = {}, body } = {}) => {
  const resolved = await resolveWebhookUrl(url);
  if (resolved.url.protocol !== 'https:') throw new Error('HTTPS is required.');
  return new Promise((resolve, reject) => {
    const req = https.request(resolved.url, { method, headers, lookup: (host, options, cb) => options.all ? cb(null, [{ address: resolved.address, family: resolved.family }]) : cb(null, resolved.address, resolved.family) }, res => {
      let size = 0; const chunks = [];
      res.on('data', b => { size += b.length; if (size > 1024 * 1024) res.destroy(new Error('Response exceeds probe limit.')); else chunks.push(b); });
      res.on('error', reject); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    const deadline = setTimeout(() => req.destroy(new Error('Probe timeout.')), 10000);
    req.once('close', () => clearTimeout(deadline)); req.on('error', reject); req.end(body);
  });
};
const runMonitor = async (env, previous = {}, send = request) => {
  const base = new URL(env.FIELD_DATA_MONITOR_BASE_URL);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error('Configure an HTTPS application origin without credentials.');
  const checks = [];
  const probe = async (name, work) => { const start = Date.now(); try { await work(); checks.push({ name, status: 'healthy', latencyMs: Date.now() - start }); } catch { checks.push({ name, status: 'failed', latencyMs: Date.now() - start }); } };
  await probe('frontend', async () => { const r = await send(base.href); if (r.status !== 200 || !/<html\b/i.test(r.body)) throw new Error('Frontend failed.'); });
  await probe('public-api', async () => { const r = await send(new URL('/v1/field-data/catalog', base).href); if (r.status !== 200 || !Array.isArray(JSON.parse(r.body))) throw new Error('Public API failed.'); });
  if (env.FIELD_DATA_MONITOR_EMAIL && env.FIELD_DATA_MONITOR_PASSWORD) await probe('authenticated-api', async () => {
    const r = await send(new URL('/v1/sessions', base).href, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: env.FIELD_DATA_MONITOR_EMAIL, password: env.FIELD_DATA_MONITOR_PASSWORD }) });
    const session = JSON.parse(r.body); if (r.status !== 200 || !session.token) throw new Error('Authentication failed.');
    try {
      const user = await send(new URL('/v1/users/current', base).href, { headers: { Authorization: `Bearer ${session.token}` } });
      if (user.status !== 200 || !JSON.parse(user.body).id) throw new Error('Authenticated API failed.');
    } finally { await send(new URL('/v1/sessions/current', base).href, { method: 'DELETE', headers: { Authorization: `Bearer ${session.token}` } }); }
  });
  else checks.push({ name: 'authenticated-api', status: 'unknown', latencyMs: null });
  const state = { version: 1, checkedAt: new Date().toISOString(), checks: {}, events: (previous.events || []).filter(e => Date.now() - new Date(e.at).valueOf() < 86400000).slice(-50) };
  const threshold = Math.max(1, Math.min(10, Number(env.FIELD_DATA_MONITOR_FAIL_AFTER) || 3));
  for (const check of checks) {
    const before = previous.checks?.[check.name]; const failures = check.status === 'failed' ? (before?.failures || 0) + 1 : 0;
    const alert = check.status === 'unknown' ? Boolean(before?.alert) : check.status === 'failed' && failures >= threshold;
    if (alert && !before?.alert || before?.alert && check.status === 'healthy') state.events.push({ id: crypto.randomUUID(), service: check.name, transition: alert ? 'alert' : 'recovery', at: state.checkedAt, attempts: 0 });
    state.checks[check.name] = { ...check, failures, alert };
  }
  if (env.FIELD_DATA_ALERT_DELIVERY_ENABLED === 'true') {
    const url = new URL(env.FIELD_DATA_ALERT_WEBHOOK_URL); if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Configure an HTTPS recipient endpoint.');
    for (const event of state.events.filter(e => !e.deliveredAt && e.attempts < 10)) {
      const body = JSON.stringify(event); const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': event.id };
      if (env.FIELD_DATA_ALERT_WEBHOOK_SECRET) headers['X-FieldData-Signature'] = crypto.createHmac('sha256', env.FIELD_DATA_ALERT_WEBHOOK_SECRET).update(body).digest('hex');
      event.attempts += 1;
      try { const response = await send(url.href, { method: 'POST', body, headers }); if (response.status >= 200 && response.status < 300) event.deliveredAt = state.checkedAt; } catch { /* retry next run */ }
    }
  }
  return state;
};
const main = async () => {
  const file = process.env.FIELD_DATA_MONITOR_STATE_FILE || '/tmp/field-data-monitor-state.json'; let previous;
  try { previous = JSON.parse(await fs.readFile(file, 'utf8')); } catch { previous = {}; }
  const state = await runMonitor(process.env, previous);
  await fs.writeFile(`${file}.tmp`, JSON.stringify(state), { mode: 0o600 }); await fs.rename(`${file}.tmp`, file);
  for (const check of Object.values(state.checks)) process.stdout.write(`${check.name}: ${check.status}, latency ${check.latencyMs ?? 'unknown'} ms\n`);
  if (Object.values(state.checks).some(c => c.alert)) process.exitCode = 1;
};
if (require.main === module) main().catch(() => { process.stderr.write('External monitoring failed; check network and secure configuration.\n'); process.exitCode = 1; });
module.exports = { runMonitor, request };
