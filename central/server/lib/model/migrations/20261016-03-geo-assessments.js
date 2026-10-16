// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const up = async db => db.raw(`CREATE TABLE IF NOT EXISTS field_data_geo_assessments (
 id UUID PRIMARY KEY, "submissionDefId" INTEGER NOT NULL REFERENCES submission_defs(id) ON DELETE CASCADE,
 sequence INTEGER NOT NULL CHECK (sequence BETWEEN 1 AND 50), "requestId" UUID NOT NULL, "requestHash" TEXT NOT NULL,
 "actorId" INTEGER REFERENCES actors(id) ON DELETE SET NULL, "actorName" TEXT NOT NULL,
 "sourceFingerprint" TEXT NOT NULL CHECK (length("sourceFingerprint") = 64), source JSONB NOT NULL,
 outcome TEXT NOT NULL CHECK (outcome IN ('supports','conflicts','unclear','unavailable')),
 claim TEXT NOT NULL CHECK (length(claim) BETWEEN 10 AND 2000), reason TEXT NOT NULL CHECK (length(reason) BETWEEN 10 AND 2000),
 limitations TEXT NOT NULL CHECK (length(limitations) BETWEEN 10 AND 2000), citation JSONB,
 "reviewedImage" BOOLEAN NOT NULL, "reviewedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 CHECK (outcome NOT IN ('supports','conflicts') OR ("reviewedImage" AND citation IS NOT NULL AND citation->>'url' IS NOT NULL)),
 CHECK (outcome <> 'unavailable' OR (NOT "reviewedImage" AND citation IS NULL)),
 UNIQUE ("submissionDefId", "requestId"), UNIQUE ("submissionDefId", sequence)
);
CREATE OR REPLACE FUNCTION field_data_guard_geo_assessment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
   IF NOT EXISTS (SELECT 1 FROM submission_defs WHERE id = OLD."submissionDefId") THEN RETURN OLD; END IF;
 ELSE
   IF NEW."actorId" IS NULL AND NOT EXISTS (SELECT 1 FROM actors WHERE id = OLD."actorId")
      AND to_jsonb(NEW) - 'actorId' = to_jsonb(OLD) - 'actorId' THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'Geospatial assessments are append-only' USING ERRCODE = '23514';
END $$;
DROP TRIGGER IF EXISTS field_data_geo_assessment_guard ON field_data_geo_assessments;
CREATE TRIGGER field_data_geo_assessment_guard BEFORE UPDATE OR DELETE ON field_data_geo_assessments
 FOR EACH ROW EXECUTE FUNCTION field_data_guard_geo_assessment();`);
const down = async db => db.raw(`DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM field_data_geo_assessments) THEN
   DROP TABLE field_data_geo_assessments; DROP FUNCTION field_data_guard_geo_assessment();
 END IF;
END $$`);
module.exports = { up, down };
