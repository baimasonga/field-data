// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const up = async (db) => {
  await db.raw(`CREATE TABLE IF NOT EXISTS field_data_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "projectId" INTEGER NOT NULL REFERENCES projects(id),
    "formId" INTEGER NOT NULL REFERENCES forms(id),
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
    "assetType" TEXT NOT NULL CHECK (length("assetType") BETWEEN 1 AND 100),
    "externalId" TEXT NOT NULL CHECK (length("externalId") BETWEEN 1 AND 200),
    "requestId" UUID NOT NULL, "requestHash" TEXT NOT NULL,
    "actorId" INTEGER NOT NULL REFERENCES actors(id),
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE ("projectId", "externalId"), UNIQUE ("projectId", "requestId")
  );
  CREATE TABLE IF NOT EXISTS field_data_asset_observations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "assetId" UUID NOT NULL REFERENCES field_data_assets(id),
    sequence INTEGER NOT NULL CHECK (sequence > 0),
    "previousObservationId" UUID REFERENCES field_data_asset_observations(id),
    "claimVersionId" UUID NOT NULL REFERENCES field_data_claim_versions(id),
    "sourceHash" TEXT NOT NULL,
    predicate TEXT NOT NULL CHECK (length(predicate) BETWEEN 1 AND 100),
    state TEXT NOT NULL CHECK (state IN ('known', 'unknown', 'not-observed', 'not-applicable')),
    value TEXT CHECK (value IS NULL OR length(value) <= 2000),
    "validFrom" TIMESTAMPTZ NOT NULL,
    "validityDays" INTEGER NOT NULL CHECK ("validityDays" BETWEEN 1 AND 3650),
    "graceDays" INTEGER NOT NULL CHECK ("graceDays" BETWEEN 0 AND 365),
    "policyVersion" TEXT NOT NULL DEFAULT 'asset-age@1' CHECK ("policyVersion" = 'asset-age@1'),
    "requestId" UUID NOT NULL, "requestHash" TEXT NOT NULL,
    "actorId" INTEGER NOT NULL REFERENCES actors(id),
    note TEXT NOT NULL CHECK (length(btrim(note)) BETWEEN 1 AND 2000),
    "recordedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE ("assetId", sequence), UNIQUE ("assetId", "requestId"),
    CHECK ((state = 'known') = (value IS NOT NULL))
  );
  CREATE INDEX IF NOT EXISTS field_data_asset_observations_predicate
    ON field_data_asset_observations ("assetId", predicate, "validFrom" DESC, sequence DESC);
  CREATE TABLE IF NOT EXISTS field_data_reverification_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "observationId" UUID NOT NULL UNIQUE REFERENCES field_data_asset_observations(id),
    "dueAt" TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'superseded')),
    reason TEXT NOT NULL DEFAULT 'age-policy-review-due',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    "supersededAt" TIMESTAMPTZ,
    CHECK ((status = 'superseded') = ("supersededAt" IS NOT NULL))
  );
  CREATE OR REPLACE FUNCTION field_data_guard_asset_observation() RETURNS trigger LANGUAGE plpgsql AS $$
  DECLARE prior field_data_asset_observations%ROWTYPE;
  BEGIN
    IF TG_OP <> 'INSERT' THEN
      RAISE EXCEPTION 'Asset observations are append-only' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO prior FROM field_data_asset_observations
      WHERE "assetId" = NEW."assetId" AND predicate = NEW.predicate
      ORDER BY sequence DESC LIMIT 1;
    IF (FOUND AND (NEW."previousObservationId" IS DISTINCT FROM prior.id OR NEW.sequence <= prior.sequence))
      OR (NOT FOUND AND NEW."previousObservationId" IS NOT NULL) THEN
      RAISE EXCEPTION 'Invalid asset observation lineage' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM field_data_assets a
      JOIN field_data_claim_versions cv ON cv.id = NEW."claimVersionId"
      JOIN submission_defs sd ON sd.id = cv."submissionDefId"
      JOIN submissions s ON s.id = sd."submissionId"
      JOIN forms f ON f.id = s."formId"
      WHERE a.id = NEW."assetId" AND f."projectId" = a."projectId") THEN
      RAISE EXCEPTION 'Asset source crosses project boundary' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END $$;
  DROP TRIGGER IF EXISTS field_data_asset_observation_guard ON field_data_asset_observations;
  CREATE TRIGGER field_data_asset_observation_guard BEFORE INSERT OR UPDATE OR DELETE
    ON field_data_asset_observations FOR EACH ROW EXECUTE FUNCTION field_data_guard_asset_observation()`);
};
const down = async (db) => {
  await db.raw(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM field_data_assets) THEN
      DROP TABLE field_data_reverification_tasks;
      DROP TABLE field_data_asset_observations;
      DROP TABLE field_data_assets;
      DROP FUNCTION field_data_guard_asset_observation();
    END IF;
  END $$`);
};
module.exports = { up, down };
