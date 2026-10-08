const crypto = require('node:crypto');
const { sql } = require('slonik');
const { deliver } = require('./webhooks');
const runAlerts = async (db, dependencies = {}) => {
  const env = dependencies.env || process.env;
  if (env.FIELD_DATA_ALERT_DELIVERY_ENABLED !== 'true') return;
  const url = new URL(env.FIELD_DATA_ALERT_WEBHOOK_URL);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Use an HTTPS alert endpoint without URL credentials.');
  await db.connect(async c => {
    if (!await c.oneFirst(sql`select pg_try_advisory_lock(74137, hashtext(current_schema()))`)) return;
    try {
      const events = await c.any(sql`select * from field_data_operations_events where kind in ('alert','recovery') and "deliveredAt" is null and attempts<10 and ("lastAttemptAt" is null or "lastAttemptAt"<clock_timestamp()-interval '5 minutes') order by id limit 20`);
      for (const event of events) {
        const body = JSON.stringify({ id: String(event.id), service: event.name, transition: event.kind, detail: event.detail, at: event.createdAt });
        const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': `field-data-event-${event.id}` };
        if (env.FIELD_DATA_ALERT_WEBHOOK_SECRET) headers['X-FieldData-Signature'] = crypto.createHmac('sha256', env.FIELD_DATA_ALERT_WEBHOOK_SECRET).update(body).digest('hex');
        const outcome = await (dependencies.deliver || deliver)(url.href, body, headers, 'POST', 1); // eslint-disable-line no-await-in-loop
        await c.query(sql`update field_data_operations_events set attempts=attempts+1, "lastAttemptAt"=clock_timestamp(), "deliveredAt"=case when ${outcome.success} then clock_timestamp() else null end where id=${event.id}`); // eslint-disable-line no-await-in-loop
      }
    } finally { await c.query(sql`select pg_advisory_unlock(74137, hashtext(current_schema()))`); }
  });
};
module.exports = { runAlerts };
