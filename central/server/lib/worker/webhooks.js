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
const { resolveWebhookUrl } = require('../util/safe-webhook-url');
const { decryptSecret } = require('../util/field-data-secret');
const { getTarget, openConfig } = require('../util/rest-targets');
const { extractObject } = require('../util/filtered-datasets');

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
const deliverOnce = async (urlStr, rawBody, headers, method = 'POST') => {
  let resolved;
  try {
    resolved = await resolveWebhookUrl(urlStr, { allowPrivate: process.env.NODE_ENV === 'test' });
  } catch (error) {
    return { statusCode: null, success: false, error: error.message };
  }

  return new Promise((resolve) => {
    let settled = false;
    let deadline;
    const settle = (value) => {
      if (!settled) {
        settled = true;
        clearTimeout(deadline);
        resolve(value);
      }
    };
    try {
      const client = resolved.url.protocol === 'https:' ? https : http;
      const lookup = (hostname, options, callback) =>
        (options.all
          ? callback(null, [{ address: resolved.address, family: resolved.family }])
          : callback(null, resolved.address, resolved.family));
      const req = client.request(resolved.url, {
        method,
        timeout: 10000,
        headers,
        lookup
      }, (res) => {
        // OAuth and the Sheets lookup return small JSON documents the target
        // needs for its next request. Cap what is retained while still draining
        // the response so the socket is freed.
        const chunks = [];
        let retained = 0;
        res.on('data', (chunk) => {
          if (retained >= 1024 * 1024) return;
          const keep = chunk.subarray(0, (1024 * 1024) - retained);
          chunks.push(keep);
          retained += keep.length;
        });
        res.on('error', (error) => settle({ statusCode: null, success: false, error: error.message }));
        res.on('aborted', () => settle({ statusCode: null, success: false, error: 'response aborted' }));
        res.on('end', () => {
          const success = res.statusCode >= 200 && res.statusCode < 300;
          settle({
            statusCode: res.statusCode,
            success,
            error: success ? null : `HTTP ${res.statusCode}`,
            responseBody: Buffer.concat(chunks).toString('utf8')
          });
        });
      });
      req.on('error', (err) => settle({ statusCode: null, success: false, error: err.message || 'request error' }));
      req.on('timeout', () => { req.destroy(); settle({ statusCode: null, success: false, error: 'timeout' }); });
      deadline = setTimeout(() => {
        req.destroy();
        settle({ statusCode: null, success: false, error: 'delivery deadline exceeded' });
      }, 10000);
      if (rawBody != null) req.write(rawBody);
      req.end();
    } catch (err) {
      settle({ statusCode: null, success: false, error: 'invalid URL' });
    }
  });
};

const retryable = (outcome) => outcome.statusCode == null || outcome.statusCode === 408
  || outcome.statusCode === 429 || outcome.statusCode >= 500;
const pause = (milliseconds) => new Promise(resolve => { setTimeout(resolve, milliseconds); });
// `maxAttempts` exists so a caller can ask for exactly one try. A retry is
// safe for anything idempotent, and appending a spreadsheet row is not: see
// appendWithVerification below.
const deliver = async (url, rawBody, headers, method = 'POST', maxAttempts = 3) => {
  let outcome;
  let attempts = 0;
  for (const delay of [0, 250, 1000].slice(0, maxAttempts)) {
    // Retries are intentionally sequential and use bounded backoff.
    // eslint-disable-next-line no-await-in-loop
    if (delay !== 0 && process.env.NODE_ENV !== 'test') await pause(delay);
    attempts += 1;
    // eslint-disable-next-line no-await-in-loop
    outcome = await deliverOnce(url, rawBody, headers, method);
    if (outcome.success || !retryable(outcome)) break;
  }
  return { ...outcome, attempts };
};

const eachWithConcurrency = async (items, concurrency, callback) => {
  let index = 0;
  const worker = async () => {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      // Each worker is sequential; the worker pool bounds total concurrency.
      // eslint-disable-next-line no-await-in-loop
      await callback(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
};

// A short human-readable status for the field_data_webhooks."lastStatus" column.
const statusLabel = (outcome) => (outcome.success
  // An append whose response was lost but whose row is demonstrably in the
  // sheet. Said differently from an ordinary success, because the difference
  // is exactly what somebody reading the log would want to know.
  ? (outcome.verified === true ? 'Delivered (confirmed in sheet)' : `Delivered (${outcome.statusCode})`)
  : `Failed (${outcome.statusCode != null ? outcome.statusCode : outcome.error})`).slice(0, 50);

// Turn the audited Submission version into one stable spreadsheet row. Paths,
// rather than labels, are the headers: labels can repeat and can be translated,
// while an XML path identifies the answer unambiguously.
const googleSheetPayload = async ({ all }, event, hook) => {
  const submissionDefId = Number(event.details?.submissionDefId);
  if (!Number.isInteger(submissionDefId))
    throw new Error('This Submission event does not identify a version to synchronize.');

  // Through submission_defs."formDefId", which is the foreign key to
  // form_defs.id. A submission_defs id is not a form_defs id -- the two tables
  // have independent sequences -- so comparing one to the other matches only
  // where the numbers happen to coincide. They do for the very first
  // submission of a fresh deployment, and for nothing after it, which is how
  // this passed every test and would have failed in front of the first person
  // to use it twice.
  const fields = await all(sql`
    select ff.path
    from form_fields ff
    join submission_defs sd on sd.id = ${submissionDefId}
    join form_defs fd on fd.id = sd."formDefId" and fd."schemaId" = ff."schemaId"
    where ff."formId" = ${hook.formId}
      and coalesce(ff.binary, false) = false
      and ff.path ~ '^(/[A-Za-z_][A-Za-z0-9_.-]*)+$'
    order by ff."order", ff.path`);
  const paths = fields.map(field => field.path);
  if (paths.length === 0)
    throw new Error('The Form has no fields that can be synchronized.');
  const rows = await all(sql`
    select sd."instanceId", sd."createdAt", ${extractObject(paths)} as answers
    from submission_defs sd
    join submissions s on s.id = sd."submissionId" and s."formId" = ${hook.formId}
    where sd.id = ${submissionDefId} and s."deletedAt" is null`);
  if (rows.length !== 1) throw new Error('The Submission version no longer exists.');
  const submission = rows[0];
  return {
    instanceId: submission.instanceId,
    headers: ['_instance_id', '_submitted_at', '_event', ...paths],
    row: [submission.instanceId, submission.createdAt?.toISOString?.() ?? submission.createdAt,
      event.action, ...paths.map(path => submission.answers?.[path] ?? '')]
  };
};

/*
Find an instance ID's row, reading the column in bounded windows.

`search` is false when the integration does not synchronize updates. Then
every event is a new Submission with an instance ID the sheet has never seen,
so there is nothing to find: one small window answers the only question that
remains, which is whether the worksheet is empty and needs its header row.
That turns the common case from "fetch every ID ever written, on every
Submission" into a single-cell read.

When `search` is true the windows are walked until the ID turns up or the data
runs out. Walking is what keeps updates safe: the row number is re-derived
from the sheet each time rather than remembered, so somebody inserting a row
by hand cannot make a later update overwrite the wrong one.
*/
const findSheetRow = async (target, config, accessToken, instanceId, { search }) => {
  let offset = 0;
  let empty = false;
  for (;;) {
    const window = search
      ? { offset, limit: target.LOOKUP_BATCH }
      : { offset: 0, limit: 1 };
    const request = target.buildLookupRequest(config, accessToken, window);
    // eslint-disable-next-line no-await-in-loop
    const outcome = await deliver(request.url, request.body, request.headers, request.method);
    if (!outcome.success) return { failure: outcome };

    const batch = target.analyseLookup(outcome.responseBody, instanceId, window);
    if (offset === 0) empty = batch.empty;
    if (batch.rowNumber != null) return { lookup: { empty, rowNumber: batch.rowNumber } };
    if (!search || batch.exhausted || batch.scanned === 0)
      return { lookup: { empty, rowNumber: null } };
    offset += batch.scanned;
  }
};

/*
Append the row, and never append it twice.

A POST that appends is not idempotent. The delivery retry exists for lost
responses, and a lost response is exactly the case where Google may already
have committed the row -- so retrying blindly writes it a second time. The
lookup that would have caught a duplicate ran before the append, so it cannot.

Each retry therefore asks the sheet first. If the row is already there the
delivery is over and succeeded, whatever the connection did.
*/
const appendWithVerification = async (target, config, accessToken, instanceId, built) => {
  let outcome = await deliver(built.url, built.body, built.headers, built.method, 1);
  let attempts = outcome.attempts;

  for (let attempt = 1; attempt < 3 && !outcome.success && retryable(outcome); attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const check = await findSheetRow(target, config, accessToken, instanceId, { search: true });
    if (check.lookup?.rowNumber != null)
      return { ...outcome, success: true, verified: true, error: null, attempts };
    // Not there, so the append genuinely did not land and may be repeated.
    // eslint-disable-next-line no-await-in-loop
    outcome = await deliver(built.url, built.body, built.headers, built.method, 1);
    attempts += outcome.attempts;
  }
  return { ...outcome, attempts };
};

const googleAccessToken = (outcome) => {
  if (!outcome.success) return null;
  try {
    const parsed = JSON.parse(outcome.responseBody);
    return typeof parsed.access_token === 'string' ? parsed.access_token : null;
  } catch (_) {
    return null;
  }
};

const dispatchWebhooks = async (container, event) => {
  const { all, run } = container;

  const webhooks = await all(sql`
    select id, url, secret, target, config, "formId" from field_data_webhooks
    where active = true and jsonb_typeof(events) = 'array'
      and (
        (case when jsonb_typeof(events) = 'array' then jsonb_array_length(events) else null end) = 0
        or events @> ${JSON.stringify([event.action])}::jsonb
      )
      -- A null formId is the site-wide case and still fires for everything.
      -- A scoped service fires only for its own form, which for a submission
      -- event is the actee: Audits.log names the form, not the submission.
      and (
        "formId" is null
        or "formId" = (select id from forms where "acteeId" = ${event.acteeId ?? null})
      )`);
  if (webhooks.length === 0) return;

  const payload = {
    event: event.action,
    actorId: event.actorId,
    acteeId: event.acteeId,
    loggedAt: event.loggedAt,
    details: event.details
  };
  await eachWithConcurrency(webhooks, 5, async (hook) => {
    let outcome;
    try {
      // The target decides the body and its content type; everything else --
      // the signature, the retries, the delivery log -- stays the same for all
      // of them, which is the point of having one registry rather than one
      // delivery path per integration.
      const target = getTarget(hook.target);
      if (target == null)
        throw new Error(`Unknown delivery target "${hook.target}".`);
      const openedConfig = openConfig(hook.target, hook.config ?? {});
      let targetPayload = payload;
      let targetContext = {};

      if (target.submissionRows === true) {
        targetPayload = await googleSheetPayload(container, event, hook);
        const tokenRequest = target.buildTokenRequest(openedConfig);
        const tokenOutcome = await deliver(tokenRequest.url, tokenRequest.body,
          tokenRequest.headers, tokenRequest.method);
        const accessToken = googleAccessToken(tokenOutcome);
        if (accessToken == null) {
          outcome = {
            ...tokenOutcome,
            success: false,
            error: 'Google authorization expired; replace the refresh token.',
          };
        } else {
          // Searching is only ever needed for a new version of a Submission
          // the sheet already holds. An integration that does not synchronize
          // updates never has one, and a create carries an instance ID that is
          // new by construction -- ODK will not accept a second Submission
          // under an ID a Form already has. So the common path, a new
          // Submission arriving, reads one cell instead of every ID ever
          // written, and only an actual update walks the column.
          const found = await findSheetRow(target, openedConfig, accessToken,
            targetPayload.instanceId, {
              search: openedConfig.syncUpdates === true
                && event.action !== 'submission.create'
            });
          if (found.failure != null) outcome = found.failure;
          else targetContext = { accessToken, lookup: found.lookup };
        }
      }

      if (outcome != null) {
        // Token or lookup failure already carries the actionable result.
      } else {
        const built = target.buildRequest(targetPayload, openedConfig, targetContext);
        const rawBody = built.body;

        const headers = {
          ...built.headers,
          'User-Agent': 'FieldData-Webhook/1.0',
          'X-FieldData-Event': event.action
        };
        // Signed over the bytes actually sent, so a receiver verifies what it
        // got rather than what a JSON-shaped version of it would have been.
        if (hook.secret != null && hook.secret !== '') {
          const secret = decryptSecret(hook.secret);
          const signature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
          headers['X-FieldData-Signature'] = `sha256=${signature}`;
        }
        // An append is the one request here that cannot be retried blindly.
        outcome = (target.submissionRows === true && targetContext.lookup?.rowNumber == null)
          ? await appendWithVerification(target, openedConfig, targetContext.accessToken,
            targetPayload.instanceId, { ...built, headers, body: rawBody })
          : await deliver(built.url ?? hook.url, rawBody, headers, built.method);
      }
    } catch (error) {
      outcome = {
        statusCode: null,
        success: false,
        error: `Configuration error: ${error.message}`,
        attempts: 0
      };
    }

    await run(sql`
      update field_data_webhooks set "lastStatus" = ${statusLabel(outcome)} where id = ${hook.id}`);
    await run(sql`
      insert into field_data_webhook_deliveries
        ("webhookId", event, "statusCode", success, error, attempts)
      values (${hook.id}, ${event.action}, ${outcome.statusCode}, ${outcome.success},
        ${outcome.error}, ${outcome.attempts})`);
  });

  await run(sql`
    delete from field_data_webhook_deliveries
    where "createdAt" < clock_timestamp() - interval '30 days'`);
};

module.exports = {
  deliver, dispatchWebhooks, webhookEvents,
  // Exported for their own tests; not part of the worker's interface. The
  // two loops are target-agnostic, so a test drives them with a stub target
  // pointing at a local server rather than at Google.
  _googleSheetPayload: googleSheetPayload,
  _findSheetRow: findSheetRow,
  _appendWithVerification: appendWithVerification
};
