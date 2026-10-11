// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
//
// Scheduled backcheck samples (O6): docs/field-intelligence/O6-scheduled-backcheck-samples.md
//
// Run by the operations runner. Each schedule whose period has ended gets one
// O3 sample of the submissions received in that period (or in every period
// missed), and a run record. A period is drawn at most once.

const { sql } = require('slonik');
const { createHash } = require('crypto');
const { dueRun, nextBoundaryAfter, runRequestId } = require('../util/backcheck-sample');
const { drawSample } = require('../resources/field-data-backcheck-samples');

const BATCH = 20;

const runSchedule = (db, scheduleId, now) => db.transaction(async (trx) => {
  // Skip a schedule another runner holds; read it again under the lock.
  const schedule = await trx.maybeOne(sql`SELECT b.*, f."acteeId", f."deletedAt" AS "formDeletedAt"
    FROM field_data_backcheck_schedules b JOIN forms f ON f.id = b."formId"
    WHERE b.id = ${scheduleId} AND b.enabled AND b."nextRunAt" <= ${now.toISOString()}
    FOR UPDATE OF b SKIP LOCKED`);
  if (schedule == null || schedule.formDeletedAt != null) return null;
  const run = dueRun(schedule, now);
  if (run == null) return null;
  const settings = {
    rate: schedule.rate, minPerCollector: schedule.minPerCollector,
    receivedFrom: run.periodStart.toISOString().slice(0, 10),
    receivedTo: new Date(run.periodEnd.getTime() - 1).toISOString().slice(0, 10),
    periodStart: run.periodStart.toISOString(), periodEnd: run.periodEnd.toISOString()
  };
  const requestHash = createHash('sha256').update(JSON.stringify(settings)).digest('hex');
  let outcome;
  try {
    // A failed draw rolls back to here and is recorded.
    const drawn = await trx.transaction((inner) => drawSample(inner, { id: schedule.formId, acteeId: schedule.acteeId }, {
      requestId: runRequestId(schedule.id, run.periodStart), settings, requestHash, actorId: null,
      window: { from: run.periodStart, until: run.periodEnd }, scheduleId: schedule.id, skipEmpty: true
    }));
    outcome = drawn.id == null
      ? { outcome: 'nothing-eligible', sampleId: null, eligible: 0, sampled: 0, error: null }
      : { outcome: 'drawn', sampleId: drawn.id, eligible: drawn.eligible ?? 0, sampled: drawn.sampled ?? 0, error: null };
  } catch (error) {
    const details = error?.problemDetails;
    const message = details?.count != null
      ? `${details.count} ${details.what} is more than the ${details.max} allowed; lower the rate or draw this period by hand.`
      : 'The sample could not be drawn.';
    outcome = { outcome: 'failed', sampleId: null, eligible: 0, sampled: 0, error: message.slice(0, 500) };
  }
  const record = await trx.maybeOne(sql`INSERT INTO field_data_backcheck_schedule_runs
      ("scheduleId", "periodStart", "periodEnd", periods, outcome, "sampleId", eligible, sampled, error)
    VALUES (${schedule.id}, ${run.periodStart.toISOString()}, ${run.periodEnd.toISOString()}, ${run.periods},
      ${outcome.outcome}, ${outcome.sampleId}, ${outcome.eligible}, ${outcome.sampled}, ${outcome.error})
    ON CONFLICT ("scheduleId", "periodStart") DO NOTHING RETURNING id`);
  await trx.query(sql`UPDATE field_data_backcheck_schedules
    SET "periodStart" = ${run.periodEnd.toISOString()},
      "nextRunAt" = ${nextBoundaryAfter(run.periodEnd, schedule.frequency).toISOString()}
    WHERE id = ${schedule.id}`);
  // A period already recorded (a repeated run) is not audited again.
  if (record != null) await trx.query(sql`INSERT INTO audits (action, "acteeId", details, "loggedAt", processed, failures)
    VALUES ('field_data.backcheck_schedule.run', ${schedule.acteeId},
      ${JSON.stringify({ scheduleId: schedule.id, periodStart: run.periodStart, periodEnd: run.periodEnd, outcome: outcome.outcome, sampleId: outcome.sampleId })},
      clock_timestamp(), clock_timestamp(), 0)`);
  return { scheduleId: schedule.id, ...run, ...outcome, recorded: record != null };
});

const runBackcheckSchedules = async (db, now = new Date()) => {
  const due = await db.any(sql`SELECT b.id FROM field_data_backcheck_schedules b
    JOIN forms f ON f.id = b."formId" AND f."deletedAt" IS NULL
    WHERE b.enabled AND b."nextRunAt" <= ${now.toISOString()}
    ORDER BY b."nextRunAt", b.id LIMIT ${BATCH}`);
  const results = [];
  // One schedule failing does not stop the others; it is retried next time.
  for (const { id } of due) {
    try {
      results.push(await runSchedule(db, id, now)); // eslint-disable-line no-await-in-loop
    } catch (error) {
      process.stderr.write(`Backcheck schedule ${id} could not run: ${error?.message ?? error}\n`);
    }
  }
  return results.filter((r) => r != null);
};

module.exports = { runBackcheckSchedules };
