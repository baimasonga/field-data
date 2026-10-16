// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const up = async db => db.raw(`CREATE TABLE IF NOT EXISTS field_data_media_extractions (
 id UUID PRIMARY KEY, "submissionDefId" INTEGER NOT NULL REFERENCES submission_defs(id) ON DELETE CASCADE,
 name TEXT NOT NULL, "blobId" INTEGER REFERENCES blobs(id) ON DELETE SET NULL,
 "contentHash" TEXT NOT NULL, "contentType" TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('photo', 'audio')),
 model TEXT NOT NULL, "requestId" UUID NOT NULL, "requestHash" TEXT NOT NULL,
 "actorId" INTEGER REFERENCES actors(id) ON DELETE SET NULL, "actorName" TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'ready', 'failed')),
 proposal TEXT CHECK (length(proposal) BETWEEN 1 AND 12000), failure TEXT,
 "requestedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), "finishedAt" TIMESTAMPTZ,
 UNIQUE ("submissionDefId", "requestId"),
 CHECK ((status = 'ready' AND proposal IS NOT NULL AND failure IS NULL AND "finishedAt" IS NOT NULL)
     OR (status = 'failed' AND proposal IS NULL AND failure IS NOT NULL AND "finishedAt" IS NOT NULL)
     OR (status = 'processing' AND proposal IS NULL AND failure IS NULL AND "finishedAt" IS NULL))
);
CREATE INDEX IF NOT EXISTS field_data_extraction_blob ON field_data_media_extractions ("blobId") WHERE "blobId" IS NOT NULL;
CREATE TABLE IF NOT EXISTS field_data_media_extraction_reviews (
 id UUID PRIMARY KEY, "extractionId" UUID NOT NULL REFERENCES field_data_media_extractions(id) ON DELETE CASCADE,
 sequence INTEGER NOT NULL CHECK (sequence BETWEEN 1 AND 20), action TEXT NOT NULL CHECK (action IN ('approve', 'reject')),
 text TEXT, reason TEXT NOT NULL CHECK (length(reason) BETWEEN 10 AND 2000),
 "actorId" INTEGER REFERENCES actors(id) ON DELETE SET NULL, "actorName" TEXT NOT NULL,
 "requestId" UUID NOT NULL, "requestHash" TEXT NOT NULL, "reviewedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE ("extractionId", sequence), UNIQUE ("extractionId", "requestId"),
 CHECK ((action = 'approve' AND text IS NOT NULL AND length(text) BETWEEN 1 AND 12000) OR (action = 'reject' AND text IS NULL))
);
CREATE OR REPLACE FUNCTION field_data_guard_media_extraction() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
   IF NOT EXISTS (SELECT 1 FROM submission_defs WHERE id = OLD."submissionDefId") THEN RETURN OLD; END IF;
 ELSE
   IF NEW."actorId" IS NULL AND NOT EXISTS (SELECT 1 FROM actors WHERE id = OLD."actorId")
      AND to_jsonb(NEW) - 'actorId' = to_jsonb(OLD) - 'actorId' THEN RETURN NEW; END IF;
   IF NEW."blobId" IS NULL AND NOT EXISTS (SELECT 1 FROM blobs WHERE id = OLD."blobId")
      AND to_jsonb(NEW) - 'blobId' = to_jsonb(OLD) - 'blobId' THEN RETURN NEW; END IF;
   IF OLD.status = 'processing' AND NEW.status IN ('ready', 'failed')
      AND to_jsonb(NEW) - ARRAY['status','proposal','failure','finishedAt'] = to_jsonb(OLD) - ARRAY['status','proposal','failure','finishedAt']
      THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'Media extraction provenance is immutable' USING ERRCODE = '23514';
END $$;
DROP TRIGGER IF EXISTS field_data_media_extraction_guard ON field_data_media_extractions;
CREATE TRIGGER field_data_media_extraction_guard BEFORE UPDATE OR DELETE ON field_data_media_extractions
 FOR EACH ROW EXECUTE FUNCTION field_data_guard_media_extraction();
CREATE OR REPLACE FUNCTION field_data_guard_media_extraction_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
   IF NOT EXISTS (SELECT 1 FROM field_data_media_extractions WHERE id = OLD."extractionId") THEN RETURN OLD; END IF;
 ELSE
   IF NEW."actorId" IS NULL AND NOT EXISTS (SELECT 1 FROM actors WHERE id = OLD."actorId")
      AND to_jsonb(NEW) - 'actorId' = to_jsonb(OLD) - 'actorId' THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'Media extraction reviews are append-only' USING ERRCODE = '23514';
END $$;
DROP TRIGGER IF EXISTS field_data_media_extraction_review_guard ON field_data_media_extraction_reviews;
CREATE TRIGGER field_data_media_extraction_review_guard BEFORE UPDATE OR DELETE ON field_data_media_extraction_reviews
 FOR EACH ROW EXECUTE FUNCTION field_data_guard_media_extraction_review();`);
const down = async db => db.raw(`DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM field_data_media_extractions) THEN
   DROP TABLE field_data_media_extraction_reviews;
   DROP TABLE field_data_media_extractions;
   DROP FUNCTION field_data_guard_media_extraction_review();
   DROP FUNCTION field_data_guard_media_extraction();
 END IF;
END $$`);
module.exports = { up, down };
