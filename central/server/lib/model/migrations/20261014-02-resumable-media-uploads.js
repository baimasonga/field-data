// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const up = async db => db.raw(`
CREATE TABLE IF NOT EXISTS field_data_media_uploads (
 id UUID PRIMARY KEY, "actorId" INTEGER NOT NULL REFERENCES actors(id) ON DELETE CASCADE, "projectId" INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 "submissionDefId" INTEGER NOT NULL REFERENCES submission_defs(id) ON DELETE CASCADE, manifest JSONB NOT NULL,
 "offset" INTEGER NOT NULL DEFAULT 0 CHECK ("offset" >= 0), status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed')),
 "blobId" INTEGER REFERENCES blobs(id) ON DELETE SET NULL, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 "expiresAt" TIMESTAMPTZ NOT NULL DEFAULT (clock_timestamp() + interval '24 hours')
);
CREATE INDEX IF NOT EXISTS field_data_media_upload_actor ON field_data_media_uploads ("actorId", "expiresAt");
CREATE INDEX IF NOT EXISTS field_data_media_upload_expiry ON field_data_media_uploads ("expiresAt");
CREATE TABLE IF NOT EXISTS field_data_media_upload_chunks (
 "uploadId" UUID NOT NULL REFERENCES field_data_media_uploads(id) ON DELETE CASCADE,
 "offset" INTEGER NOT NULL CHECK ("offset" >= 0), hash TEXT NOT NULL, bytes BYTEA NOT NULL CHECK (octet_length(bytes) BETWEEN 1 AND 262144),
 PRIMARY KEY ("uploadId", "offset")
);`);
const down = async db => db.raw(`DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM field_data_media_uploads) THEN
  DROP TABLE field_data_media_upload_chunks;
  DROP TABLE field_data_media_uploads;
 END IF;
END $$`);
module.exports = { up, down };
