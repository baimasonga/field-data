// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { sql } = require('slonik');
// Completed visits retain their reservation. Cancelled work releases capacity.
// An optional task exclusion permits an assignment to retain its own slot.
const visitUsage = async (db, projectId, excludeTask = null) => new Map((await db.any(sql`
  SELECT v.actor, to_char(v.date, 'YYYY-MM-DD') AS date, count(*)::integer AS used
  FROM (
    SELECT "assignedTo" AS actor, "plannedVisitDate" AS date FROM field_data_backchecks
      WHERE status IN ('requested', 'linked') AND "plannedVisitDate" IS NOT NULL
    UNION ALL
    SELECT "assigneeId" AS actor, "plannedVisitDate" AS date FROM field_data_reverification_tasks
      WHERE status IN ('dispatched', 'closed') AND "plannedVisitDate" IS NOT NULL
      AND (${excludeTask}::uuid IS NULL OR id <> ${excludeTask}::uuid)
  ) v JOIN field_keys fk ON fk."actorId" = v.actor AND fk."projectId" = ${projectId}
  GROUP BY v.actor, v.date`)).map(row => [`${row.actor}|${row.date}`, row.used]));
module.exports = { visitUsage };
