// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { sql } = require('slonik');
const { getOrNotFound } = require('../util/promise');
const Problem = require('../util/problem');
const { validDate, validateCalendar, quotaOn } = require('../util/backcheck-calendar');
const { itinerary } = require('../util/backcheck-route');
const { roadEstimate } = require('../util/backcheck-road');
const { parseGeopoint } = require('../util/fieldwork-integrity');
const { parseInstance, answerAt } = require('../util/contradiction-rules');
const { ALLOCATION_LOCK } = require('../util/backcheck-request');
const LIMITS = { maxStops: 100, maxSourceBytes: 262144 };
const invalid = () => Problem.user.reviewAssignmentInvalid();
const actorFor = async (db, projectId, actorId) => {
  if (!Number.isSafeInteger(actorId) || actorId < 1) throw invalid();
  const actor = await db.maybeOne(sql`SELECT a.id, a."displayName" AS name FROM field_keys fk JOIN actors a ON a.id = fk."actorId"
    WHERE fk."projectId" = ${projectId} AND a.id = ${actorId} AND a."deletedAt" IS NULL`);
  if (actor == null) throw Problem.user.notFound();
  return actor;
};
module.exports = (service, endpoint) => {
  const projectFor = async (container, auth, params, write) => {
    const project = await container.Projects.getById(params.projectId).then(getOrNotFound);
    await auth.canOrReject(write ? 'project.update' : 'project.read', project);
    return project;
  };
  const root = '/projects/:projectId/backcheck-calendars';
  service.get(root, endpoint(async (container, { params, auth }, _, response) => {
    const project = await projectFor(container, auth, params, false);
    response.set('Cache-Control', 'private, no-store');
    return container.db.any(sql`SELECT a.id, a."displayName" AS name, c.settings, c."updatedAt",
      (SELECT count(*)::integer FROM field_data_backchecks b WHERE b."assignedTo" = a.id AND b.status = 'requested') AS pending
      FROM field_keys fk JOIN actors a ON a.id = fk."actorId" AND a."deletedAt" IS NULL
      LEFT JOIN field_data_backcheck_calendars c ON c."actorId" = a.id AND c."projectId" = ${project.id}
      WHERE fk."projectId" = ${project.id} ORDER BY a."displayName", a.id`);
  }));
  service.put(`${root}/:actorId`, endpoint(async (container, { params, auth, body }, _, response) => {
    const project = await projectFor(container, auth, params, true);
    const actor = await actorFor(container.db, project.id, Number(params.actorId));
    const settings = validateCalendar(body);
    if (settings == null) throw invalid();
    const row = await container.transacting(async ({ db }) => {
      await db.query(sql`SELECT pg_advisory_xact_lock(${ALLOCATION_LOCK}, ${project.id})`);
      const result = await db.one(sql`INSERT INTO field_data_backcheck_calendars ("actorId", "projectId", settings, "updatedBy")
        VALUES (${actor.id}, ${project.id}, ${JSON.stringify(settings)}, ${auth.actor.orNull().id})
        ON CONFLICT ("actorId") DO UPDATE SET settings = EXCLUDED.settings, "updatedBy" = EXCLUDED."updatedBy", "updatedAt" = clock_timestamp()
        RETURNING settings, "updatedAt"`);
      await db.query(sql`INSERT INTO audits ("actorId", action, "acteeId", details, "loggedAt", processed, failures)
        VALUES (${auth.actor.orNull().id}, 'field_data.backcheck.calendar.configure', ${project.acteeId},
          ${JSON.stringify({ actorId: actor.id, settings })}, clock_timestamp(), NULL, 0)`);
      return result;
    });
    response.set('Cache-Control', 'private, no-store');
    return { ...actor, ...row };
  }));
  service.get('/projects/:projectId/backcheck-route', endpoint(async (container, { params, auth, query }, _, response) => {
    const project = await projectFor(container, auth, params, true);
    const actor = await actorFor(container.db, project.id, Number(query.actorId));
    if (!validDate(query.date) || typeof query.startLat !== 'string' || !query.startLat.trim()
      || typeof query.startLon !== 'string' || !query.startLon.trim()) throw invalid();
    const start = { latitude: Number(query.startLat), longitude: Number(query.startLon) };
    const visitMinutes = query.visitMinutes == null ? 30 : Number(query.visitMinutes);
    const dayMinutes = query.dayMinutes == null ? 480 : Number(query.dayMinutes);
    if (!Number.isInteger(visitMinutes) || visitMinutes < 1 || visitMinutes > 480
      || !Number.isInteger(dayMinutes) || dayMinutes < 1 || dayMinutes > 1440) throw invalid();
    if (!Number.isFinite(start.latitude) || Math.abs(start.latitude) > 90 || !Number.isFinite(start.longitude) || Math.abs(start.longitude) > 180) throw invalid();
    response.set('Cache-Control', 'private, no-store');
    const rows = await container.db.any(sql`SELECT b.id, b."caseId", b.question, s."instanceId", sf."xmlFormId", sf."acteeId" AS "sourceActee",
      rf."acteeId" AS "responseActee", rf.state AS "responseState", rf."deletedAt" AS "responseDeleted",
      sd.current, s."deletedAt" AS "sourceDeleted", sf."deletedAt" AS "formDeleted", c.status AS "caseStatus", fd."keyId",
      count(*) OVER () AS total,
      CASE WHEN octet_length(sd.xml) <= ${LIMITS.maxSourceBytes} AND fd."keyId" IS NULL
        AND p."integrityHash" = encode(sha256(convert_to(sd.xml, 'UTF8')), 'hex') THEN sd.xml ELSE NULL END AS xml,
      (SELECT ff.path FROM form_fields ff WHERE ff."formId" = sf.id AND ff."schemaId" = fd."schemaId" AND ff.type = 'geopoint'
        AND NOT EXISTS (SELECT 1 FROM form_fields r WHERE r."schemaId" = fd."schemaId" AND r.type = 'repeat' AND ff.path LIKE r.path || '/%')
        ORDER BY ff."order" LIMIT 1) AS "geoPath",
      EXISTS (SELECT 1 FROM assignments ass JOIN roles r ON r.id = ass."roleId" WHERE ass."actorId" = ${actor.id}
        AND ass."acteeId" = rf."acteeId" AND r.verbs ? 'submission.create') AS eligible
      FROM field_data_backchecks b JOIN field_data_review_cases c ON c.id = b."caseId"
      JOIN field_data_claim_versions v ON v.id = b."claimVersionId" JOIN submission_defs sd ON sd.id = v."submissionDefId"
      JOIN submissions s ON s.id = sd."submissionId" JOIN forms sf ON sf.id = s."formId" AND sf."projectId" = ${project.id}
      JOIN forms rf ON rf.id = COALESCE(b."responseFormId", sf.id) AND rf."projectId" = ${project.id}
      JOIN form_defs fd ON fd.id = sd."formDefId" LEFT JOIN field_data_submission_provenance p ON p."submissionDefId" = sd.id
      WHERE b."assignedTo" = ${actor.id} AND b.status = 'requested' AND b."plannedVisitDate" = ${query.date}::date
      ORDER BY b.id LIMIT ${LIMITS.maxStops}`);
    const excluded = { permission: 0, inactive: 0, collectorUnavailable: 0, encryptedSource: 0, sourceUnverified: 0, missingLocation: 0 };
    const visits = []; let uncertainLocations = 0;
    for (const row of rows) {
      // eslint-disable-next-line no-await-in-loop
      const readable = await auth.can('submission.read', row.sourceActee) && await auth.can('submission.read', row.responseActee); // eslint-disable-line no-await-in-loop
      let reason = !readable ? 'permission' : !row.current || row.sourceDeleted != null || row.formDeleted != null
        || row.caseStatus !== 'in-review' ? 'inactive' : !row.eligible || row.responseDeleted != null || row.responseState !== 'open'
          ? 'collectorUnavailable' : row.keyId != null ? 'encryptedSource' : row.xml == null ? 'sourceUnverified' : null;
      let location = null;
      if (reason == null) {
        try { location = row.geoPath == null ? null : parseGeopoint(answerAt(parseInstance(row.xml), row.geoPath, null)); } catch { location = null; }
        if (location == null) reason = 'missingLocation';
      }
      if (reason != null) { excluded[reason] += 1; continue; } // eslint-disable-line no-continue
      const uncertain = location.accuracy == null || location.accuracy < 0 || location.accuracy > 100;
      if (uncertain) uncertainLocations += 1;
      visits.push({ id: row.id, caseId: row.caseId, instanceId: row.instanceId, xmlFormId: row.xmlFormId, location, uncertain });
    }
    const calendar = await container.db.maybeOne(sql`SELECT settings FROM field_data_backcheck_calendars
      WHERE "actorId" = ${actor.id} AND "projectId" = ${project.id}`);
    const used = await container.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_backchecks
      WHERE "assignedTo" = ${actor.id} AND "plannedVisitDate" = ${query.date}::date AND status IN ('requested', 'linked')`);
    const unplanned = await container.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_backchecks
      WHERE "assignedTo" = ${actor.id} AND "plannedVisitDate" IS NULL AND status = 'requested'`);
    const capacity = quotaOn(calendar?.settings, query.date);
    const truncated = rows.length > 0 && Number(rows[0].total) > rows.length;
    const omitted = Object.values(excluded).reduce((sum, n) => sum + n, 0);
    const route = itinerary(start, visits);
    const road = await roadEstimate(start, route.stops);
    const totalMinutes = road.status === 'ok' ? Math.ceil(road.travelMinutes + visits.length * visitMinutes) : null;
    const timing = { visitMinutes, dayMinutes, totalMinutes, overBudget: totalMinutes == null ? null : totalMinutes > dayMinutes };
    return { actor, date: query.date, start, capacity, used, unplanned, excluded, uncertainLocations, truncated,
      needsReview: project.archived === true || unplanned > 0 || omitted > 0 || truncated || capacity == null || used > capacity || uncertainLocations > 0
        || road.status !== 'ok' || road.maxSnapMeters > 100 || timing.overBudget === true,
      method: 'nearest-next-stop, great-circle distance, return to start', route, road, timing };
  }));
};

module.exports.LIMITS = LIMITS;
