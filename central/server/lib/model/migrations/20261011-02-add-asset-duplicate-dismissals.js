// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

// K5 suggested duplicate assets (docs/field-intelligence/K5-duplicate-assets.md):
// a person's decision that two suggested assets are not the same. Kept, and
// withdrawable once.
const up = async (db) => {
  await db.raw(`CREATE TABLE IF NOT EXISTS field_data_asset_duplicate_dismissals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "projectId" INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    -- A pair is stored in one order, so it has one key.
    "assetId" UUID NOT NULL REFERENCES field_data_assets(id),
    "otherAssetId" UUID NOT NULL REFERENCES field_data_assets(id),
    reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
    "actorId" INTEGER REFERENCES actors(id) ON DELETE SET NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    "withdrawnAt" TIMESTAMPTZ,
    "withdrawnBy" INTEGER REFERENCES actors(id) ON DELETE SET NULL,
    CHECK ("assetId" < "otherAssetId")
  );
  CREATE UNIQUE INDEX IF NOT EXISTS field_data_asset_duplicate_dismissals_active
    ON field_data_asset_duplicate_dismissals ("assetId", "otherAssetId") WHERE "withdrawnAt" IS NULL;

  CREATE OR REPLACE FUNCTION field_data_guard_duplicate_dismissal() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        IF EXISTS (SELECT 1 FROM projects WHERE id = OLD."projectId") THEN
          RAISE EXCEPTION 'Duplicate dismissals are append-only' USING ERRCODE = '23514';
        END IF;
        RETURN OLD;
      END IF;
      IF (NEW.id, NEW."projectId", NEW."assetId", NEW."otherAssetId", NEW.reason, NEW."createdAt")
          IS DISTINCT FROM (OLD.id, OLD."projectId", OLD."assetId", OLD."otherAssetId", OLD.reason, OLD."createdAt")
        OR (NEW."actorId" IS DISTINCT FROM OLD."actorId" AND NEW."actorId" IS NOT NULL)
        OR (OLD."withdrawnAt" IS NOT NULL AND NEW."withdrawnAt" IS DISTINCT FROM OLD."withdrawnAt")
        OR (OLD."withdrawnAt" IS NOT NULL AND NEW."withdrawnBy" IS DISTINCT FROM OLD."withdrawnBy" AND NEW."withdrawnBy" IS NOT NULL) THEN
        RAISE EXCEPTION 'Duplicate dismissals are append-only' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
    $$;
  DROP TRIGGER IF EXISTS field_data_duplicate_dismissal_guard ON field_data_asset_duplicate_dismissals;
  CREATE TRIGGER field_data_duplicate_dismissal_guard BEFORE UPDATE OR DELETE ON field_data_asset_duplicate_dismissals
    FOR EACH ROW EXECUTE FUNCTION field_data_guard_duplicate_dismissal()`);
};

// Dismissals are decisions people made: the table is kept on a rollback when
// it holds any.
const down = async (db) => {
  await db.raw(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM field_data_asset_duplicate_dismissals) THEN
        DROP TABLE field_data_asset_duplicate_dismissals;
        DROP FUNCTION IF EXISTS field_data_guard_duplicate_dismissal();
      END IF;
    END $$`);
};

module.exports = { up, down };
