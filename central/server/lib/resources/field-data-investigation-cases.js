// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { randomUUID } = require('node:crypto');
const { sql } = require('slonik');
const { Form } = require('../model/frames');
const { getOrNotFound } = require('../util/promise');
const { UUID_PATTERN } = require('../util/claim-versioning');
const links = require('../util/investigation-case-links');
const Problem = require('../util/problem');
const instrument = require('../util/investigation-instrument');
const responseFormDraft = require('../util/investigation-response-form');
const { requestBackcheck } = require('../util/backcheck-request');
const conflict = () => Problem.user.investigationCaseLinkConflict();
const scope = async (c, auth, params) => {
  if (!/^[1-9]\d*$/.test(params.projectId) || !Number.isSafeInteger(Number(params.projectId)) || !UUID_PATTERN.test(params.id ?? '')) throw Problem.user.notFound();
  const project = await c.Projects.getById(Number(params.projectId)).then(getOrNotFound);
  await auth.canOrReject('project.update', project);
  if (auth.actor.orNull()?.type !== 'user') throw Problem.user.notFound(); return project;
};
const investigation = async (db, projectId, id, lock = false) => {
  const row = await db.maybeOne(sql`SELECT * FROM field_data_investigations WHERE id = ${id} AND "projectId" = ${projectId} ${lock ? sql`FOR UPDATE` : sql``}`);
  if (!row) throw Problem.user.notFound(); return row;
};
const grantLock = async (db, actorId, acteeId, verb) => {
  const grant = await db.maybeOne(sql`WITH RECURSIVE implied(id) AS (
    (SELECT ${acteeId}::varchar) UNION (SELECT unnest(ARRAY[parent, species]) FROM actees JOIN implied ON implied.id = actees.id))
    SELECT ass."actorId" FROM assignments ass JOIN implied ON implied.id = ass."acteeId" JOIN roles r ON r.id = ass."roleId"
    WHERE ass."actorId" = ${actorId} AND r.verbs ? ${verb} LIMIT 1 FOR SHARE OF ass, r`);
  if (!grant) throw Problem.user.notFound();
};
const managerLock = async (tx, actorId, project) => {
  const actor = await tx.db.maybeOne(sql`SELECT id,"displayName" FROM actors WHERE id = ${actorId} AND type = 'user' AND "deletedAt" IS NULL FOR SHARE`);
  if (!actor) throw Problem.user.notFound(); await grantLock(tx.db, actorId, project.acteeId, 'project.update');
  const row = await tx.db.maybeOne(sql`SELECT archived FROM projects WHERE id = ${project.id} AND "deletedAt" IS NULL FOR SHARE`);
  if (!row) throw Problem.user.notFound(); return { ...actor, archived: row.archived };
};
const readableForms = async (c, auth, projectId) => {
  const rows = await c.db.any(sql`SELECT id,"xmlFormId" FROM forms WHERE "projectId" = ${projectId} AND "deletedAt" IS NULL`);
  const permitted = await Promise.all(rows.map(async row => {
    const form = (await c.Forms.getByProjectAndXmlFormId(projectId, row.xmlFormId, Form.WithoutDef, Form.WithoutXml)).orNull();
    return form && await auth.can('submission.read', form) ? row.id : null;
  })); return permitted.filter(id => id != null);
};
const caseRows = (db, projectId, ids = null, lock = false, filter = sql``) => db.any(sql`SELECT c.id,c."claimVersionId",c.status,c.priority,c.revision,c."reasonCodes",c."assignedTo",
  date_trunc('milliseconds',c."openedAt") AS "openedAt",c."updatedAt",c."resolvedAt",v.ordinal,sd.current,sd."instanceId" AS "versionInstanceId",
  f.id AS "formId",f."acteeId" AS "formActeeId",f."xmlFormId",s."instanceId",s."reviewState" AS "submissionReviewState"
  FROM field_data_review_cases c JOIN field_data_claim_versions v ON v.id = c."claimVersionId"
  JOIN submission_defs sd ON sd.id = v."submissionDefId" JOIN submissions s ON s.id = sd."submissionId" AND s."deletedAt" IS NULL AND s.draft = FALSE
  JOIN forms f ON f.id = s."formId" AND f."deletedAt" IS NULL JOIN projects p ON p.id = f."projectId" AND p."deletedAt" IS NULL
  WHERE p.id = ${projectId} ${ids == null ? sql`` : sql`AND c.id = ANY(${sql.array(ids, 'uuid')})`} ${filter}
  ${lock ? sql`FOR SHARE OF sd,s,f,p` : sql``}`);
const publicCase = ({ formId, formActeeId, ...row }) => row;
const eventsFor = (db, id) => db.any(sql`SELECT * FROM field_data_investigation_case_events WHERE "investigationId" = ${id} ORDER BY sequence DESC LIMIT 500`);
const visibleCases = async (c, auth, projectId, ids) => {
  const readable = await readableForms(c, auth, projectId);
  return caseRows(c.db, projectId, ids, false, sql`AND f.id = ANY(${sql.array(readable, 'int4')})`);
};
const state = async (c, auth, project, inv, before = 501) => {
  const events = await eventsFor(c.db, inv.id); const active = links.active(events);
  const rows = await visibleCases(c, auth, project.id, [...new Set(events.map(e => e.caseId))]); const byId = new Map(rows.map(row => [row.id, row]));
  const available = event => byId.has(event.caseId) && byId.get(event.caseId).claimVersionId === event.claimVersionId;
  const page = events.filter(e => e.sequence < before); const selected = page.slice(0, 50);
  return { revision: inv.revision, status: inv.status, canLink: inv.status === 'open' && !project.archived && links.canAdd(events.length, active.length),
    canRemove: inv.status === 'open' && !project.archived && events.length < 500, eventCount: events.length,
    items: active.map(e => ({ linkId: e.linkId, available: available(e), ...(available(e) ? { case: publicCase(byId.get(e.caseId)), reason: e.reason, linkedAt: e.createdAt, actorName: e.actorName } : {}) })),
    hiddenLinks: active.filter(e => !available(e)).length,
    history: selected.map(e => ({ id: e.id, linkId: e.linkId, sequence: e.sequence, action: e.action, investigationRevision: e.investigationRevision,
      available: available(e), ...(available(e) ? { case: publicCase(byId.get(e.caseId)), reason: e.reason, actorName: e.actorName, createdAt: e.createdAt } : {}) })),
    hiddenEvents: selected.filter(e => !available(e)).length, nextBefore: page.length > selected.length ? selected.at(-1).sequence : null };
};
// Only primary-source findings are used: no peer identifiers or recorded answers enter drafts.
const instrumentFindings = async (db, inv, row, lock = false) => {
  const findings = await db.any(sql`SELECT i.id,i.rule,i."ruleVersion" FROM field_data_investigation_findings x
    JOIN field_data_integrity_flags i ON i.id = x."findingId"
    WHERE x."investigationId" = ${inv.id} AND i."formId" = ${row.formId} AND i."instanceId" = ${row.instanceId}
      AND i.status IN ('open','investigating') AND i.outcome IN ('concern','inconclusive')
    ORDER BY i.id ${lock ? sql`FOR SHARE OF i,x` : sql``}`);
  return findings.map(instrument.suggestion).filter(Boolean);
};
const linkedScope = async (tx, auth, project, params, lock = false) => {
  if (!UUID_PATTERN.test(params.linkId ?? '')) throw Problem.user.notFound();
  const actor = await managerLock(tx, auth.actor.get().id, project);
  const inv = await investigation(tx.db, project.id, params.id, lock);
  const link = links.active(await eventsFor(tx.db, inv.id)).find(e => e.linkId === params.linkId.toLowerCase());
  if (!link) throw Problem.user.notFound();
  const [row] = await caseRows(tx.db, project.id, [link.caseId], true);
  if (!row || row.claimVersionId !== link.claimVersionId) throw Problem.user.notFound();
  await grantLock(tx.db, actor.id, row.formActeeId, 'submission.read');
  return { actor, inv, link, row };
};
module.exports = (service, endpoint) => {
  const root = '/projects/:projectId/investigations/:id/cases';
  const respond = (response, revision) => { response.set('Cache-Control', 'private, no-store'); response.set('ETag', `"investigation-${revision}"`); };
  service.get(root, endpoint(async (c, { auth, params, query }, _, response) => {
    const project = await scope(c, auth, params); const inv = await investigation(c.db, project.id, params.id);
    if (Object.keys(query).some(k => k !== 'before') || (query.before != null && !/^[1-9]\d{0,2}$/.test(query.before))) throw links.invalid();
    const result = await state(c, auth, project, inv, query.before == null ? 501 : Number(query.before)); respond(response, inv.revision); return result;
  }));
  service.get(`${root}/candidates`, endpoint(async (c, { auth, params, query }, _, response) => {
    const project = await scope(c, auth, params); const inv = await investigation(c.db, project.id, params.id);
    if (Object.keys(query).some(k => !['q', 'status', 'cursor', 'limit'].includes(k)) || (query.q != null && (typeof query.q !== 'string' || query.q.length > 200)) ||
      (query.status != null && !['open', 'in-review', 'resolved', 'superseded'].includes(query.status)) || (query.limit != null && (!/^[1-9]\d?$/.test(query.limit) || Number(query.limit) > 50))) throw links.invalid();
    const q = (query.q ?? '').trim(); const context = links.hash({ projectId: project.id, investigationId: inv.id, q, status: query.status ?? null });
    const cursor = query.cursor == null ? null : links.checkedCursor(query.cursor, context); const limit = Number(query.limit ?? 50);
    const readable = await readableForms(c, auth, project.id);
    const rows = await caseRows(c.db, project.id, null, false, sql`AND f.id = ANY(${sql.array(readable, 'int4')})
      AND (${q} = '' OR strpos(lower(s."instanceId"),lower(${q})) > 0 OR strpos(lower(f."xmlFormId"),lower(${q})) > 0 OR c.id::text = lower(${q}))
      ${query.status == null ? sql`` : sql`AND c.status = ${query.status}`}
      ${cursor == null ? sql`` : sql`AND (date_trunc('milliseconds',c."openedAt"),c.id) < (${cursor.at}::timestamptz,${cursor.id}::uuid)`}
      ORDER BY date_trunc('milliseconds',c."openedAt") DESC,c.id DESC LIMIT ${limit + 1}`);
    const active = new Set(links.active(await eventsFor(c.db, inv.id)).map(e => e.caseId)); const page = rows.slice(0, limit);
    respond(response, inv.revision); return { items: page.map(row => ({ ...publicCase(row), linked: active.has(row.id) })), nextCursor: rows.length > limit ? links.cursor(page.at(-1), context) : null };
  }));
  const write = removing => endpoint(async (c, { auth, params, headers, body }, _, response) => {
    const project = await scope(c, auth, params); const actorId = auth.actor.get().id; const data = links.checked(body, headers, removing, params.linkId);
    const digest = links.hash({ actorId, ...data });
    const result = await c.transacting(async tx => {
      const actor = await managerLock(tx, actorId, project); const inv = await investigation(tx.db, project.id, params.id, true); const events = await eventsFor(tx.db, inv.id);
      const prior = events.find(e => e.requestId === data.requestId);
      if (prior) { if (prior.requestHash !== digest) throw conflict(); return { revision: inv.revision, replayed: true }; }
      if (inv.revision !== data.revision) throw Problem.user.investigationRevisionStale();
      if (inv.status !== 'open') throw Problem.user.investigationState({ status: inv.status });
      if (actor.archived || events.length >= 500) throw conflict(); const active = links.active(events);
      let row; let linkId;
      if (removing) {
        row = active.find(e => e.linkId === data.targetId); if (!row) throw Problem.user.notFound(); linkId = row.linkId;
      } else {
        if (!links.canAdd(events.length, active.length) || active.some(e => e.caseId === data.targetId)) throw conflict();
        [row] = await caseRows(tx.db, project.id, [data.targetId], true); if (!row) throw Problem.user.notFound();
        await grantLock(tx.db, actorId, row.formActeeId, 'submission.read'); linkId = randomUUID();
      }
      const id = removing ? randomUUID() : linkId;
      await tx.db.query(sql`INSERT INTO field_data_investigation_case_events
        (id,"investigationId",sequence,"investigationRevision",action,"linkId","caseId","claimVersionId","requestId","requestHash",reason,"actorId","actorName")
        VALUES (${id},${inv.id},${events.length + 1},${inv.revision + 1},${data.action},${linkId},${removing ? row.caseId : row.id},${row.claimVersionId},${data.requestId},${digest},${data.reason},${actor.id},${actor.displayName})`);
      await tx.db.query(sql`UPDATE field_data_investigations SET revision = revision + 1,"updatedAt" = clock_timestamp() WHERE id = ${inv.id}`);
      await tx.Audits.log(auth.actor, 'field_data.investigation.case.link', project, { investigationId: inv.id, linkId, eventId: id, action: data.action });
      return { revision: inv.revision + 1, replayed: false };
    });
    respond(response, result.revision); response.set('Idempotency-Status', result.replayed ? 'replayed' : 'created'); return result;
  });
  service.post(root, write(false)); service.post(`${root}/:linkId/remove`, write(true));
  service.get(`${root}/:linkId/instrument`, endpoint(async (c, { auth, params, query }, _, response) => {
    const project = await scope(c, auth, params); if (Object.keys(query).length) throw instrument.invalid();
    const result = await c.transacting(async tx => {
      const { actor, inv, row } = await linkedScope(tx, auth, project, params);
      const items = await instrumentFindings(tx.db, inv, row);
      const form = await tx.Forms.getByProjectAndXmlFormId(project.id, row.xmlFormId, Form.WithoutDef, Form.WithoutXml).then(getOrNotFound);
      const pending = await tx.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_backchecks WHERE "caseId" = ${row.id} AND status = 'requested'`);
      return { templateVersion: instrument.VERSION, investigationRevision: inv.revision, caseRevision: row.revision,
        canGenerateForm: !actor.archived && inv.status === 'open' && row.current && ['open', 'in-review'].includes(row.status) && await auth.can('form.create', project),
        items: items.slice(0, instrument.MAX_FINDINGS), omitted: Math.max(0, items.length - instrument.MAX_FINDINGS),
        canRequest: !actor.archived && inv.status === 'open' && row.current && row.status === 'in-review' && row.assignedTo === actor.id && pending === 0 && await auth.can('submission.update', form) };
    });
    response.set('Cache-Control', 'private, no-store'); return result;
  }));
  service.post(`${root}/:linkId/instrument/form-definition`, endpoint(async (c, { auth, params, body }, _, response) => {
    const project = await scope(c, auth, params); const data = responseFormDraft.checked(body);
    const result = await c.transacting(async tx => {
      const { actor, inv, row } = await linkedScope(tx, auth, project, params, true);
      await grantLock(tx.db, actor.id, project.acteeId, 'form.create');
      if (inv.revision !== data.investigationRevision) throw Problem.user.investigationRevisionStale();
      if (inv.status !== 'open' || actor.archived) throw Problem.user.investigationInstrumentConflict();
      // Integrity writers lock findings before cases; use that same order to avoid a cycle.
      const suggestions = (await instrumentFindings(tx.db, inv, row, true)).slice(0, instrument.MAX_FINDINGS);
      if (data.findingIds.some(id => !suggestions.some(item => item.findingId === id))) throw instrument.invalid();
      const current = await tx.db.one(sql`SELECT revision,status FROM field_data_review_cases WHERE id = ${row.id} FOR SHARE`);
      if (current.revision !== data.caseRevision) throw Problem.user.reviewRevisionStale();
      if (!row.current || !['open', 'in-review'].includes(current.status)) throw Problem.user.reviewCaseClosed();
      const selected = suggestions.filter(item => data.findingIds.includes(item.findingId));
      return { templateVersion: instrument.VERSION, definition: responseFormDraft.generate(selected) };
    });
    response.set('Cache-Control', 'private, no-store'); return result;
  }));
  service.post(`${root}/:linkId/instrument/backchecks`, endpoint(async (c, { auth, params, body, headers }, _, response) => {
    const project = await scope(c, auth, params); const data = instrument.checked(body, headers);
    const result = await c.transacting(async tx => {
      const { actor, inv, link, row } = await linkedScope(tx, auth, project, params, true);
      await grantLock(tx.db, actor.id, row.formActeeId, 'submission.update');
      const responseForm = await tx.db.maybeOne(sql`SELECT id,"acteeId" FROM forms
        WHERE "projectId" = ${project.id} AND "xmlFormId" = ${data.responseXmlFormId} AND "deletedAt" IS NULL FOR SHARE`);
      if (!responseForm) throw Problem.user.notFound();
      await grantLock(tx.db, actor.id, responseForm.acteeId, 'submission.read');
      const prior = await tx.db.maybeOne(sql`SELECT id FROM field_data_backchecks WHERE "caseId" = ${row.id} AND "requestId" = ${data.requestId}`);
      if (!prior) {
        if (inv.revision !== data.investigationRevision) throw Problem.user.investigationRevisionStale();
        if (inv.status !== 'open' || actor.archived) throw Problem.user.investigationInstrumentConflict();
        const eligible = new Set((await instrumentFindings(tx.db, inv, row, true)).slice(0, instrument.MAX_FINDINGS).map(item => item.findingId));
        if (data.findingIds.some(id => !eligible.has(id))) throw instrument.invalid();
      }
      const requestHash = links.hash({ actorId: actor.id, investigationId: inv.id, linkId: link.linkId, ...data });
      const requested = await requestBackcheck(tx.db, { ...data, caseId: row.id, claimVersionId: row.claimVersionId,
        projectId: project.id, formActeeId: row.formActeeId, responseForm, reviewerId: actor.id, requestHash });
      if (!requested.replayed) await tx.Audits.log(auth.actor, 'field_data.investigation.instrument.request', project,
        { investigationId: inv.id, linkId: link.linkId, backcheckId: requested.id, templateVersion: instrument.VERSION, findingCount: data.findingIds.length });
      return requested;
    });
    response.set('Cache-Control', 'private, no-store'); response.set('ETag', `"review-case-${result.revision}"`);
    response.set('Idempotency-Status', result.replayed ? 'replayed' : 'created'); response.status(201); return result;
  }));
  service.get(`${root}/:linkId`, endpoint(async (c, { auth, params }, _, response) => {
    const project = await scope(c, auth, params); if (!UUID_PATTERN.test(params.linkId ?? '')) throw Problem.user.notFound(); const actorId = auth.actor.get().id;
    const result = await c.transacting(async tx => {
      await managerLock(tx, actorId, project); const inv = await investigation(tx.db, project.id, params.id);
      const link = links.active(await eventsFor(tx.db, inv.id)).find(e => e.linkId === params.linkId.toLowerCase()); if (!link) throw Problem.user.notFound();
      const [row] = await caseRows(tx.db, project.id, [link.caseId], true); if (!row || row.claimVersionId !== link.claimVersionId) throw Problem.user.notFound();
      await grantLock(tx.db, actorId, row.formActeeId, 'submission.read');
      const decisions = await tx.db.any(sql`SELECT d.id,d.sequence,d.outcome,d.override,d."reasonCode",d.note,d."createdAt",a."displayName" AS "reviewerName",count(*) OVER ()::integer AS total
        FROM field_data_review_decisions d LEFT JOIN actors a ON a.id = d."reviewerId" WHERE d."caseId" = ${row.id} ORDER BY d.sequence DESC LIMIT 50`);
      const readable = await readableForms(tx, auth, project.id);
      // Hold grants for response forms while returning private backcheck metadata.
      const responseForms = await tx.db.any(sql`SELECT DISTINCT f.id,f."acteeId" FROM field_data_backchecks b JOIN forms f ON f.id = COALESCE(b."responseFormId",${row.formId})
        WHERE b."caseId" = ${row.id} AND f.id = ANY(${sql.array(readable, 'int4')}) AND f."projectId" = ${project.id} AND f."deletedAt" IS NULL ORDER BY f.id`);
      for (const form of responseForms) {
        // eslint-disable-next-line no-await-in-loop
        await grantLock(tx.db, actorId, form.acteeId, 'submission.read');
      }
      const backchecks = await tx.db.any(sql`SELECT b.id,b.status,b.question,b."dueAt",b."createdAt",b."linkedAt",a."displayName" AS "assigneeName",f."xmlFormId" AS "responseXmlFormId",
        rs."instanceId" AS "responseInstanceId",rsd."instanceId" AS "responseVersionInstanceId",rsd.current AS "responseCurrent",count(*) OVER ()::integer AS total
        FROM field_data_backchecks b JOIN forms f ON f.id = COALESCE(b."responseFormId",${row.formId}) AND f."projectId" = ${project.id} AND f."deletedAt" IS NULL
        LEFT JOIN submission_defs rsd ON rsd.id = b."responseSubmissionDefId" LEFT JOIN submissions rs ON rs.id = rsd."submissionId" AND rs."formId" = f.id AND rs."deletedAt" IS NULL AND rs.draft = FALSE
        LEFT JOIN actors a ON a.id = b."assignedTo"
        WHERE b."caseId" = ${row.id} AND f.id = ANY(${sql.array(responseForms.map(f => f.id), 'int4')}) AND (b.status <> 'linked' OR rs.id IS NOT NULL)
        ORDER BY b."createdAt" DESC,b.id DESC LIMIT 50`);
      const total = await tx.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_backchecks WHERE "caseId" = ${row.id}`);
      return { linkId: link.linkId, case: publicCase(row), decisions: decisions.map(({ total: omitted, ...d }) => d), decisionsOmitted: Math.max(0, (decisions[0]?.total ?? 0) - decisions.length),
        backchecks: backchecks.map(({ total: omitted, ...b }) => b), hiddenBackchecks: total - (backchecks[0]?.total ?? 0), backchecksOmitted: Math.max(0, (backchecks[0]?.total ?? 0) - backchecks.length) };
    });
    response.set('Cache-Control', 'private, no-store'); return result;
  }));
};
