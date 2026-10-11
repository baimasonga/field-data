// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

// S4 recode rules for exports (docs/field-intelligence/S4-export-recodes.md):
// how answers from earlier versions of a form line up with the current one.
// Kept, and retirable once.
const up = async (db) => {
  await db.raw(`CREATE TABLE IF NOT EXISTS field_data_export_recodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "projectId" INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    "formId" INTEGER NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('value', 'path')),
    path TEXT NOT NULL CHECK (length(path) BETWEEN 2 AND 1000),
    "fromPath" TEXT CHECK ("fromPath" IS NULL OR length("fromPath") BETWEEN 2 AND 1000),
    versions TEXT[] NOT NULL CHECK (cardinality(versions) BETWEEN 1 AND 50),
    "values" JSONB CHECK ("values" IS NULL OR jsonb_typeof("values") = 'object'),
    reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
    "actorId" INTEGER REFERENCES actors(id) ON DELETE SET NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    "retiredAt" TIMESTAMPTZ,
    "retiredBy" INTEGER REFERENCES actors(id) ON DELETE SET NULL,
    "retireReason" TEXT CHECK ("retireReason" IS NULL OR length(btrim("retireReason")) BETWEEN 1 AND 2000),
    CHECK ((kind = 'path' AND "fromPath" IS NOT NULL AND "values" IS NULL)
      OR (kind = 'value' AND "fromPath" IS NULL AND "values" IS NOT NULL)),
    CHECK (("retiredAt" IS NULL) = ("retireReason" IS NULL))
  );
  CREATE INDEX IF NOT EXISTS field_data_export_recodes_form ON field_data_export_recodes ("formId") WHERE "retiredAt" IS NULL;

  CREATE OR REPLACE FUNCTION field_data_guard_export_recode() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        IF EXISTS (SELECT 1 FROM forms WHERE id = OLD."formId") THEN
          RAISE EXCEPTION 'Recode rules are append-only' USING ERRCODE = '23514';
        END IF;
        RETURN OLD;
      END IF;
      IF (NEW.id, NEW."projectId", NEW."formId", NEW.kind, NEW.path, NEW."fromPath", NEW.versions, NEW."values", NEW.reason, NEW."createdAt")
          IS DISTINCT FROM (OLD.id, OLD."projectId", OLD."formId", OLD.kind, OLD.path, OLD."fromPath", OLD.versions, OLD."values", OLD.reason, OLD."createdAt")
        OR (NEW."actorId" IS DISTINCT FROM OLD."actorId" AND NEW."actorId" IS NOT NULL)
        OR (OLD."retiredAt" IS NOT NULL AND (NEW."retiredAt", NEW."retireReason") IS DISTINCT FROM (OLD."retiredAt", OLD."retireReason"))
        OR (OLD."retiredAt" IS NOT NULL AND NEW."retiredBy" IS DISTINCT FROM OLD."retiredBy" AND NEW."retiredBy" IS NOT NULL) THEN
        RAISE EXCEPTION 'Recode rules are append-only' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
    $$;
  DROP TRIGGER IF EXISTS field_data_export_recode_guard ON field_data_export_recodes;
  CREATE TRIGGER field_data_export_recode_guard BEFORE UPDATE OR DELETE ON field_data_export_recodes
    FOR EACH ROW EXECUTE FUNCTION field_data_guard_export_recode()`);
};

// Rules are decisions people made: the table is kept on a rollback when it
// holds any.
const down = async (db) => {
  await db.raw(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM field_data_export_recodes) THEN
        DROP TABLE field_data_export_recodes;
        DROP FUNCTION IF EXISTS field_data_guard_export_recode();
      END IF;
    END $$`);
};

module.exports = { up, down };
