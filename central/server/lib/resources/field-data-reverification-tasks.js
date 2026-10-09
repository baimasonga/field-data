// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { createHash } = require('crypto');
const { sql } = require('slonik');
const { Form } = require('../model/frames');
const { UUID_PATTERN } = require('../util/claim-versioning');
const { getOrNotFound } = require('../util/promise');
const Problem = require('../util/problem');
const { timestamp } = require('../util/asset-freshness');

const STATUSES = ['queued', 'dispatched', 'closed', 'cancelled', 'superseded'];
const REASON_CODES = ['access-blocked', 'safety', 'asset-removed', 'duplicate', 'other'];
const invalid = () => Problem.user.assetInvalid();
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const exactKeys = (body, keys) => body != null && typeof body === 'object' && !Array.isArray(body)
  && Object.keys(body).every(key => keys.includes(key));
const US_UTC = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"';

const scope = async (container, auth, params, edit = false) => {
  if (!/^[1-9]\d*$/.test(params.projectId) || !Number.isSafeInteger(Number(params.projectId))) throw Problem.user.notFound();
  const project = await container.Projects.getById(Number(params.projectId)).then(getOrNotFound);
  try { await auth.canOrReject(edit ? 'project.update' : 'project.read', project); } catch (error) {
    if (error?.problemCode === Problem.user.insufficientRights.code) throw Problem.user.notFound();
    throw error;
  }
  return project;
};
const formFor = async (container, auth, projectId, xmlFormId) => {
  const form = await container.Forms.getByProjectAndXmlFormId(projectId, xmlFormId,
    Form.WithoutDef, Form.WithoutXml).then(getOrNotFound);
  try { await auth.canOrReject('submission.read', form); } catch (error) {
    if (error?.problemCode === Problem.user.insufficientRights.code) throw Problem.user.notFound();
    throw error;
  }
  return form;
};

const taskColumns = sql`t.*, o."assetId", o.predicate, o.sequence AS "observationSequence",
  a.name AS "assetName", a."externalId", a."assetType", a."formId", a."projectId", f."xmlFormId",
  asg."displayName" AS "assigneeName"`;
const taskJoins = sql`FROM field_data_reverification_tasks t
  JOIN field_data_asset_observations o ON o.id = t."observationId"
  JOIN field_data_assets a ON a.id = o."assetId"
  JOIN forms f ON f.id = a."formId" AND f."deletedAt" IS NULL
  LEFT JOIN actors asg ON asg.id = t."assigneeId"`;

const present = (row, now = new Date()) => ({
  id: row.id, status: row.status, revision: row.revision, reason: row.reason,
  dueAt: row.dueAt, visitBy: row.visitBy, dispatchedAt: row.dispatchedAt, closedAt: row.closedAt,
  createdAt: row.createdAt, supersededAt: row.supersededAt,
  closureObservationId: row.closureObservationId,
  assetId: row.assetId, assetName: row.assetName, externalId: row.externalId, assetType: row.assetType,
  predicate: row.predicate, xmlFormId: row.xmlFormId,
  assignee: row.assigneeId == null ? null : { id: row.assigneeId, displayName: row.assigneeName },
  overdue: row.status === 'dispatched' && row.visitBy != null && new Date(row.visitBy) < now
});

// The forms in this project that hold tasks and that the caller may read. Access
// is resolved first and applied in SQL, so pages stay full and counts only ever
// describe work the caller is allowed to see, rather than hiding rows after the fact.
const readableFormIds = async (container, auth, projectId) => {
  const forms = await container.db.any(sql`SELECT DISTINCT a."formId", f."xmlFormId"
    FROM field_data_reverification_tasks t
    JOIN field_data_asset_observations o ON o.id = t."observationId"
    JOIN field_data_assets a ON a.id = o."assetId"
    JOIN forms f ON f.id = a."formId" AND f."deletedAt" IS NULL
    WHERE a."projectId" = ${projectId}`);
  const checked = await Promise.all(forms.map(async ({ formId, xmlFormId }) => {
    try { await formFor(container, auth, projectId, xmlFormId); return formId; } catch (error) {
      if (error?.problemCode === Problem.user.notFound.code) return null;
      throw error;
    }
  }));
  return checked.filter(formId => formId != null);
};
// Dispatched, with a deadline that has passed. Derived, never stored.
const OVERDUE = sql`t.status = 'dispatched' AND t."visitBy" IS NOT NULL AND t."visitBy" < clock_timestamp()`;

const taskFor = async (container, auth, params) => {
  if (!UUID_PATTERN.test(params.taskId)) throw Problem.user.notFound();
  const [task] = await container.db.any(sql`SELECT ${taskColumns} ${taskJoins}
    WHERE t.id = ${params.taskId} AND a."projectId" = ${Number(params.projectId)}`);
  if (task == null) throw Problem.user.notFound();
  await formFor(container, auth, task.projectId, task.xmlFormId);
  return task;
};

const audit = (tx, actorId, formId, action, details) => tx.db.query(sql`INSERT INTO audits
  ("actorId", action, "acteeId", details, "loggedAt", processed, failures)
  SELECT ${actorId}, ${action}, f."acteeId", ${JSON.stringify(details)},
    clock_timestamp(), clock_timestamp(), 0 FROM forms f WHERE f.id = ${formId}`);

const ifMatch = (headers) => {
  if (headers['if-match'] == null) throw Problem.user.reverificationRevisionRequired();
  const matched = /^"task-([1-9]\d*)"$/.exec(headers['if-match']);
  if (matched == null || !Number.isSafeInteger(Number(matched[1]))) throw invalid();
  return Number(matched[1]);
};

// Why a candidate observation is not acceptable evidence that the visit happened.
// Order matters: the first failing condition is reported.
const proofFailure = (task, evidence, taken) => {
  if (evidence == null) return 'observation-not-on-this-asset';
  if (evidence.predicate !== task.predicate) return 'different-fact';
  if (evidence.sequence <= task.observationSequence) return 'not-newer-than-the-expired-observation';
  if (!['known', 'not-applicable'].includes(evidence.state)) return 'state-is-not-visit-evidence';
  if (evidence.subDeleted != null || evidence.sourceFormId !== task.formId) return 'source-unavailable';
  if (evidence.verified !== true) return 'integrity-unverified';
  if (evidence.origin !== 'collected') return 'not-collected-in-the-field';
  if (evidence.submitterId !== task.assigneeId) return 'not-submitted-by-the-assignee';
  if (new Date(evidence.receivedAt) <= new Date(task.dispatchedAt)) return 'received-before-dispatch';
  if (taken) return 'already-closes-another-task';
  return null;
};

const appUser = async (container, auth) => {
  const actor = auth.actor.orNull();
  if (actor?.type !== 'field_key') throw Problem.user.insufficientRights();
  const [key] = await container.db.any(sql`SELECT fk."projectId", a."displayName", p.name AS "projectName"
    FROM field_keys fk JOIN actors a ON a.id = fk."actorId" AND a."deletedAt" IS NULL
    JOIN projects p ON p.id = fk."projectId" AND p."deletedAt" IS NULL
    WHERE fk."actorId" = ${actor.id}`);
  if (key == null) throw Problem.user.insufficientRights();
  return { ...key, actorId: actor.id };
};

module.exports = (service, endpoint) => {
  const root = '/field-data/projects/:projectId/reverification-tasks';

  service.get(root, endpoint(async (container, { auth, params, query }, request, response) => {
    const project = await scope(container, auth, params);
    if (query.status != null && !STATUSES.includes(query.status)) throw invalid();
    if (query.overdue != null && !['true', 'false'].includes(query.overdue)) throw invalid();
    if (query.assigneeId != null && !/^[1-9]\d{0,9}$/.test(query.assigneeId)) throw invalid();
    let cursor = null;
    if (query.cursor != null) {
      try {
        if (typeof query.cursor !== 'string' || query.cursor.length > 512) throw new Error();
        cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'));
        if (!UUID_PATTERN.test(cursor.id ?? '') || typeof cursor.dueAt !== 'string'
          || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(cursor.dueAt)
          || !Number.isFinite(Date.parse(cursor.dueAt))) throw new Error();
      } catch { throw invalid(); }
    }
    const allowed = await auth.can('project.update', project);
    const formIds = await readableFormIds(container, auth, Number(params.projectId));
    response.set('Cache-Control', 'private, no-store');
    if (formIds.length === 0) return { items: [], allowed, nextCursor: null };
    const rows = await container.db.any(sql`SELECT ${taskColumns},
      to_char(t."dueAt" AT TIME ZONE 'UTC', ${US_UTC}) AS "dueCursor" ${taskJoins}
      WHERE a."projectId" = ${Number(params.projectId)} AND a."formId" = ANY(${sql.array(formIds, 'int4')})
        ${query.status == null ? sql`` : sql`AND t.status = ${query.status}`}
        ${query.overdue === 'true' ? sql`AND ${OVERDUE}` : sql``}
        ${query.assigneeId == null ? sql`` : sql`AND t."assigneeId" = ${Number(query.assigneeId)}`}
        ${cursor == null ? sql`` : sql`AND (t."dueAt", t.id) > (${cursor.dueAt}::timestamptz, ${cursor.id}::uuid)`}
      ORDER BY t."dueAt", t.id LIMIT 51`);
    const page = rows.slice(0, 50);
    const last = page[page.length - 1];
    return {
      items: page.map(row => present(row)),
      allowed,
      nextCursor: rows.length > 50
        ? Buffer.from(JSON.stringify({ id: last.id, dueAt: last.dueCursor })).toString('base64url') : null
    };
  }));

  // What needs attention across the project, and how much open work each collector
  // holds. Workload is a current count, not a performance measure: a task can stay
  // open because a road is blocked, and nothing here ranks or scores anyone.
  service.get(`${root}/summary`, endpoint(async (container, { auth, params }, request, response) => {
    await scope(container, auth, params);
    const formIds = await readableFormIds(container, auth, Number(params.projectId));
    const counts = Object.fromEntries([...STATUSES, 'overdue'].map(name => [name, 0]));
    response.set('Cache-Control', 'private, no-store');
    if (formIds.length === 0) return { counts, workload: [], truncated: false };
    const within = sql`a."projectId" = ${Number(params.projectId)} AND a."formId" = ANY(${sql.array(formIds, 'int4')})`;
    const byStatus = await container.db.any(sql`SELECT t.status, count(*)::integer AS count,
      (count(*) FILTER (WHERE ${OVERDUE}))::integer AS overdue ${taskJoins} WHERE ${within} GROUP BY t.status`);
    for (const row of byStatus) { counts[row.status] = row.count; counts.overdue += row.overdue; }
    const people = await container.db.any(sql`SELECT t."assigneeId" AS id, asg."displayName",
      count(*)::integer AS open, (count(*) FILTER (WHERE ${OVERDUE}))::integer AS overdue ${taskJoins}
      WHERE ${within} AND t.status = 'dispatched'
      GROUP BY t."assigneeId", asg."displayName" ORDER BY open DESC, asg."displayName", t."assigneeId" LIMIT 201`);
    return {
      counts,
      workload: people.slice(0, 200).map(row => ({ assignee: { id: row.id, displayName: row.displayName },
        open: row.open, overdue: row.overdue })),
      truncated: people.length > 200
    };
  }));

  service.get(`${root}/:taskId`, endpoint(async (container, { auth, params }, request, response) => {
    const project = await scope(container, auth, params);
    const task = await taskFor(container, auth, params);
    const events = await container.db.any(sql`SELECT e.id, e.sequence, e.action, e."actorId", e."assigneeId",
      asg."displayName" AS "assigneeName", e."observationId", e."reasonCode", e."visitBy", e.note, e."recordedAt"
      FROM field_data_reverification_task_events e LEFT JOIN actors asg ON asg.id = e."assigneeId"
      WHERE e."taskId" = ${task.id} ORDER BY e.sequence LIMIT 500`);
    const candidates = task.status !== 'dispatched' ? [] : await container.db.any(sql`SELECT cv.id AS "claimVersionId",
      sd."instanceId", sd."createdAt" AS "receivedAt", p."capturedAt"
      FROM submission_defs sd
      JOIN submissions s ON s.id = sd."submissionId" AND s."deletedAt" IS NULL AND s."formId" = ${task.formId}
      JOIN field_data_claim_versions cv ON cv."submissionDefId" = sd.id
      JOIN field_data_submission_provenance p ON p."submissionDefId" = sd.id AND p.origin = 'collected'
      WHERE sd."submitterId" = ${task.assigneeId} AND sd."createdAt" > ${new Date(task.dispatchedAt).toISOString()}::timestamptz
      ORDER BY sd."createdAt" DESC, sd.id DESC LIMIT 20`);
    response.set('Cache-Control', 'private, no-store');
    response.set('ETag', `"task-${task.revision}"`);
    return { task: present(task), events, candidates, allowed: await auth.can('project.update', project) };
  }));

  // One skeleton for every transition: lock the task, replay identical retries,
  // check the revision, apply the change, append the event and audit atomically.
  const transition = (action, keys, validate, apply) => endpoint(async (container, { auth, params, body, headers }, request, response) => {
    await scope(container, auth, params, true);
    const task = await taskFor(container, auth, params);
    const expected = ifMatch(headers);
    if (!exactKeys(body, ['requestId', 'note', ...keys]) || !UUID_PATTERN.test(body.requestId ?? '')
      || !text(body.note, 2000)) throw invalid();
    const data = validate(body);
    const { requestId } = body;
    const requestHash = hash({ action, ...data, note: body.note.trim() });
    const actorId = auth.actor.map(actor => actor.id).orNull();
    const result = await container.transacting(async (tx) => {
      const locked = await tx.db.one(sql`SELECT * FROM field_data_reverification_tasks WHERE id = ${task.id} FOR UPDATE`);
      const [existing] = await tx.db.any(sql`SELECT "requestHash" FROM field_data_reverification_task_events
        WHERE "taskId" = ${task.id} AND "requestId" = ${requestId}`);
      if (existing != null) {
        if (existing.requestHash !== requestHash) throw invalid();
        return { id: task.id, status: locked.status, revision: locked.revision, replayed: true };
      }
      if (expected !== locked.revision) throw Problem.user.reverificationRevisionStale();
      const change = await apply({ tx, task: { ...task, ...locked }, data });
      const event = { taskId: task.id, sequence: locked.revision, action: change.event, actorId,
        assigneeId: change.assigneeId ?? null, observationId: change.observationId ?? null,
        reasonCode: change.reasonCode ?? null, visitBy: change.visitBy ?? null };
      await tx.db.query(sql`INSERT INTO field_data_reverification_task_events
        ("taskId", sequence, action, "actorId", "assigneeId", "observationId", "reasonCode", "visitBy", note, "requestId", "requestHash")
        VALUES (${event.taskId}, ${event.sequence}, ${event.action}, ${event.actorId}, ${event.assigneeId},
          ${event.observationId}, ${event.reasonCode}, ${event.visitBy}, ${body.note.trim()}, ${requestId}, ${requestHash})`);
      await audit(tx, actorId, task.formId, `field_data.asset.task.${change.event}`,
        { taskId: task.id, assetId: task.assetId, observationId: change.observationId ?? null,
          assigneeId: change.assigneeId ?? null, reasonCode: change.reasonCode ?? null });
      return { id: task.id, status: change.status, revision: locked.revision + 1, replayed: false };
    });
    response.set('Cache-Control', 'private, no-store');
    response.set('ETag', `"task-${result.revision}"`);
    response.set('Idempotency-Status', result.replayed ? 'replayed' : 'created');
    return result;
  });

  service.post(`${root}/:taskId/dispatch`, transition('dispatch', ['assigneeId', 'visitBy'], (body) => {
    if (!Number.isSafeInteger(body.assigneeId) || body.assigneeId < 1) throw invalid();
    if (body.visitBy != null && (!timestamp(body.visitBy) || new Date(body.visitBy) <= new Date())) throw invalid();
    return { assigneeId: body.assigneeId, visitBy: body.visitBy == null ? null : new Date(body.visitBy).toISOString() };
  }, async ({ tx, task, data }) => {
    if (!['queued', 'dispatched'].includes(task.status)) throw Problem.user.reverificationTaskState();
    // The collector must be an App User of this project who can submit to the asset's form.
    const [assignee] = await tx.db.any(sql`SELECT fk."actorId" FROM field_keys fk
      JOIN actors a ON a.id = fk."actorId" AND a."deletedAt" IS NULL
      JOIN forms f ON f.id = ${task.formId}
      WHERE fk."actorId" = ${data.assigneeId} AND fk."projectId" = ${task.projectId}
        AND EXISTS (SELECT 1 FROM assignments ass JOIN roles r ON r.id = ass."roleId"
          WHERE ass."actorId" = fk."actorId" AND ass."acteeId" = f."acteeId" AND r.verbs ? 'submission.create')`);
    if (assignee == null) throw Problem.user.reverificationAssigneeInvalid();
    // Only a different collector restarts the evidence clock; changing the
    // deadline for the same collector keeps work already received.
    const sameCollector = task.status === 'dispatched' && task.assigneeId === data.assigneeId;
    await tx.db.query(sql`UPDATE field_data_reverification_tasks SET status = 'dispatched',
      "assigneeId" = ${data.assigneeId}, "visitBy" = ${data.visitBy},
      "dispatchedAt" = ${sameCollector ? sql`${new Date(task.dispatchedAt).toISOString()}::timestamptz` : sql`clock_timestamp()`},
      revision = revision + 1 WHERE id = ${task.id}`);
    return { event: task.status === 'queued' ? 'dispatch' : 'reassign', status: 'dispatched',
      assigneeId: data.assigneeId, visitBy: data.visitBy };
  }));

  service.post(`${root}/:taskId/close`, transition('close', ['observationId'], (body) => {
    if (!UUID_PATTERN.test(body.observationId ?? '')) throw invalid();
    return { observationId: body.observationId };
  }, async ({ tx, task, data }) => {
    if (task.status !== 'dispatched') throw Problem.user.reverificationTaskState();
    const [evidence] = await tx.db.any(sql`SELECT o.id, o.predicate, o.sequence, o.state,
      sd."submitterId", sd."createdAt" AS "receivedAt", s."deletedAt" AS "subDeleted", s."formId" AS "sourceFormId", p.origin,
      CASE WHEN octet_length(sd.xml) <= 2097152 THEN
        p."integrityHash" = o."sourceHash" AND p."integrityHash" = encode(sha256(convert_to(sd.xml, 'UTF8')), 'hex')
        ELSE false END AS verified
      FROM field_data_asset_observations o
      JOIN field_data_claim_versions cv ON cv.id = o."claimVersionId"
      JOIN submission_defs sd ON sd.id = cv."submissionDefId"
      JOIN submissions s ON s.id = sd."submissionId"
      LEFT JOIN field_data_submission_provenance p ON p."submissionDefId" = sd.id
      WHERE o.id = ${data.observationId} AND o."assetId" = ${task.assetId}
      -- Hold the source submission for the rest of this transaction. A deletion
      -- that has not committed yet makes this wait and then see it; one that
      -- starts later waits for the closure. Locking only the task row would let
      -- a task close on evidence that was deleted in between.
      FOR SHARE OF s`);
    const [taken] = await tx.db.any(sql`SELECT 1 FROM field_data_reverification_tasks
      WHERE "closureObservationId" = ${data.observationId}`);
    const reason = proofFailure(task, evidence, taken != null);
    if (reason != null) throw Problem.user.reverificationProofRejected({ reason });
    await tx.db.query(sql`UPDATE field_data_reverification_tasks SET status = 'closed',
      "closedAt" = clock_timestamp(), "closureObservationId" = ${data.observationId},
      revision = revision + 1 WHERE id = ${task.id}`);
    return { event: 'close', status: 'closed', assigneeId: task.assigneeId, observationId: data.observationId };
  }));

  service.post(`${root}/:taskId/cancel`, transition('cancel', ['reasonCode'], (body) => {
    if (!REASON_CODES.includes(body.reasonCode)) throw invalid();
    return { reasonCode: body.reasonCode };
  }, async ({ tx, task, data }) => {
    if (!['queued', 'dispatched'].includes(task.status)) throw Problem.user.reverificationTaskState();
    await tx.db.query(sql`UPDATE field_data_reverification_tasks SET status = 'cancelled',
      "closedAt" = clock_timestamp(), revision = revision + 1 WHERE id = ${task.id}`);
    return { event: 'cancel', status: 'cancelled', assigneeId: task.assigneeId, reasonCode: data.reasonCode };
  }));

  // App Users hold submission.create, not submission.read. Show only what the
  // visit needs: never the earlier value, history, review state or other people's tasks.
  service.get('/field-data/app-user/reverification', endpoint(async (container, { auth }, request, response) => {
    const user = await appUser(container, auth);
    const rows = await container.db.any(sql`SELECT t.id, t."visitBy", t."dispatchedAt",
      a.name AS "assetName", a."externalId", a."assetType", o.predicate, f."xmlFormId", fd.name AS "formName",
      (f.state = 'open') AS actionable,
      (SELECT e.note FROM field_data_reverification_task_events e WHERE e."taskId" = t.id
        AND e.action IN ('dispatch', 'reassign') ORDER BY e.sequence DESC LIMIT 1) AS instruction
      FROM field_data_reverification_tasks t
      JOIN field_data_asset_observations o ON o.id = t."observationId"
      JOIN field_data_assets a ON a.id = o."assetId"
      JOIN forms f ON f.id = a."formId" AND f."projectId" = ${user.projectId} AND f."deletedAt" IS NULL
      JOIN form_defs fd ON fd.id = f."currentDefId"
      WHERE t.status = 'dispatched' AND t."assigneeId" = ${user.actorId}
        AND EXISTS (SELECT 1 FROM assignments ass JOIN roles r ON r.id = ass."roleId"
          WHERE ass."actorId" = ${user.actorId} AND ass."acteeId" = f."acteeId" AND r.verbs ? 'submission.create')
      ORDER BY t."dispatchedAt" DESC, t.id DESC LIMIT 51`);
    response.set('Cache-Control', 'private, no-store');
    return { appUser: { name: user.displayName, projectName: user.projectName },
      items: rows.slice(0, 50), complete: rows.length <= 50 };
  }));
};
module.exports.proofFailure = proofFailure;
