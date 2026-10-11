// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

// K4 reversible asset merges and splits (docs/field-intelligence/K4-asset-merge-split.md).
// Observations are never changed: an operation records which asset each
// affected observation now belongs to, and field_data_observation_owners
// resolves it for every reader.
const up = async (db) => {
  await db.raw(`ALTER TABLE field_data_assets
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS "mergedInto" UUID REFERENCES field_data_assets(id);
  ALTER TABLE field_data_assets DROP CONSTRAINT IF EXISTS field_data_assets_status_check;
  ALTER TABLE field_data_assets ADD CONSTRAINT field_data_assets_status_check
    CHECK (status IN ('active', 'merged') AND (status = 'merged') = ("mergedInto" IS NOT NULL));

  CREATE TABLE IF NOT EXISTS field_data_asset_operations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sequence BIGSERIAL UNIQUE,
    "projectId" INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    "requestId" UUID NOT NULL,
    "requestHash" TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('merge', 'split')),
    -- Merge: the asset kept and the asset merged into it. Split: the asset
    -- split and the new asset.
    "assetId" UUID NOT NULL REFERENCES field_data_assets(id),
    "otherAssetId" UUID NOT NULL REFERENCES field_data_assets(id),
    reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
    "actorId" INTEGER REFERENCES actors(id) ON DELETE SET NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    "undoneAt" TIMESTAMPTZ,
    "undoneBy" INTEGER REFERENCES actors(id) ON DELETE SET NULL,
    "undoReason" TEXT CHECK ("undoReason" IS NULL OR length(btrim("undoReason")) BETWEEN 1 AND 2000),
    UNIQUE ("projectId", "requestId"),
    CHECK ("assetId" <> "otherAssetId"),
    CHECK (("undoneAt" IS NULL) = ("undoReason" IS NULL))
  );
  CREATE INDEX IF NOT EXISTS field_data_asset_operations_assets ON field_data_asset_operations ("assetId", sequence);
  CREATE INDEX IF NOT EXISTS field_data_asset_operations_others ON field_data_asset_operations ("otherAssetId", sequence);

  CREATE TABLE IF NOT EXISTS field_data_asset_reassignments (
    "operationId" UUID NOT NULL REFERENCES field_data_asset_operations(id) ON DELETE CASCADE,
    "observationId" UUID NOT NULL REFERENCES field_data_asset_observations(id),
    "assetId" UUID NOT NULL REFERENCES field_data_assets(id),
    PRIMARY KEY ("operationId", "observationId")
  );
  CREATE INDEX IF NOT EXISTS field_data_asset_reassignments_observation ON field_data_asset_reassignments ("observationId");

  -- The asset each observation belongs to now: the latest operation that has
  -- not been undone, otherwise the asset it was recorded against.
  CREATE OR REPLACE VIEW field_data_observation_owners AS
    SELECT o.id AS "observationId", COALESCE(moved."assetId", o."assetId") AS "assetId"
    FROM field_data_asset_observations o
    LEFT JOIN LATERAL (
      SELECT r."assetId" FROM field_data_asset_reassignments r
      JOIN field_data_asset_operations op ON op.id = r."operationId" AND op."undoneAt" IS NULL
      WHERE r."observationId" = o.id ORDER BY op.sequence DESC LIMIT 1
    ) moved ON true;

  -- Operations are a history: only the undo may be recorded, once. They go
  -- only with their project.
  CREATE OR REPLACE FUNCTION field_data_guard_asset_operation() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        IF EXISTS (SELECT 1 FROM projects WHERE id = OLD."projectId") THEN
          RAISE EXCEPTION 'Asset operations are append-only' USING ERRCODE = '23514';
        END IF;
        RETURN OLD;
      END IF;
      IF (NEW.id, NEW.sequence, NEW."projectId", NEW."requestId", NEW."requestHash", NEW.kind, NEW."assetId",
          NEW."otherAssetId", NEW.reason, NEW."createdAt")
        IS DISTINCT FROM (OLD.id, OLD.sequence, OLD."projectId", OLD."requestId", OLD."requestHash", OLD.kind, OLD."assetId",
          OLD."otherAssetId", OLD.reason, OLD."createdAt")
        OR (NEW."actorId" IS DISTINCT FROM OLD."actorId" AND NEW."actorId" IS NOT NULL)
        OR (OLD."undoneAt" IS NOT NULL AND (NEW."undoneAt", NEW."undoReason") IS DISTINCT FROM (OLD."undoneAt", OLD."undoReason"))
        OR (OLD."undoneAt" IS NOT NULL AND NEW."undoneBy" IS DISTINCT FROM OLD."undoneBy" AND NEW."undoneBy" IS NOT NULL) THEN
        RAISE EXCEPTION 'Asset operations are append-only' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
    $$;
  DROP TRIGGER IF EXISTS field_data_asset_operation_guard ON field_data_asset_operations;
  CREATE TRIGGER field_data_asset_operation_guard BEFORE UPDATE OR DELETE ON field_data_asset_operations
    FOR EACH ROW EXECUTE FUNCTION field_data_guard_asset_operation();

  CREATE OR REPLACE FUNCTION field_data_guard_asset_reassignment() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM field_data_asset_operations WHERE id = OLD."operationId") THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION 'Asset reassignments are append-only' USING ERRCODE = '23514';
    END;
    $$;
  DROP TRIGGER IF EXISTS field_data_asset_reassignment_guard ON field_data_asset_reassignments;
  CREATE TRIGGER field_data_asset_reassignment_guard BEFORE UPDATE OR DELETE ON field_data_asset_reassignments
    FOR EACH ROW EXECUTE FUNCTION field_data_guard_asset_reassignment()`);
};

// Operations are a record of corrections: everything is kept on a rollback
// when any operation exists.
const down = async (db) => {
  await db.raw(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM field_data_asset_operations) THEN
        DROP VIEW IF EXISTS field_data_observation_owners;
        DROP TABLE field_data_asset_reassignments;
        DROP TABLE field_data_asset_operations;
        DROP FUNCTION IF EXISTS field_data_guard_asset_operation();
        DROP FUNCTION IF EXISTS field_data_guard_asset_reassignment();
        ALTER TABLE field_data_assets DROP CONSTRAINT IF EXISTS field_data_assets_status_check;
        ALTER TABLE field_data_assets DROP COLUMN IF EXISTS "mergedInto";
        ALTER TABLE field_data_assets DROP COLUMN IF EXISTS status;
      END IF;
    END $$`);
};

module.exports = { up, down };
