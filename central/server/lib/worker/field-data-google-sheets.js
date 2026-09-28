// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

const { sql } = require('slonik');
const { getTarget, openConfig } = require('../util/rest-targets');
const { deliver, _googleSheetPayload: googleSheetPayload,
  _findSheetRow: findSheetRow,
  _appendWithVerification: appendWithVerification } = require('./webhooks');

const BATCH_SIZE = 10;

const accessToken = (outcome) => {
  if (!outcome.success) return null;
  try {
    const parsed = JSON.parse(outcome.responseBody);
    return typeof parsed.access_token === 'string' ? parsed.access_token : null;
  } catch (_) {
    return null;
  }
};

const refreshCounts = async (connection, syncId) => {
  const counts = await connection.one(sql`
    select count(*)::integer as total,
      count(*) filter (where status in ('Synced', 'Updated', 'Failed'))::integer as processed,
      count(*) filter (where status = 'Synced')::integer as synced,
      count(*) filter (where status = 'Updated')::integer as updated,
      count(*) filter (where status = 'Failed')::integer as failed,
      count(*) filter (where status = 'Pending')::integer as pending
    from field_data_google_sheet_sync_items where "syncId" = ${syncId}`);
  const finished = counts.pending === 0;
  const status = finished ? (counts.failed === 0 ? 'Success' : 'Partial') : 'Running';
  await connection.query(sql`
    update field_data_google_sheet_syncs
    set total=${counts.total}, processed=${counts.processed}, synced=${counts.synced},
      updated=${counts.updated}, failed=${counts.failed}, status=${status},
      "completedAt"=${finished ? new Date() : null}
    where id=${syncId} and status <> 'Cancelled'`);
};

const deliverItem = async (connection, job, item, target, config, token) => {
  if (item.submissionDefId == null) {
    return { success: false, statusCode: null, attempts: 0,
      error: 'Submission is no longer available.' };
  }
  const event = {
    action: 'submission.backfill',
    details: { submissionDefId: item.submissionDefId }
  };
  // A slonik connection answers to any(); the container the live dispatch path
  // uses answers to all(). Adapting here rather than hoping they match.
  const payload = await googleSheetPayload(s => connection.any(s), event, job);
  const found = await findSheetRow(target, config, token, payload.instanceId, { search: true });
  if (found.failure != null) return found.failure;
  const built = target.buildRequest(payload, config, { accessToken: token, lookup: found.lookup });
  const headers = {
    ...built.headers,
    'User-Agent': 'FieldData-Webhook/1.0',
    'X-FieldData-Event': event.action
  };
  const outcome = found.lookup.rowNumber == null
    ? await appendWithVerification(target, config, token, payload.instanceId,
      { ...built, headers })
    : await deliver(built.url, built.body, headers, built.method);
  return { ...outcome, updated: found.lookup.rowNumber != null };
};

// One invocation processes one small batch. Cron calls this every minute, so a
// large Form makes steady progress without holding a container indefinitely.
const runGoogleSheetSyncs = db => db.connect(async connection => {
  const locked = await connection.oneFirst(sql`
    select pg_try_advisory_lock(74123, hashtext(current_schema()))`);
  if (!locked) return;
  try {
    await connection.query(sql`
      update field_data_google_sheet_sync_items set status='Pending'
      where status='Running'`);
    await connection.query(sql`
      update field_data_google_sheet_syncs set status='Pending'
      where status='Running'`);
    const job = await connection.maybeOne(sql`
      select s.*, w.target, w.config, w."formId"
      from field_data_google_sheet_syncs s
      join field_data_webhooks w on w.id = s."webhookId"
      where s.status='Pending' order by s.id limit 1`);
    if (job == null) return;

    const target = getTarget(job.target);
    if (target?.submissionRows !== true) {
      await connection.query(sql`
        update field_data_google_sheet_syncs set status='Failed',
          "lastError"='Integration is not a Google Sheets target.',
          "completedAt"=clock_timestamp() where id=${job.id}`);
      return;
    }
    await connection.query(sql`
      update field_data_google_sheet_syncs set status='Running',
        "startedAt"=coalesce("startedAt", clock_timestamp()), "lastError"=null
      where id=${job.id}`);

    const items = await connection.any(sql`
      select i.id, sd.id as "submissionDefId"
      from field_data_google_sheet_sync_items i
      left join submissions s on s.id=i."submissionId" and s."deletedAt" is null and s.draft=false
      left join submission_defs sd on sd."submissionId"=s.id and sd.current=true
      where i."syncId"=${job.id} and i.status='Pending'
      order by i.id limit ${BATCH_SIZE}`);
    if (items.length === 0) {
      await refreshCounts(connection, job.id);
      return;
    }

    const config = openConfig(job.target, job.config);
    const tokenRequest = target.buildTokenRequest(config);
    const tokenOutcome = await deliver(tokenRequest.url, tokenRequest.body,
      tokenRequest.headers, tokenRequest.method);
    const token = accessToken(tokenOutcome);
    if (token == null) {
      const message = 'Google authorization expired; replace the refresh token.';
      await connection.query(sql`
        update field_data_google_sheet_syncs set status='Failed', "lastError"=${message},
          "completedAt"=clock_timestamp() where id=${job.id}`);
      await connection.query(sql`
        update field_data_webhooks set "lastStatus"=${`Failed (${message})`.slice(0, 50)}
        where id=${job.webhookId}`);
      return;
    }

    for (const item of items) {
      // Claim before external I/O. If the process dies, the next invocation
      // returns Running items to Pending and the instance-ID lookup makes the
      // retry idempotent.
      // eslint-disable-next-line no-await-in-loop
      await connection.query(sql`
        update field_data_google_sheet_sync_items set status='Running', attempts=attempts+1
        where id=${item.id}`);
      let outcome;
      try {
        // eslint-disable-next-line no-await-in-loop
        outcome = await deliverItem(connection, job, item, target, config, token);
      } catch (error) {
        outcome = { success: false, statusCode: null, attempts: 0, error: error.message };
      }
      const itemStatus = outcome.success ? (outcome.updated ? 'Updated' : 'Synced') : 'Failed';
      // eslint-disable-next-line no-await-in-loop
      await connection.query(sql`
        update field_data_google_sheet_sync_items set status=${itemStatus},
          error=${outcome.error}, "completedAt"=clock_timestamp() where id=${item.id}`);
      // eslint-disable-next-line no-await-in-loop
      await connection.query(sql`
        insert into field_data_webhook_deliveries
          ("webhookId", event, "statusCode", success, error, attempts)
        values (${job.webhookId}, 'submission.backfill', ${outcome.statusCode},
          ${outcome.success}, ${outcome.error}, ${outcome.attempts ?? 0})`);
    }
    await refreshCounts(connection, job.id);
  } finally {
    await connection.query(sql`select pg_advisory_unlock(74123, hashtext(current_schema()))`);
  }
});

module.exports = { runGoogleSheetSyncs, _deliverItem: deliverItem, BATCH_SIZE };
