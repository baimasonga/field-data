// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { createHash } = require('crypto');
const { sql } = require('slonik');
const { withDefaults } = require('../model/container');
const { Form } = require('../model/frames');
const { assigneesFor } = require('../resources/field-data-backchecks');
const { requestBackcheck, ALLOCATION_LOCK } = require('../util/backcheck-request');
const { choose } = require('../util/automatic-backchecks');
const { hashReviewAssignment } = require('../util/idempotency');
const { runRequestId } = require('../util/backcheck-sample');
const runPolicy = (db, formId, projectId, now) => db.transaction(async trx => {
  await trx.query(sql`SELECT pg_advisory_xact_lock(${ALLOCATION_LOCK}, ${projectId})`);
  const policy = await trx.maybeOne(sql`SELECT * FROM field_data_backcheck_allocation WHERE "formId" = ${formId} AND enabled FOR UPDATE`);
  if (policy == null) return;
  const container = withDefaults({ db: trx });
  const source = (await container.Forms.getByProjectAndNumericId(projectId, formId, Form.WithoutDef, Form.WithoutXml)).orNull();
  const target = policy.responseFormId == null ? null : (await container.Forms.getByProjectAndNumericId(projectId,
    policy.responseFormId, Form.PublishedVersion, Form.WithoutXml)).orNull();
  const actor = policy.configuredBy == null ? null : (await container.Actors.getById(policy.configuredBy)).orNull();
  const project = (await container.Projects.getById(projectId)).orNull();
  const active = await trx.oneFirst(sql`SELECT EXISTS (SELECT 1 FROM projects WHERE id = ${projectId} AND "deletedAt" IS NULL AND archived IS NOT TRUE)`);
  const allowed = active && project != null && source != null && target?.state === 'open' && actor != null
    && await container.Auth.can(actor, 'project.update', project)
    && await container.Auth.can(actor, 'submission.update', source)
    && await container.Auth.can(actor, 'submission.read', source) && await container.Auth.can(actor, 'submission.read', target);
  if (!allowed) {
    await trx.query(sql`UPDATE field_data_backcheck_allocation SET enabled = FALSE, report = ${JSON.stringify({ at: now.toISOString(),
      failure: 'The manager, source or response form is unavailable or no longer authorized. Automatic allocation paused.' })} WHERE "formId" = ${formId}`);
    return;
  }
  const report = { at: now.toISOString(), examined: 0, assigned: 0, noIndependentCollector: 0, atCapacity: 0, failure: null };
  const queue = async cursor => trx.any(sql`SELECT c.id FROM field_data_backcheck_sample_items i
    JOIN field_data_review_cases c ON c.id = i."caseId"
    JOIN field_data_claim_versions v ON v.id = c."claimVersionId"
    JOIN submission_defs sd ON sd.id = v."submissionDefId" AND sd.current
    JOIN submissions s ON s.id = sd."submissionId" AND s."formId" = ${formId} AND s."deletedAt" IS NULL AND NOT s.draft
    WHERE ((c.status = 'open' AND c."assignedTo" IS NULL) OR (c.status = 'in-review' AND c."assignedTo" = ${actor.id}))
      AND NOT EXISTS (SELECT 1 FROM field_data_backchecks b WHERE b."caseId" = c.id)
      ${cursor == null ? sql`` : sql`AND c.id > ${cursor}::uuid`} ORDER BY c.id LIMIT 100`);
  let cases = await queue(policy.lastCaseId);
  if (cases.length === 0 && policy.lastCaseId != null) cases = await queue(null);
  for (const { id } of cases) {
    // eslint-disable-next-line no-await-in-loop
    const c = await trx.maybeOne(sql`SELECT c.*, sd.current, s."deletedAt", s."instanceId" FROM field_data_review_cases c
      JOIN field_data_claim_versions v ON v.id = c."claimVersionId" JOIN submission_defs sd ON sd.id = v."submissionDefId"
      JOIN submissions s ON s.id = sd."submissionId" WHERE c.id = ${id} FOR UPDATE OF c`);
    if (c == null || !c.current || c.deletedAt != null || !['open', 'in-review'].includes(c.status)
      || (c.assignedTo != null && c.assignedTo !== actor.id)) continue; // eslint-disable-line no-continue
    // A manual request may have won before we acquired the case lock.
    // eslint-disable-next-line no-await-in-loop
    if (await trx.oneFirst(sql`SELECT EXISTS (SELECT 1 FROM field_data_backchecks WHERE "caseId" = ${id})`)) continue; // eslint-disable-line no-continue
    report.examined += 1;
    // eslint-disable-next-line no-await-in-loop
    const candidates = await assigneesFor(trx, projectId, target.acteeId, c.claimVersionId);
    const checker = choose(candidates, policy.settings);
    if (checker == null) {
      if (candidates.every(a => a.original)) report.noIndependentCollector += 1; else report.atCapacity += 1;
      continue; // eslint-disable-line no-continue
    }
    let { revision } = c;
    if (c.status === 'open') {
      // eslint-disable-next-line no-await-in-loop
      const assigned = await container.FieldDataReviews.assignToSelf({ caseId: id, revision, actorId: actor.id, projectId,
        formActeeId: source.acteeId, key: `auto-backcheck:${formId}:${id}`,
        requestHash: hashReviewAssignment({ caseId: id, revision, assignedTo: actor.id }) });
      revision = assigned.revision;
    }
    const dueAt = new Date(now.getTime() + policy.settings.dueDays * 86400000).toISOString();
    const question = `${policy.settings.question}\nSource submission: ${c.instanceId}`;
    const requestHash = createHash('sha256').update(JSON.stringify({ assignedTo: checker.id, question,
      dueAt, responseXmlFormId: target.xmlFormId })).digest('hex');
    // Stable UUID from case ID and a fixed epoch; one automatic request per case.
    // eslint-disable-next-line no-await-in-loop
    await requestBackcheck(trx, { caseId: id, claimVersionId: c.claimVersionId, projectId, formActeeId: source.acteeId,
      responseForm: target, reviewerId: actor.id, revision, requestId: runRequestId(id, '1970-01-01'), requestHash,
      assignedTo: checker.id, question, dueAt });
    report.assigned += 1;
  }
  await trx.query(sql`UPDATE field_data_backcheck_allocation SET report = ${JSON.stringify(report)},
    "lastCaseId" = ${cases.at(-1)?.id ?? null} WHERE "formId" = ${formId}`);
});
const runAllocations = async (db, now = new Date()) => {
  const policies = await db.any(sql`SELECT a."formId", f."projectId" FROM field_data_backcheck_allocation a
    JOIN forms f ON f.id = a."formId" WHERE a.enabled ORDER BY a."lastAttemptAt" NULLS FIRST, a."formId" LIMIT 20`);
  for (const policy of policies) {
    try {
      await runPolicy(db, policy.formId, policy.projectId, now); // eslint-disable-line no-await-in-loop
    } catch {
      // eslint-disable-next-line no-await-in-loop
      await db.query(sql`UPDATE field_data_backcheck_allocation SET report = ${JSON.stringify({ at: now.toISOString(),
        failure: 'Allocation could not complete. No partial assignments were kept; it will retry on the next tick.' })} WHERE "formId" = ${policy.formId}`);
    }
    // eslint-disable-next-line no-await-in-loop
    await db.query(sql`UPDATE field_data_backcheck_allocation SET "lastAttemptAt" = clock_timestamp() WHERE "formId" = ${policy.formId}`);
  }
};
module.exports = { runAllocations };
