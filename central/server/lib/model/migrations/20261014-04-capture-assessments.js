// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const up = async db => db.raw(`
ALTER TABLE field_data_capture_challenges ADD COLUMN IF NOT EXISTS "assessmentRevision" INTEGER NOT NULL DEFAULT 0 CHECK ("assessmentRevision" >= 0);
CREATE TABLE IF NOT EXISTS field_data_capture_assessments (
 id UUID PRIMARY KEY, "challengeId" UUID NOT NULL REFERENCES field_data_capture_challenges(id) ON DELETE CASCADE,
 sequence INTEGER NOT NULL CHECK (sequence > 0), "requestId" UUID NOT NULL, "requestHash" TEXT NOT NULL,
 "reviewerId" INTEGER REFERENCES actors(id) ON DELETE SET NULL, "reviewerName" TEXT NOT NULL,
 "codeAssessment" TEXT NOT NULL CHECK ("codeAssessment" IN ('visible','not-visible','unclear')),
 "sceneAssessment" TEXT NOT NULL CHECK ("sceneAssessment" IN ('supports','does-not-support','unclear')),
 "reviewedOriginal" BOOLEAN NOT NULL CHECK ("reviewedOriginal"), note TEXT NOT NULL CHECK (char_length(note) <= 2000), "contentHash" TEXT NOT NULL,
 "blobId" INTEGER REFERENCES blobs(id) ON DELETE SET NULL, "reviewedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE ("challengeId", sequence), UNIQUE ("challengeId", "requestId")
);
CREATE INDEX IF NOT EXISTS field_data_capture_blob ON field_data_capture_challenges ("blobId") WHERE "blobId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS field_data_capture_assessment_blob ON field_data_capture_assessments ("blobId") WHERE "blobId" IS NOT NULL;
`);
const down = async db => db.raw(`DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM field_data_capture_assessments) THEN
  DROP TABLE field_data_capture_assessments;
  DROP INDEX IF EXISTS field_data_capture_blob;
  ALTER TABLE field_data_capture_challenges DROP COLUMN "assessmentRevision";
 END IF;
END $$`);
module.exports = { up, down };
