// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const up = async db => db.raw(`CREATE TABLE IF NOT EXISTS field_data_geo_analyses (
 id UUID PRIMARY KEY,"submissionDefId" INTEGER NOT NULL REFERENCES submission_defs(id) ON DELETE CASCADE,
 "requestId" UUID NOT NULL,"requestHash" TEXT NOT NULL,"actorId" INTEGER REFERENCES actors(id) ON DELETE SET NULL,"actorName" TEXT NOT NULL,
 "sourceFingerprint" TEXT NOT NULL,source JSONB NOT NULL,catalogue TEXT NOT NULL,mode TEXT NOT NULL CHECK(mode IN ('footprint','change')),
 status TEXT NOT NULL CHECK(status IN ('pending','complete','failed')),result JSONB,failure TEXT,
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),"completedAt" TIMESTAMPTZ,
 CHECK(length("sourceFingerprint")=64),CHECK(result IS NULL OR octet_length(result::text)<=524288),
 CHECK((status='pending' AND result IS NULL AND failure IS NULL AND "completedAt" IS NULL) OR
       (status='complete' AND result IS NOT NULL AND failure IS NULL AND "completedAt" IS NOT NULL) OR
       (status='failed' AND result IS NULL AND failure IS NOT NULL AND "completedAt" IS NOT NULL)),
 UNIQUE("submissionDefId","requestId")
);
CREATE INDEX IF NOT EXISTS field_data_geo_analyses_pending ON field_data_geo_analyses ("createdAt") WHERE status='pending';
CREATE TABLE IF NOT EXISTS field_data_geo_candidate_reviews (
 id UUID PRIMARY KEY,"analysisId" UUID NOT NULL REFERENCES field_data_geo_analyses(id) ON DELETE CASCADE,
 sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 50),"requestId" UUID NOT NULL,"requestHash" TEXT NOT NULL,
 "candidateId" INTEGER NOT NULL CHECK("candidateId" BETWEEN 1 AND 20),action TEXT NOT NULL CHECK(action IN ('approve','reject','unclear')),
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 10 AND 2000),"actorId" INTEGER REFERENCES actors(id) ON DELETE SET NULL,
 "actorName" TEXT NOT NULL,"reviewedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE("analysisId","requestId"),UNIQUE("analysisId",sequence)
);
CREATE OR REPLACE FUNCTION field_data_guard_geo_analysis() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF NOT EXISTS(SELECT 1 FROM submission_defs WHERE id=OLD."submissionDefId") THEN RETURN OLD; END IF;
 ELSE
  IF NEW."actorId" IS NULL AND NOT EXISTS(SELECT 1 FROM actors WHERE id=OLD."actorId") AND to_jsonb(NEW)-'actorId'=to_jsonb(OLD)-'actorId' THEN RETURN NEW; END IF;
  IF OLD.status='pending' AND NEW.status IN ('complete','failed') AND
   to_jsonb(NEW)-ARRAY['status','result','failure','completedAt']=to_jsonb(OLD)-ARRAY['status','result','failure','completedAt'] THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'Geospatial analysis snapshots are immutable' USING ERRCODE='23514';
END $$;
DROP TRIGGER IF EXISTS field_data_geo_analysis_guard ON field_data_geo_analyses;
CREATE TRIGGER field_data_geo_analysis_guard BEFORE UPDATE OR DELETE ON field_data_geo_analyses FOR EACH ROW EXECUTE FUNCTION field_data_guard_geo_analysis();
CREATE OR REPLACE FUNCTION field_data_guard_geo_candidate_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF NOT EXISTS(SELECT 1 FROM field_data_geo_analyses WHERE id=OLD."analysisId") THEN RETURN OLD; END IF;
 ELSE
  IF NEW."actorId" IS NULL AND NOT EXISTS(SELECT 1 FROM actors WHERE id=OLD."actorId") AND to_jsonb(NEW)-'actorId'=to_jsonb(OLD)-'actorId' THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'Geospatial candidate reviews are append-only' USING ERRCODE='23514';
END $$;
DROP TRIGGER IF EXISTS field_data_geo_candidate_review_guard ON field_data_geo_candidate_reviews;
CREATE TRIGGER field_data_geo_candidate_review_guard BEFORE UPDATE OR DELETE ON field_data_geo_candidate_reviews FOR EACH ROW EXECUTE FUNCTION field_data_guard_geo_candidate_review();`);
const down = async db => db.raw(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM field_data_geo_analyses) THEN
 DROP TABLE field_data_geo_candidate_reviews;DROP TABLE field_data_geo_analyses;
 DROP FUNCTION field_data_guard_geo_candidate_review();DROP FUNCTION field_data_guard_geo_analysis(); END IF; END $$`);
module.exports = { up, down };
