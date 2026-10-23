// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
//
// Scheduled backcheck samples (O6): docs/field-intelligence/O6-scheduled-backcheck-samples.md
//
// One schedule per form. The operations runner draws each ended period's
// sample (lib/worker/field-data-backcheck-schedules.js); these routes read
// and set the schedule.

const { sql } = require('slonik');
const { Form } = require('../model/frames');
const Problem = require('../util/problem');
const { getOrNotFound } = require('../util/promise');
const { groupingAvailable } = require('./field-data-backcheck-samples');
const { validateSchedule, nextBoundaryAfter } = require('../util/backcheck-sample');

const formFor = async (container, auth, params, verbs) => {
  const form = await container.Forms
    .getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.WithoutDef, Form.WithoutXml)
    .then(getOrNotFound);
  for (const verb of verbs) await auth.canOrReject(verb, form); // eslint-disable-line no-await-in-loop
  return form;
};

const view = async (db, formId) => {
  const schedule = await db.maybeOne(sql`SELECT b.id, b.rate, b."minPerCollector", b.frequency, b.enabled, b."groupField", b."groupRates",
      b."periodStart", b."nextRunAt", b."updatedAt", a."displayName" AS "updatedByName"
    FROM field_data_backcheck_schedules b LEFT JOIN actors a ON a.id = b."updatedBy" WHERE b."formId" = ${formId}`);
  if (schedule == null) return { schedule: null, runs: [] };
  const runs = await db.any(sql`SELECT "periodStart", "periodEnd", periods, outcome, "sampleId", eligible, sampled, error, "ranAt"
    FROM field_data_backcheck_schedule_runs WHERE "scheduleId" = ${schedule.id} ORDER BY "periodStart" DESC LIMIT 20`);
  const { id, groupField, groupRates, ...rest } = schedule;
  return { schedule: { ...rest, nextRunAt: rest.enabled ? rest.nextRunAt : null, ...(groupField == null ? {} : { groupField }), ...(groupRates?.length ? { groupRates } : {}) }, runs };
};

module.exports = (service, endpoint) => {
  const base = '/projects/:projectId/forms/:xmlFormId/backcheck-schedule';

  service.get(base, endpoint(async (container, { params, auth }, _, response) => {
    const form = await formFor(container, auth, params, ['submission.list', 'submission.read']);
    response.set('Cache-Control', 'private, no-store');
    return view(container.db, form.id);
  }));

  service.put(base, endpoint(async (container, { params, auth, body }, _, response) => {
    const form = await formFor(container, auth, params, ['submission.update']);
    const { schedule, error } = validateSchedule(body);
    if (error != null) throw Problem.user.backcheckSampleInvalid(error);
    if (schedule.enabled && schedule.groupField) {
      await auth.canOrReject('submission.read', form);
      await auth.canOrReject('submission.list', form);
      if (!await groupingAvailable(container, params.projectId, params.xmlFormId, schedule.groupField))
        throw Problem.user.backcheckSampleInvalid({ field: 'groupField', reason: 'must name a supported question in an unencrypted published form' });
    }
    const actorId = auth.actor.map((actor) => actor.id).orNull();
    await container.transacting(async ({ db }) => {
      const now = await db.oneFirst(sql`SELECT clock_timestamp()`);
      const current = await db.maybeOne(sql`SELECT * FROM field_data_backcheck_schedules WHERE "formId" = ${form.id} FOR UPDATE`);
      // Turning a schedule on starts a new first period now; a change of
      // frequency applies from the next period; other changes keep the period.
      const restart = current == null || (!current.enabled && schedule.enabled);
      const periodStart = restart ? now : current.periodStart;
      const nextRunAt = restart || current.frequency !== schedule.frequency
        ? nextBoundaryAfter(new Date(now), schedule.frequency) : current.nextRunAt;
      await db.query(sql`INSERT INTO field_data_backcheck_schedules
          ("formId", rate, "minPerCollector", frequency, enabled, "groupField", "groupRates", "periodStart", "nextRunAt", "updatedBy", "updatedAt")
        VALUES (${form.id}, ${schedule.rate}, ${schedule.minPerCollector}, ${schedule.frequency}, ${schedule.enabled}, ${schedule.groupField ?? null}, ${schedule.groupRates ? JSON.stringify(schedule.groupRates) : null},
          ${new Date(periodStart).toISOString()}, ${new Date(nextRunAt).toISOString()}, ${actorId}, clock_timestamp())
        ON CONFLICT ("formId") DO UPDATE SET rate = EXCLUDED.rate, "minPerCollector" = EXCLUDED."minPerCollector",
          frequency = EXCLUDED.frequency, enabled = EXCLUDED.enabled, "groupField" = EXCLUDED."groupField", "groupRates" = EXCLUDED."groupRates", "periodStart" = EXCLUDED."periodStart",
          "nextRunAt" = EXCLUDED."nextRunAt", "updatedBy" = EXCLUDED."updatedBy", "updatedAt" = EXCLUDED."updatedAt"`);
      await db.query(sql`INSERT INTO audits ("actorId", action, "acteeId", details, "loggedAt", processed, failures)
        VALUES (${actorId}, 'field_data.backcheck_schedule.update', ${form.acteeId}, ${JSON.stringify(schedule)},
          clock_timestamp(), NULL, 0)`);
    });
    response.set('Cache-Control', 'private, no-store');
    return view(container.db, form.id);
  }));
};
