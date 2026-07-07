// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// Worker job that delivers outbound webhooks for the Field Data platform. When
// an audited event occurs whose action is in `webhookEvents` (wired up in
// jobs.js), every active webhook subscribed to that action — or subscribed to
// all events, i.e. an empty events array — receives an HTTP POST with the event
// payload. Delivery is best-effort: the outcome is recorded on the webhook row
// ("lastStatus") and a delivery failure never fails the underlying event.

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

// POSTs a JSON body to a URL, resolving to a short status string suitable for
// the field_data_webhooks."lastStatus" column. Never rejects.
const postJson = (urlStr, body) => new Promise((resolve) => {
  let settled = false;
  const settle = (value) => { if (!settled) { settled = true; resolve(value); } };
  try {
    const parsed = new URL(urlStr);
    const client = parsed.protocol === 'https:' ? https : http;
    const payload = Buffer.from(JSON.stringify(body));
    const req = client.request(urlStr, {
      method: 'POST',
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': payload.length,
        'User-Agent': 'FieldData-Webhook/1.0'
      }
    }, (res) => {
      // Drain the response so the socket can be freed.
      res.on('data', () => {});
      res.on('end', () => {
        settle((res.statusCode >= 200 && res.statusCode < 300)
          ? `Delivered (${res.statusCode})`
          : `Failed (${res.statusCode})`);
      });
    });
    req.on('error', () => settle('Failed (error)'));
    req.on('timeout', () => { req.destroy(); settle('Failed (timeout)'); });
    req.write(payload);
    req.end();
  } catch (err) {
    settle('Failed (invalid URL)');
  }
});

const dispatchWebhooks = async (container, event) => {
  const { all, run } = container;

  const webhooks = await all(sql`
    select id, url from field_data_webhooks
    where active = true
      and (
        jsonb_array_length(events) = 0
        or events @> ${JSON.stringify([event.action])}::jsonb
      )`);
  if (webhooks.length === 0) return;

  const body = {
    event: event.action,
    actorId: event.actorId,
    acteeId: event.acteeId,
    loggedAt: event.loggedAt,
    details: event.details
  };

  await Promise.all(webhooks.map(async (hook) => {
    const status = await postJson(hook.url, body);
    await run(sql`
      update field_data_webhooks
      set "lastStatus" = ${status.slice(0, 50)}
      where id = ${hook.id}`);
  }));
};

module.exports = { dispatchWebhooks, webhookEvents };
