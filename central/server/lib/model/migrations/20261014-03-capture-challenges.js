// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const up = async db => db.raw(`
CREATE TABLE IF NOT EXISTS field_data_capture_challenges (
 id UUID PRIMARY KEY, "actorId" INTEGER NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
 "projectId" INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 "submissionDefId" INTEGER NOT NULL REFERENCES submission_defs(id) ON DELETE CASCADE,
 "xmlFormId" TEXT NOT NULL, "instanceId" TEXT NOT NULL, name TEXT NOT NULL,
 nonce TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','bound','cancelled')),
 "issuedAt" TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
 "expiresAt" TIMESTAMPTZ NOT NULL DEFAULT (statement_timestamp() + interval '20 minutes'),
 "boundAt" TIMESTAMPTZ, "contentHash" TEXT, "blobId" INTEGER REFERENCES blobs(id) ON DELETE SET NULL,
 "uploadId" UUID, CHECK ((status = 'bound') = ("boundAt" IS NOT NULL AND "contentHash" IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS field_data_capture_owner ON field_data_capture_challenges ("actorId", "issuedAt");
CREATE INDEX IF NOT EXISTS field_data_capture_time ON field_data_capture_challenges ("issuedAt");
CREATE INDEX IF NOT EXISTS field_data_capture_expiry ON field_data_capture_challenges ("expiresAt") WHERE status = 'issued';
CREATE UNIQUE INDEX IF NOT EXISTS field_data_capture_target ON field_data_capture_challenges ("submissionDefId", name) WHERE status = 'issued';
CREATE UNIQUE INDEX IF NOT EXISTS field_data_capture_fingerprint ON field_data_capture_challenges ("projectId", "contentHash") WHERE status = 'bound';
`);
const down = async db => db.raw(`DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM field_data_capture_challenges) THEN DROP TABLE field_data_capture_challenges; END IF;
END $$`);
module.exports = { up, down };
