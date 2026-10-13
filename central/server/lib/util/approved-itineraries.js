// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { sql } = require('slonik');
const approvedItineraries = async (container, user) => {
  const plans = await container.db.any(sql`SELECT DISTINCT ON (i."visitDate") i.id, i.snapshot, i.note, i."createdAt",
      to_char(i."visitDate", 'YYYY-MM-DD') AS date FROM field_data_backcheck_itineraries i
      JOIN projects p ON p.id = i."projectId" AND p."deletedAt" IS NULL AND p.archived IS NOT TRUE
      WHERE i."actorId" = ${user.actorId} AND i."projectId" = ${user.projectId}
        AND i."visitDate" BETWEEN (clock_timestamp() AT TIME ZONE 'UTC')::date - 7 AND (clock_timestamp() AT TIME ZONE 'UTC')::date + 90
      ORDER BY i."visitDate", i."createdAt" DESC, i.id DESC LIMIT 30`);
  const ids = plans.flatMap(p => p.snapshot.route.stops.map(s => s.id));
  const available = ids.length === 0 ? [] : await container.db.any(sql`SELECT b.id, b."claimVersionId", b.question,
      to_char(b."plannedVisitDate", 'YYYY-MM-DD') AS date
      FROM field_data_backchecks b JOIN field_data_review_cases c ON c.id = b."caseId" AND c.status = 'in-review'
      JOIN field_data_claim_versions cv ON cv.id = b."claimVersionId" JOIN submission_defs sd ON sd.id = cv."submissionDefId" AND sd.current
      JOIN form_defs fd ON fd.id = sd."formDefId" AND fd."keyId" IS NULL
      JOIN field_data_submission_provenance provenance ON provenance."submissionDefId" = sd.id
        AND provenance."integrityHash" = CASE WHEN octet_length(sd.xml) <= 262144 THEN encode(sha256(convert_to(sd.xml, 'UTF8')), 'hex') ELSE NULL END
      JOIN submissions s ON s.id = sd."submissionId" AND s."deletedAt" IS NULL
      JOIN forms sf ON sf.id = s."formId" AND sf."deletedAt" IS NULL AND sf."projectId" = ${user.projectId}
      JOIN forms rf ON rf.id = COALESCE(b."responseFormId", sf.id) AND rf."projectId" = ${user.projectId} AND rf."deletedAt" IS NULL AND rf.state = 'open'
      WHERE b.id = ANY(${sql.array(ids, 'uuid')}) AND b."assignedTo" = ${user.actorId} AND b.status = 'requested'
        AND EXISTS (SELECT 1 FROM assignments a JOIN roles r ON r.id = a."roleId" WHERE a."actorId" = ${user.actorId} AND a."acteeId" = rf."acteeId" AND r.verbs ? 'submission.create')`);
  const fresh = new Map(available.map(row => [row.id, row]));
  return { items: plans.map(plan => {
    const stops = plan.snapshot.route.stops.flatMap(stop => {
      const current = fresh.get(stop.id);
      return current?.claimVersionId === stop.claimVersionId && current.date === plan.date
        ? [{ id: stop.id, order: stop.order, location: stop.location, question: current.question }] : [];
    });
    return { id: plan.id, date: plan.date, createdAt: plan.createdAt, note: plan.note, stops,
      withheld: plan.snapshot.route.stops.length - stops.length, needsReview: plan.snapshot.needsReview,
      method: plan.snapshot.method, start: plan.snapshot.start };
  }) };
};
module.exports = { approvedItineraries };
