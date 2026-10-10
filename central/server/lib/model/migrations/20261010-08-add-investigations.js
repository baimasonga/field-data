// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

// F6 investigation records (docs/field-intelligence/F6-investigations.md): an
// investigation covers integrity findings of a project, keeps an append-only
// history and ends with a disposition. It changes nothing else.
const up = async (db) => {
  await db.raw(`CREATE TABLE IF NOT EXISTS field_data_investigations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "projectId" INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    "requestId" UUID NOT NULL,
    "requestHash" TEXT NOT NULL,
    title TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    disposition TEXT CHECK (disposition IN ('confirmed-issue', 'data-error', 'benign-pattern',
      'insufficient-evidence', 'policy-exception', 'duplicate')),
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
    "openedBy" INTEGER REFERENCES actors(id) ON DELETE SET NULL,
    "openedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE ("projectId", "requestId"),
    CHECK ((status = 'closed') = (disposition IS NOT NULL))
  );
  CREATE INDEX IF NOT EXISTS field_data_investigations_project ON field_data_investigations ("projectId", "updatedAt" DESC);

  CREATE TABLE IF NOT EXISTS field_data_investigation_findings (
    "investigationId" UUID NOT NULL REFERENCES field_data_investigations(id) ON DELETE CASCADE,
    "findingId" INTEGER NOT NULL REFERENCES field_data_integrity_flags(id) ON DELETE CASCADE,
    "addedBy" INTEGER REFERENCES actors(id) ON DELETE SET NULL,
    "addedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY ("investigationId", "findingId")
  );

  CREATE TABLE IF NOT EXISTS field_data_investigation_events (
    id BIGSERIAL PRIMARY KEY,
    "investigationId" UUID NOT NULL REFERENCES field_data_investigations(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('opened', 'findings-added', 'note', 'closed', 'reopened')),
    "actorId" INTEGER REFERENCES actors(id) ON DELETE SET NULL,
    note TEXT CHECK (note IS NULL OR length(note) <= 4000),
    disposition TEXT,
    "findingIds" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
  );
  CREATE INDEX IF NOT EXISTS field_data_investigation_events_investigation ON field_data_investigation_events ("investigationId", id);

  -- The history is append-only; only the actor link may become null when an
  -- actor is purged, and a whole investigation goes when its project does.
  CREATE OR REPLACE FUNCTION field_data_guard_investigation_event() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        IF NOT EXISTS (SELECT 1 FROM field_data_investigations WHERE id = OLD."investigationId") THEN RETURN OLD; END IF;
        RAISE EXCEPTION 'Investigation history is append-only' USING ERRCODE = '23514';
      END IF;
      IF (NEW.id, NEW."investigationId", NEW.kind, NEW.note, NEW.disposition, NEW."findingIds", NEW."createdAt")
          IS DISTINCT FROM (OLD.id, OLD."investigationId", OLD.kind, OLD.note, OLD.disposition, OLD."findingIds", OLD."createdAt")
        OR (NEW."actorId" IS DISTINCT FROM OLD."actorId" AND NEW."actorId" IS NOT NULL) THEN
        RAISE EXCEPTION 'Investigation history is append-only' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
    $$;
  DROP TRIGGER IF EXISTS field_data_investigation_event_guard ON field_data_investigation_events;
  CREATE TRIGGER field_data_investigation_event_guard BEFORE UPDATE OR DELETE ON field_data_investigation_events
    FOR EACH ROW EXECUTE FUNCTION field_data_guard_investigation_event();

  -- An investigation goes only with its project, never on its own.
  CREATE OR REPLACE FUNCTION field_data_guard_investigation_delete() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF EXISTS (SELECT 1 FROM projects WHERE id = OLD."projectId") THEN
        RAISE EXCEPTION 'Investigations are not deleted' USING ERRCODE = '23514';
      END IF;
      RETURN OLD;
    END;
    $$;
  DROP TRIGGER IF EXISTS field_data_investigation_delete_guard ON field_data_investigations;
  CREATE TRIGGER field_data_investigation_delete_guard BEFORE DELETE ON field_data_investigations
    FOR EACH ROW EXECUTE FUNCTION field_data_guard_investigation_delete()`);
};

// Investigations are records people wrote: the tables are kept on a rollback
// when they hold any.
const down = async (db) => {
  await db.raw(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM field_data_investigations) THEN
        DROP TABLE field_data_investigation_events;
        DROP TABLE field_data_investigation_findings;
        DROP TABLE field_data_investigations;
        DROP FUNCTION IF EXISTS field_data_guard_investigation_event();
        DROP FUNCTION IF EXISTS field_data_guard_investigation_delete();
      END IF;
    END $$`);
};

module.exports = { up, down };
