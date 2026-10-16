// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { sql } = require('slonik');
// Used both at manager preview and when refreshing an approved collector route.
// Locations come from the task's pinned observation, never a different asset fact.
const reverificationRoute = (db, projectId, actorId, date, limit, maxBytes) => db.any(sql`
  SELECT t.id, t.revision, t."observationId", owner."assetId", o."claimVersionId", a.name AS "assetName", o.predicate,
    s."instanceId", f."xmlFormId", f."acteeId" AS "sourceActee", f."acteeId" AS "responseActee",
    f.state AS "responseState", f."deletedAt" AS "responseDeleted", sd.current,
    s."deletedAt" AS "sourceDeleted", f."deletedAt" AS "formDeleted", fd."keyId",
    (s."formId" = a."formId" AND o."sourceHash" = p."integrityHash") AS "observationVerified",
    response_def.name AS "formName", response_def.version AS "formVersion", t."visitBy" AS "dueAt",
    (SELECT e.note FROM field_data_reverification_task_events e WHERE e."taskId" = t.id
      AND e.action IN ('dispatch', 'reassign') ORDER BY e.sequence DESC LIMIT 1) AS question,
    count(*) OVER () AS total,
    CASE WHEN octet_length(sd.xml) <= ${maxBytes} AND fd."keyId" IS NULL
      AND p."integrityHash" = encode(sha256(convert_to(sd.xml, 'UTF8')), 'hex') THEN sd.xml ELSE NULL END AS xml,
    (SELECT ff.path FROM form_fields ff WHERE ff."formId" = s."formId" AND ff."schemaId" = fd."schemaId" AND ff.type = 'geopoint'
      AND NOT EXISTS (SELECT 1 FROM form_fields r WHERE r."schemaId" = fd."schemaId" AND r.type = 'repeat' AND ff.path LIKE r.path || '/%')
      ORDER BY ff."order" LIMIT 1) AS "geoPath",
    EXISTS (SELECT 1 FROM assignments ass JOIN roles r ON r.id = ass."roleId" WHERE ass."actorId" = ${actorId}
      AND ass."acteeId" = f."acteeId" AND r.verbs ? 'submission.create') AS eligible
  FROM field_data_reverification_tasks t
  JOIN field_data_asset_observations o ON o.id = t."observationId"
  JOIN field_data_observation_owners owner ON owner."observationId" = o.id
  JOIN field_data_assets a ON a.id = owner."assetId"
  JOIN forms f ON f.id = a."formId" AND f."projectId" = ${projectId}
  JOIN form_defs response_def ON response_def.id = f."currentDefId"
  JOIN field_data_claim_versions cv ON cv.id = o."claimVersionId"
  JOIN submission_defs sd ON sd.id = cv."submissionDefId"
  JOIN submissions s ON s.id = sd."submissionId"
  JOIN form_defs fd ON fd.id = sd."formDefId"
  LEFT JOIN field_data_submission_provenance p ON p."submissionDefId" = sd.id
  WHERE a."projectId" = ${projectId} AND t."assigneeId" = ${actorId}
    AND t.status = 'dispatched' AND t."plannedVisitDate" = ${date}::date
  ORDER BY t.id LIMIT ${limit}`);
module.exports = { reverificationRoute };
