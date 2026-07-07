// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// Worker job that delivers outbound webhooks for the Field Data platform. When
// an audited event occurs whose action is in `webhookEvents` (wired up in
// jobs.js), every active webhook subscribed to that action — or subscribed to
// all events, i.e. an empty events array — receives an HTTP POST with the event
// payload. When a webhook has a secret, the request carries an HMAC-SHA256
// signature of the raw body in the X-FieldData-Signature header so receivers
// can verify authenticity. Each attempt is recorded in
// field_data_webhook_deliveries and summarised on the webhook's "lastStatus".
// Delivery is best-effort: a failed or unreachable endpoint never fails the
// underlying event.

const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { sql } = require('slonik');

// The set of audit actions for which webhooks may be delivered. Listing an
// action here also makes it "actionable" (see Audit.actionableEvents), which is
// what causes the worker to pick the event up in the first place.
const webhookEvents = [
  'submission.create',
  'submission.update',
  'submission.update.version',
  'submission.delete',
  'entity.create',
  'entity.update.version',
  'entity.delete',
  'form.create',
  'form.update.publish',
  'form.delete',
  'project.create',
  'project.update',
  'dataset.create',
  'dataset.update',
  'user.create'
];

// POSTs a raw body to a URL with the given headers, resolving to a delivery
// outcome { statusCode, success, error }. Never rejects.
const deliver = (urlStr, rawBody, headers) => new Promise((resolve) => {
  let settled = false;
  const settle = (value) => { if (!settled) { settled = true; resolve(value); } };
  try {
    const parsed = new URL(urlStr);
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request(urlStr, { method: 'POST', timeout: 10000, headers }, (res) => {
      // Drain the response so the socket can be freed.
      res.on('data', () => {});
      res.on('end', () => {
        const success = res.statusCode >= 200 && res.statusCode < 300;
        settle({ statusCode: res.statusCode, success, error: success ? null : `HTTP ${res.statusCode}` });
      });
    });
    req.on('error', (err) => settle({ statusCode: null, success: false, error: err.message || 'request error' }));
    req.on('timeout', () => { req.destroy(); settle({ statusCode: null, success: false, error: 'timeout' }); });
    req.write(rawBody);
    req.end();
  } catch (err) {
    settle({ statusCode: null, success: false, error: 'invalid URL' });
  }
});

// A short human-readable status for the field_data_webhooks."lastStatus" column.
const statusLabel = (outcome) => (outcome.success
  ? `Delivered (${outcome.statusCode})`
  : `Failed (${outcome.statusCode != null ? outcome.statusCode : outcome.error})`).slice(0, 50);

const dispatchWebhooks = async (container, event) => {
  const { all, run } = container;

  const webhooks = await all(sql`
    select id, url, secret from field_data_webhooks
    where active = true
      and (
        jsonb_array_length(events) = 0
        or events @> ${JSON.stringify([event.action])}::jsonb
      )`);
  if (webhooks.length === 0) return;

  const payload = {
    event: event.action,
    actorId: event.actorId,
    acteeId: event.acteeId,
    loggedAt: event.loggedAt,
    details: event.details
  };
  const rawBody = Buffer.from(JSON.stringify(payload));

  await Promise.all(webhooks.map(async (hook) => {
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': rawBody.length,
      'User-Agent': 'FieldData-Webhook/1.0',
      'X-FieldData-Event': event.action
    };
    if (hook.secret != null && hook.secret !== '') {
      const signature = crypto.createHmac('sha256', hook.secret).update(rawBody).digest('hex');
      headers['X-FieldData-Signature'] = `sha256=${signature}`;
    }

    const outcome = await deliver(hook.url, rawBody, headers);

    await run(sql`
      update field_data_webhooks set "lastStatus" = ${statusLabel(outcome)} where id = ${hook.id}`);
    await run(sql`
      insert into field_data_webhook_deliveries ("webhookId", event, "statusCode", success, error)
      values (${hook.id}, ${event.action}, ${outcome.statusCode}, ${outcome.success}, ${outcome.error})`);
  }));
};

module.exports = { dispatchWebhooks, webhookEvents };
