// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const up = async (db) => {
  await db.raw(`
  ALTER TABLE field_data_reverification_tasks
    ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
    ADD COLUMN IF NOT EXISTS "assigneeId" INTEGER REFERENCES actors(id),
    ADD COLUMN IF NOT EXISTS "dispatchedAt" TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS "visitBy" TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS "closedAt" TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS "closureObservationId" UUID REFERENCES field_data_asset_observations(id);
  ALTER TABLE field_data_reverification_tasks DROP CONSTRAINT IF EXISTS field_data_reverification_tasks_status_check;
  ALTER TABLE field_data_reverification_tasks DROP CONSTRAINT IF EXISTS field_data_reverification_tasks_state_check;
  ALTER TABLE field_data_reverification_tasks ADD CONSTRAINT field_data_reverification_tasks_state_check CHECK (
    (status = 'queued' AND "assigneeId" IS NULL AND "dispatchedAt" IS NULL AND "closedAt" IS NULL AND "closureObservationId" IS NULL)
    OR (status = 'dispatched' AND "assigneeId" IS NOT NULL AND "dispatchedAt" IS NOT NULL AND "closedAt" IS NULL AND "closureObservationId" IS NULL)
    OR (status = 'closed' AND "assigneeId" IS NOT NULL AND "dispatchedAt" IS NOT NULL AND "closedAt" IS NOT NULL AND "closureObservationId" IS NOT NULL)
    OR (status = 'cancelled' AND "closedAt" IS NOT NULL AND "closureObservationId" IS NULL)
    OR (status = 'superseded' AND "closureObservationId" IS NULL));
  CREATE UNIQUE INDEX IF NOT EXISTS field_data_reverification_tasks_closure
    ON field_data_reverification_tasks ("closureObservationId") WHERE "closureObservationId" IS NOT NULL;
  CREATE INDEX IF NOT EXISTS field_data_reverification_tasks_assignee
    ON field_data_reverification_tasks ("assigneeId", "dispatchedAt" DESC, id) WHERE status = 'dispatched';
  CREATE TABLE IF NOT EXISTS field_data_reverification_task_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "taskId" UUID NOT NULL REFERENCES field_data_reverification_tasks(id),
    sequence INTEGER NOT NULL CHECK (sequence > 0),
    action TEXT NOT NULL CHECK (action IN ('dispatch', 'reassign', 'close', 'cancel')),
    "actorId" INTEGER NOT NULL REFERENCES actors(id),
    "assigneeId" INTEGER REFERENCES actors(id),
    "observationId" UUID REFERENCES field_data_asset_observations(id),
    "reasonCode" TEXT CHECK ("reasonCode" IS NULL OR "reasonCode" IN
      ('access-blocked', 'safety', 'asset-removed', 'duplicate', 'other')),
    "visitBy" TIMESTAMPTZ,
    note TEXT NOT NULL CHECK (length(btrim(note)) BETWEEN 1 AND 2000),
    "requestId" UUID NOT NULL, "requestHash" TEXT NOT NULL,
    "recordedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE ("taskId", sequence), UNIQUE ("taskId", "requestId"),
    CHECK ((action IN ('dispatch', 'reassign')) = ("assigneeId" IS NOT NULL AND "reasonCode" IS NULL AND "observationId" IS NULL)),
    CHECK ((action = 'close') = ("observationId" IS NOT NULL)),
    CHECK ((action = 'cancel') = ("reasonCode" IS NOT NULL))
  );
  CREATE OR REPLACE FUNCTION field_data_guard_reverification_event() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    RAISE EXCEPTION 'Re-verification task events are append-only' USING ERRCODE = '23514';
  END $$;
  DROP TRIGGER IF EXISTS field_data_reverification_event_guard ON field_data_reverification_task_events;
  CREATE TRIGGER field_data_reverification_event_guard BEFORE UPDATE OR DELETE
    ON field_data_reverification_task_events FOR EACH ROW EXECUTE FUNCTION field_data_guard_reverification_event()`);
};

// Narrowing would discard dispatch and closure history, so the objects are only
// removed while no task has left its K1 states. Otherwise they are kept and a
// later reapply is a no-op.
const down = async (db) => {
  await db.raw(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM field_data_reverification_tasks WHERE status NOT IN ('queued', 'superseded'))
      AND NOT EXISTS (SELECT 1 FROM field_data_reverification_task_events) THEN
      DROP TABLE field_data_reverification_task_events;
      DROP FUNCTION field_data_guard_reverification_event();
      DROP INDEX field_data_reverification_tasks_assignee;
      DROP INDEX field_data_reverification_tasks_closure;
      ALTER TABLE field_data_reverification_tasks DROP CONSTRAINT field_data_reverification_tasks_state_check;
      ALTER TABLE field_data_reverification_tasks
        DROP COLUMN revision, DROP COLUMN "assigneeId", DROP COLUMN "dispatchedAt",
        DROP COLUMN "visitBy", DROP COLUMN "closedAt", DROP COLUMN "closureObservationId";
      ALTER TABLE field_data_reverification_tasks ADD CONSTRAINT field_data_reverification_tasks_status_check
        CHECK (status IN ('queued', 'superseded'));
    END IF;
  END $$`);
};
module.exports = { up, down };
