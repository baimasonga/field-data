// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const http = require('node:http');
const { sql } = require('slonik');
const { storage } = require('../external/field-data-storage');
const { invalid } = require('../util/analysis-data');
const normalizePolicy = p => {
  const result = { version: 1, scheduledBackups: p.scheduledBackups === true, backupHour: Number(p.backupHour), retentionDays: Number(p.retentionDays), failAfter: Number(p.failAfter), staleHours: Number(p.staleHours) };
  for (const [key, min, max] of [['backupHour', 0, 23], ['retentionDays', 7, 365], ['failAfter', 1, 10], ['staleHours', 24, 168]]) if (!Number.isSafeInteger(result[key]) || result[key] < min || result[key] > max) throw invalid(key, p[key], `Use an integer from ${min} to ${max}.`);
  return result;
};
const compilerHealth = () => new Promise((resolve, reject) => {
  const req = http.get('http://127.0.0.1:5001/healthz', res => { res.resume(); res.on('end', () => (res.statusCode === 200 ? resolve() : reject(new Error('Compiler health check failed.')))); res.on('error', reject); });
  req.setTimeout(3000, () => req.destroy(new Error('Compiler timeout.'))); req.on('error', reject);
});
const probe = async (name, work, detail) => {
  const start = Date.now();
  try { await work(); return { name, status: 'healthy', latencyMs: Date.now() - start, detail }; } catch { return { name, status: 'failed', latencyMs: Date.now() - start, detail: `${name} probe failed. Use the operations runbook; no credentials are exposed here.` }; }
};
const nextState = (previous, check, threshold) => {
  const failures = check.status === 'failed' ? (previous?.failures || 0) + 1 : 0;
  const alert = check.status === 'failed' && failures >= threshold;
  const event = alert && !previous?.alert ? 'alert' : previous?.alert && check.status === 'healthy' ? 'recovery' : null;
  return { failures, alert, event };
};
const runOperations = async (db, dependencies = {}) => {
  const store = dependencies.storage || storage;
  const policyRow = await db.one(sql`select definition from field_data_operations_policy where id=1`); const policy = normalizePolicy(policyRow.definition);
  const checks = [await probe('database', () => db.oneFirst(sql`select 1`), 'Database connection and query succeeded.'), await probe('compiler', dependencies.compilerHealth || compilerHealth, 'Internal form compiler answered its health request.')];
  const marker = await db.maybeOne(sql`select "storageKey" from field_data_map_layers order by "updatedAt" desc limit 1`);
  if (marker) checks.push(await probe('storage', async () => {
    const stream = await store.getStream(marker.storageKey); const timer = setTimeout(() => stream.destroy(new Error('Storage read timeout.')), 3000);
    try { for await (const chunk of stream) { if (!chunk.length) throw new Error('Empty storage object.'); } } finally { clearTimeout(timer); stream.destroy(); }
  }, 'A saved reference-layer object was read successfully.'));
  else checks.push({ name: 'storage', status: 'unknown', latencyMs: null, detail: 'No reference-layer object is available for a read-only storage probe. Storage health is unverified.' });
  const backup = await db.maybeOne(sql`select "completedAt" from field_data_backups where status='Success' order by "completedAt" desc limit 1`);
  checks.push({ name: 'backups', status: backup && Date.now() - new Date(backup.completedAt).valueOf() < policy.staleHours * 3600000 ? 'healthy' : 'failed', latencyMs: null, detail: backup ? `Last successful encrypted database backup: ${new Date(backup.completedAt).toISOString()}. Object storage has a separate recovery plan.` : 'No successful encrypted database backup is recorded. Object storage has a separate recovery plan.' });
  for (const check of checks) {
    // eslint-disable-next-line no-await-in-loop
    await db.transaction(async c => {
      await c.query(sql`select pg_advisory_xact_lock(74131, hashtext(${check.name}))`);
      const previous = await c.maybeOne(sql`select * from field_data_operations_checks where name=${check.name}`); const state = nextState(previous, check, policy.failAfter);
      await c.query(sql`insert into field_data_operations_checks (name, status, "latencyMs", detail, failures, alert) values (${check.name}, ${check.status}, ${check.latencyMs}, ${check.detail}, ${state.failures}, ${state.alert}) on conflict (name) do update set status=excluded.status, "latencyMs"=excluded."latencyMs", detail=excluded.detail, failures=excluded.failures, alert=excluded.alert, "checkedAt"=clock_timestamp()`);
      if (state.event) await c.query(sql`insert into field_data_operations_events (name, kind, detail) values (${check.name}, ${state.event}, ${check.detail})`);
    });
  }
  const ready = typeof process.env.FIELD_DATA_BACKUP_PASSPHRASE === 'string' && process.env.FIELD_DATA_BACKUP_PASSPHRASE.length >= 16;
  if (policy.scheduledBackups && ready && new Date().getUTCHours() === policy.backupHour) {
    await db.transaction(async c => {
      await c.query(sql`select pg_advisory_xact_lock(74132, 1)`);
      await c.query(sql`insert into field_data_backups (type, size, status, "statusColor") select 'Scheduled', '—', 'Pending', 'info' where not exists (select 1 from field_data_backups where status in ('Pending', 'Running') or date > clock_timestamp() - interval '23 hours')`);
    });
  }
  const expired = await db.any(sql`select id, "storageKey" from field_data_backups where status='Success' and "completedAt" < clock_timestamp() - ${policy.retentionDays} * interval '1 day' and id <> (select id from field_data_backups where status='Success' order by "completedAt" desc limit 1)`);
  for (const item of expired) {
    // eslint-disable-next-line no-await-in-loop
    await store.delete(item.storageKey);
    // eslint-disable-next-line no-await-in-loop
    await db.query(sql`update field_data_backups set status='Expired', "storageKey"=null where id=${item.id} and status='Success'`);
  }
  const cleanup = await db.any(sql`select key from field_data_storage_cleanup where "createdAt" < clock_timestamp() - interval '1 hour' limit 50`);
  for (const row of cleanup) {
    // eslint-disable-next-line no-await-in-loop
    const referenced = await db.oneFirst(sql`select exists(select 1 from field_data_map_layers where "storageKey"=${row.key})`);
    if (!referenced) {
      // eslint-disable-next-line no-await-in-loop
      await store.delete(row.key);
      // eslint-disable-next-line no-await-in-loop
      await db.query(sql`delete from field_data_storage_cleanup where key=${row.key}`);
    }
  }
  await db.query(sql`delete from field_data_operations_events where "createdAt" < clock_timestamp() - interval '30 days'`);
  return checks;
};
module.exports = { runOperations, normalizePolicy, nextState, compilerHealth };
