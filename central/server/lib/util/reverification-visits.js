// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { sql } = require('slonik');
const reverificationVisits = async (container, user) => {
  const rows = await container.db.any(sql`SELECT count(*) OVER()::integer AS total, t.id, t."visitBy", t."dispatchedAt", to_char(t."plannedVisitDate", 'YYYY-MM-DD') AS "plannedVisitDate",
      a.name AS "assetName", a."externalId", a."assetType", o.predicate, f."xmlFormId", fd.name AS "formName",
      (f.state = 'open') AS actionable,
      (SELECT e.note FROM field_data_reverification_task_events e WHERE e."taskId" = t.id
        AND e.action IN ('dispatch', 'reassign') ORDER BY e.sequence DESC LIMIT 1) AS instruction
      FROM field_data_reverification_tasks t
      JOIN field_data_asset_observations o ON o.id = t."observationId"
      JOIN field_data_observation_owners owner ON owner."observationId" = o.id
      JOIN field_data_assets a ON a.id = owner."assetId"
      JOIN projects p ON p.id = a."projectId" AND p."deletedAt" IS NULL AND p.archived IS NOT TRUE
      JOIN forms f ON f.id = a."formId" AND f."projectId" = ${user.projectId} AND f."deletedAt" IS NULL
      JOIN form_defs fd ON fd.id = f."currentDefId"
      WHERE t.status = 'dispatched' AND t."assigneeId" = ${user.actorId}
        AND EXISTS (SELECT 1 FROM assignments ass JOIN roles r ON r.id = ass."roleId"
          WHERE ass."actorId" = ${user.actorId} AND ass."acteeId" = f."acteeId" AND r.verbs ? 'submission.create')
      ORDER BY t."dispatchedAt" DESC, t.id DESC LIMIT 51`);
  const total = rows[0]?.total ?? 0;
  return { items: rows.slice(0, 50).map(row => { const visit = { ...row }; delete visit.total; return visit; }), complete: total <= 50, omitted: Math.max(0, total - 50) };
};
module.exports = { reverificationVisits };
