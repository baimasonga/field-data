// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const up = async db => db.raw(`
  ALTER TABLE field_data_reverification_tasks ADD COLUMN IF NOT EXISTS "plannedVisitDate" DATE;
  ALTER TABLE field_data_reverification_task_events ADD COLUMN IF NOT EXISTS "plannedVisitDate" DATE;
  CREATE INDEX IF NOT EXISTS field_data_reverification_visit_day
    ON field_data_reverification_tasks ("assigneeId", "plannedVisitDate") WHERE status IN ('dispatched', 'closed');
`);
// Preserve dated work and its append-only history on rollback.
const down = async db => db.raw(`DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM field_data_reverification_tasks WHERE "plannedVisitDate" IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM field_data_reverification_task_events WHERE "plannedVisitDate" IS NOT NULL) THEN
    DROP INDEX IF EXISTS field_data_reverification_visit_day;
    ALTER TABLE field_data_reverification_tasks DROP COLUMN "plannedVisitDate";
    ALTER TABLE field_data_reverification_task_events DROP COLUMN "plannedVisitDate";
  END IF;
END $$`);
module.exports = { up, down };
