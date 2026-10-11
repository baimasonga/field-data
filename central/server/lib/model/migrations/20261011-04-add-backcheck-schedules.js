// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

// O6 scheduled backcheck samples (docs/field-intelligence/O6-scheduled-backcheck-samples.md).
// One schedule per form; the operations runner draws each ended period's
// sample with the O3 rules and keeps a run record. A scheduled sample names
// its schedule. Run records are never changed.
const up = async (db) => {
  await db.raw(`CREATE TABLE IF NOT EXISTS field_data_backcheck_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "formId" INTEGER NOT NULL UNIQUE REFERENCES forms(id) ON DELETE CASCADE,
    rate INTEGER NOT NULL CHECK (rate BETWEEN 1 AND 100),
    "minPerCollector" INTEGER NOT NULL CHECK ("minPerCollector" BETWEEN 0 AND 20),
    frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly')),
    enabled BOOLEAN NOT NULL,
    -- The start of the period the next run samples, and when that run is due.
    "periodStart" TIMESTAMPTZ NOT NULL,
    "nextRunAt" TIMESTAMPTZ NOT NULL CHECK ("nextRunAt" > "periodStart"),
    "updatedBy" INTEGER REFERENCES actors(id) ON DELETE SET NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
  );
  CREATE INDEX IF NOT EXISTS field_data_backcheck_schedules_due ON field_data_backcheck_schedules ("nextRunAt") WHERE enabled;

  ALTER TABLE field_data_backcheck_samples
    ADD COLUMN IF NOT EXISTS "scheduleId" UUID REFERENCES field_data_backcheck_schedules(id) ON DELETE SET NULL;

  CREATE TABLE IF NOT EXISTS field_data_backcheck_schedule_runs (
    id BIGSERIAL PRIMARY KEY,
    "scheduleId" UUID NOT NULL REFERENCES field_data_backcheck_schedules(id) ON DELETE CASCADE,
    "periodStart" TIMESTAMPTZ NOT NULL,
    "periodEnd" TIMESTAMPTZ NOT NULL CHECK ("periodEnd" > "periodStart"),
    periods INTEGER NOT NULL CHECK (periods >= 1),
    outcome TEXT NOT NULL CHECK (outcome IN ('drawn', 'nothing-eligible', 'failed')),
    "sampleId" UUID REFERENCES field_data_backcheck_samples(id) ON DELETE SET NULL,
    eligible INTEGER NOT NULL CHECK (eligible >= 0),
    sampled INTEGER NOT NULL CHECK (sampled >= 0),
    error TEXT CHECK (error IS NULL OR length(error) <= 500),
    "ranAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE ("scheduleId", "periodStart"),
    CHECK (outcome = 'drawn' OR "sampleId" IS NULL),
    CHECK (outcome = 'failed' OR error IS NULL)
  );

  -- Run records are not changed; only the sample link may clear when a
  -- sample goes with its form, and a run goes with its schedule.
  CREATE OR REPLACE FUNCTION field_data_guard_backcheck_schedule_run() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        IF NOT EXISTS (SELECT 1 FROM field_data_backcheck_schedules WHERE id = OLD."scheduleId") THEN RETURN OLD; END IF;
        RAISE EXCEPTION 'Backcheck schedule runs are not changed' USING ERRCODE = '23514';
      END IF;
      IF (NEW.id, NEW."scheduleId", NEW."periodStart", NEW."periodEnd", NEW.periods, NEW.outcome, NEW.eligible,
          NEW.sampled, NEW.error, NEW."ranAt")
          IS DISTINCT FROM (OLD.id, OLD."scheduleId", OLD."periodStart", OLD."periodEnd", OLD.periods, OLD.outcome,
          OLD.eligible, OLD.sampled, OLD.error, OLD."ranAt")
        OR (NEW."sampleId" IS DISTINCT FROM OLD."sampleId" AND NEW."sampleId" IS NOT NULL) THEN
        RAISE EXCEPTION 'Backcheck schedule runs are not changed' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
    $$;
  DROP TRIGGER IF EXISTS field_data_backcheck_schedule_run_guard ON field_data_backcheck_schedule_runs;
  CREATE TRIGGER field_data_backcheck_schedule_run_guard BEFORE UPDATE OR DELETE ON field_data_backcheck_schedule_runs
    FOR EACH ROW EXECUTE FUNCTION field_data_guard_backcheck_schedule_run()`);
};

// Schedules and their runs are records of fieldwork decisions: kept on a
// rollback when any exist.
const down = async (db) => {
  await db.raw(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM field_data_backcheck_schedules) THEN
      DROP TABLE field_data_backcheck_schedule_runs;
      ALTER TABLE field_data_backcheck_samples DROP COLUMN "scheduleId";
      DROP TABLE field_data_backcheck_schedules;
      DROP FUNCTION IF EXISTS field_data_guard_backcheck_schedule_run();
    END IF;
  END $$`);
};

module.exports = { up, down };
