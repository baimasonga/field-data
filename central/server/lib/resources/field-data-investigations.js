// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
//
// Investigation records (F6): docs/field-intelligence/F6-investigations.md
//
// An investigation covers integrity findings of a project, keeps an
// append-only history and ends with a disposition. It is a record for people:
// it changes no submission, finding or review case.

const { createHash } = require('crypto');
const { sql } = require('slonik');
const { Form } = require('../model/frames');
const Problem = require('../util/problem');
const { getOrNotFound } = require('../util/promise');
const { UUID_PATTERN } = require('../util/claim-versioning');

const MAX_FINDINGS = 500;
const DISPOSITIONS = ['confirmed-issue', 'data-error', 'benign-pattern', 'insufficient-evidence', 'policy-exception', 'duplicate'];
const STATUSES = ['open', 'closed'];

const invalid = (field, reason) => Problem.user.investigationInvalid({ field, reason });
const text = (value, field, max) => {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) throw invalid(field, `it must be 1 to ${max} characters`);
  return value.trim();
};
const findingIdsOf = (value, max = MAX_FINDINGS) => {
  if (!Array.isArray(value) || value.length > max || value.some((id) => !Number.isSafeInteger(id) || id < 1))
    throw invalid('findingIds', `it must be a list of at most ${max} finding IDs`);
  return [...new Set(value)].sort((a, b) => a - b);
};
const revisionOf = (headers) => {
  if (headers['if-match'] == null) throw Problem.user.investigationRevisionRequired();
  const matched = /^"investigation-([1-9]\d*)"$/.exec(headers['if-match']);
  if (matched == null || !Number.isSafeInteger(Number(matched[1]))) throw invalid('If-Match', 'it must be "investigation-<revision>"');
  return Number(matched[1]);
};

// Only those who may manage the project see investigations.
const projectFor = async (container, auth, params) => {
  if (!/^[1-9]\d*$/.test(params.projectId) || !Number.isSafeInteger(Number(params.projectId))) throw Problem.user.notFound();
  const project = await container.Projects.getById(Number(params.projectId)).then(getOrNotFound);
  await auth.canOrReject('project.update', project);
  return project;
};

const readableForms = async (container, auth, projectId) => {
  const forms = await container.db.any(sql`SELECT "xmlFormId" FROM forms WHERE "projectId" = ${projectId} AND "deletedAt" IS NULL`);
  const checked = await Promise.all(forms.map(async ({ xmlFormId }) => {
    const form = await container.Forms.getByProjectAndXmlFormId(projectId, xmlFormId, Form.WithoutDef, Form.WithoutXml);
    return form.isDefined() && await auth.can('submission.read', form.get()) ? form.get().id : null;
  }));
  return new Set(checked.filter((id) => id != null));
};

// Every ID must be a finding of one of the project's forms.
const checkFindings = async (db, projectId, ids) => {
  if (ids.length === 0) return;
  const found = await db.oneFirst(sql`SELECT count(*)::integer FROM field_data_integrity_flags i
    JOIN forms f ON f.id = i."formId" AND f."projectId" = ${projectId}
    WHERE i.id = ANY(${sql.array(ids, 'int4')})`);
  if (found !== ids.length) throw invalid('findingIds', 'every ID must be a finding of this project');
};

const getInvestigation = async (db, projectId, id, lock = false) => {
  if (!UUID_PATTERN.test(id)) throw Problem.user.notFound();
  const [row] = await db.any(sql`SELECT * FROM field_data_investigations
    WHERE id = ${id} AND "projectId" = ${projectId} ${lock ? sql`FOR UPDATE` : sql``}`);
  if (row == null) throw Problem.user.notFound();
  return row;
};

const addEvent = (db, investigationId, actorId, kind, { note = null, disposition = null, findingIds = null } = {}) =>
  db.query(sql`INSERT INTO field_data_investigation_events ("investigationId", kind, "actorId", note, disposition, "findingIds")
    VALUES (${investigationId}, ${kind}, ${actorId}, ${note}, ${disposition}, ${findingIds == null ? null : JSON.stringify(findingIds)})`);

const audit = (db, actorId, project, action, details) => db.query(sql`INSERT INTO audits
  ("actorId", action, "acteeId", details, "loggedAt", processed, failures)
  VALUES (${actorId}, ${action}, ${project.acteeId}, ${JSON.stringify(details)}, clock_timestamp(), clock_timestamp(), 0)`);

const detail = async (container, auth, project, id) => {
  const investigation = await getInvestigation(container.db, project.id, id);
  const readable = await readableForms(container, auth, project.id);
  const findings = await container.db.any(sql`SELECT i.id, i.rule, i.evidence->>'title' AS title, i.outcome, i.status,
      i."formId", f."xmlFormId", i."instanceId", i."relatedInstanceId", i."createdAt", x."addedAt"
    FROM field_data_investigation_findings x
    JOIN field_data_integrity_flags i ON i.id = x."findingId"
    JOIN forms f ON f.id = i."formId"
    WHERE x."investigationId" = ${investigation.id}
    ORDER BY i."createdAt", i.id`);
  const events = await container.db.any(sql`SELECT e.id, e.kind, e."actorId", a."displayName" AS "actorName", e.note,
      e.disposition, e."findingIds", e."createdAt"
    FROM field_data_investigation_events e LEFT JOIN actors a ON a.id = e."actorId"
    WHERE e."investigationId" = ${investigation.id} ORDER BY e.id`);
  const opener = investigation.openedBy == null ? null
    : await container.db.maybeOneFirst(sql`SELECT "displayName" FROM actors WHERE id = ${investigation.openedBy}`);
  const shown = findings.filter((f) => readable.has(f.formId));
  const { requestId, requestHash, projectId, ...rest } = investigation;
  return {
    ...rest, openedByName: opener,
    findings: shown.map(({ formId, ...f }) => f),
    hiddenFindings: findings.length - shown.length,
    events: events.map((e) => ({ ...e, id: Number(e.id) }))
  };
};

module.exports = (service, endpoint) => {
  const base = '/projects/:projectId/investigations';
  const respond = (response, revision) => {
    response.set('Cache-Control', 'private, no-store');
    response.set('ETag', `"investigation-${revision}"`);
  };

  service.get(base, endpoint(async (container, { auth, params, query }, _, response) => {
    const project = await projectFor(container, auth, params);
    if (query.status != null && !STATUSES.includes(query.status)) throw invalid('status', 'it must be open or closed');
    response.set('Cache-Control', 'private, no-store');
    return container.db.any(sql`SELECT v.id, v.title, v.status, v.disposition, v.revision, v."openedAt", v."updatedAt",
        (SELECT count(*)::integer FROM field_data_investigation_findings x WHERE x."investigationId" = v.id) AS findings
      FROM field_data_investigations v WHERE v."projectId" = ${project.id}
        ${query.status == null ? sql`` : sql`AND v.status = ${query.status}`}
      ORDER BY v."updatedAt" DESC, v.id LIMIT 200`);
  }));

  service.post(base, endpoint(async (container, { auth, params, body }, _, response) => {
    const project = await projectFor(container, auth, params);
    if (body == null || typeof body !== 'object' || Object.keys(body).some((k) => !['requestId', 'title', 'findingIds'].includes(k)))
      throw invalid('body', 'it may have only requestId, title and findingIds');
    if (!UUID_PATTERN.test(body.requestId ?? '')) throw invalid('requestId', 'it must be a UUID');
    const title = text(body.title, 'title', 200);
    const findingIds = findingIdsOf(body.findingIds ?? []);
    const requestHash = createHash('sha256').update(JSON.stringify({ title, findingIds })).digest('hex');
    const actorId = auth.actor.map((actor) => actor.id).orNull();
    const result = await container.transacting(async ({ db }) => {
      await db.query(sql`SELECT id FROM projects WHERE id = ${project.id} FOR UPDATE`);
      const [existing] = await db.any(sql`SELECT id, revision, "requestHash" FROM field_data_investigations
        WHERE "projectId" = ${project.id} AND "requestId" = ${body.requestId}`);
      if (existing != null) {
        if (existing.requestHash !== requestHash) throw invalid('requestId', 'it was already used for another investigation');
        return { ...existing, replayed: true };
      }
      await checkFindings(db, project.id, findingIds);
      const created = await db.one(sql`INSERT INTO field_data_investigations ("projectId", "requestId", "requestHash", title, "openedBy")
        VALUES (${project.id}, ${body.requestId}, ${requestHash}, ${title}, ${actorId}) RETURNING id, revision`);
      if (findingIds.length > 0) await db.query(sql`INSERT INTO field_data_investigation_findings ("investigationId", "findingId", "addedBy")
        SELECT ${created.id}, unnest(${sql.array(findingIds, 'int4')}), ${actorId}`);
      await addEvent(db, created.id, actorId, 'opened', { findingIds });
      await audit(db, actorId, project, 'field_data.investigation.open', { investigationId: created.id });
      return { ...created, replayed: false };
    });
    respond(response, result.revision);
    response.set('Idempotency-Status', result.replayed ? 'replayed' : 'created');
    response.status(201);
    return detail(container, auth, project, result.id);
  }));

  service.get(`${base}/:id`, endpoint(async (container, { auth, params }, _, response) => {
    const project = await projectFor(container, auth, params);
    const result = await detail(container, auth, project, params.id);
    respond(response, result.revision);
    return result;
  }));

  // A change of state: checked against the revision, then recorded.
  const change = (apply) => endpoint(async (container, { auth, params, body, headers }, _, response) => {
    const project = await projectFor(container, auth, params);
    if (body == null || typeof body !== 'object') throw invalid('body', 'it must be an object');
    const actorId = auth.actor.map((actor) => actor.id).orNull();
    const revision = await container.transacting(async ({ db }) => {
      const current = await getInvestigation(db, project.id, params.id, true);
      if (current.revision !== revisionOf(headers)) throw Problem.user.investigationRevisionStale();
      const bumped = await apply({ db, project, current, body, actorId });
      if (!bumped) return current.revision;
      const updated = await db.one(sql`UPDATE field_data_investigations SET revision = revision + 1, "updatedAt" = clock_timestamp()
        WHERE id = ${current.id} RETURNING revision`);
      return updated.revision;
    });
    const result = await detail(container, auth, project, params.id);
    respond(response, revision);
    return result;
  });

  service.post(`${base}/:id/findings`, change(async ({ db, project, current, body, actorId }) => {
    if (Object.keys(body).some((k) => k !== 'findingIds')) throw invalid('body', 'it may have only findingIds');
    const findingIds = findingIdsOf(body.findingIds);
    if (current.status !== 'open') throw Problem.user.investigationState({ status: current.status });
    await checkFindings(db, project.id, findingIds);
    const added = (await db.any(sql`INSERT INTO field_data_investigation_findings ("investigationId", "findingId", "addedBy")
      SELECT ${current.id}, unnest(${sql.array(findingIds, 'int4')}), ${actorId}
      ON CONFLICT DO NOTHING RETURNING "findingId"`)).map((row) => row.findingId).sort((a, b) => a - b);
    if (added.length === 0) return false;
    const total = await db.oneFirst(sql`SELECT count(*)::integer FROM field_data_investigation_findings WHERE "investigationId" = ${current.id}`);
    if (total > MAX_FINDINGS) throw invalid('findingIds', `an investigation may cover at most ${MAX_FINDINGS} findings`);
    await addEvent(db, current.id, actorId, 'findings-added', { findingIds: added });
    return true;
  }));

  service.post(`${base}/:id/close`, change(async ({ db, project, current, body, actorId }) => {
    if (Object.keys(body).some((k) => !['disposition', 'conclusion'].includes(k))) throw invalid('body', 'it may have only disposition and conclusion');
    if (!DISPOSITIONS.includes(body.disposition)) throw invalid('disposition', `it must be one of ${DISPOSITIONS.join(', ')}`);
    const conclusion = text(body.conclusion, 'conclusion', 4000);
    if (current.status !== 'open') throw Problem.user.investigationState({ status: current.status });
    await db.query(sql`UPDATE field_data_investigations SET status = 'closed', disposition = ${body.disposition} WHERE id = ${current.id}`);
    await addEvent(db, current.id, actorId, 'closed', { note: conclusion, disposition: body.disposition });
    await audit(db, actorId, project, 'field_data.investigation.close', { investigationId: current.id, disposition: body.disposition });
    return true;
  }));

  service.post(`${base}/:id/reopen`, change(async ({ db, project, current, body, actorId }) => {
    if (Object.keys(body).some((k) => k !== 'reason')) throw invalid('body', 'it may have only reason');
    const reason = text(body.reason, 'reason', 4000);
    if (current.status !== 'closed') throw Problem.user.investigationState({ status: current.status });
    await db.query(sql`UPDATE field_data_investigations SET status = 'open', disposition = NULL WHERE id = ${current.id}`);
    await addEvent(db, current.id, actorId, 'reopened', { note: reason });
    await audit(db, actorId, project, 'field_data.investigation.reopen', { investigationId: current.id });
    return true;
  }));

  // Notes need no revision: they only add to the history.
  service.post(`${base}/:id/notes`, endpoint(async (container, { auth, params, body }, _, response) => {
    const project = await projectFor(container, auth, params);
    if (body == null || typeof body !== 'object' || Object.keys(body).some((k) => k !== 'note')) throw invalid('body', 'it may have only note');
    const note = text(body.note, 'note', 4000);
    const actorId = auth.actor.map((actor) => actor.id).orNull();
    await container.transacting(async ({ db }) => {
      const current = await getInvestigation(db, project.id, params.id, true);
      await addEvent(db, current.id, actorId, 'note', { note });
      await db.query(sql`UPDATE field_data_investigations SET "updatedAt" = clock_timestamp() WHERE id = ${current.id}`);
    });
    const result = await detail(container, auth, project, params.id);
    respond(response, result.revision);
    response.status(201);
    return result;
  }));
};
