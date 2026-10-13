// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const up = async (db) => {
  await db.raw(`CREATE TABLE IF NOT EXISTS field_data_backcheck_calendars (
    "actorId" INTEGER PRIMARY KEY REFERENCES actors(id) ON DELETE CASCADE,
    "projectId" INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    settings JSONB NOT NULL,
    "updatedBy" INTEGER REFERENCES actors(id) ON DELETE SET NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
  );
  ALTER TABLE field_data_backchecks ADD COLUMN IF NOT EXISTS "plannedVisitDate" DATE;
  CREATE INDEX IF NOT EXISTS field_data_backchecks_visit_day ON field_data_backchecks ("assignedTo", "plannedVisitDate")
    WHERE status IN ('requested', 'linked')`);
};
const down = async (db) => {
  // Keep availability decisions and dated work on rollback.
  await db.raw(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM field_data_backcheck_calendars)
      AND NOT EXISTS (SELECT 1 FROM field_data_backchecks WHERE "plannedVisitDate" IS NOT NULL) THEN
      DROP TABLE field_data_backcheck_calendars;
      DROP INDEX IF EXISTS field_data_backchecks_visit_day;
      ALTER TABLE field_data_backchecks DROP COLUMN "plannedVisitDate";
    END IF;
  END $$`);
};
module.exports = { up, down };
