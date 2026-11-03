// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const up = async db => db.raw(`CREATE TABLE IF NOT EXISTS field_data_media_background (
 id UUID PRIMARY KEY, "uploadId" UUID NOT NULL, "ownerId" INTEGER NOT NULL, "senderId" INTEGER NOT NULL,
 "projectId" INTEGER NOT NULL, "submissionDefId" INTEGER NOT NULL, manifest JSONB NOT NULL,
 "courierGrantId" UUID, "tokenHash" TEXT NOT NULL, "requestHash" TEXT NOT NULL, "expiresAt" TIMESTAMPTZ NOT NULL, attestation JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS field_data_media_background_upload ON field_data_media_background("uploadId");
CREATE INDEX IF NOT EXISTS field_data_media_background_sender ON field_data_media_background("senderId");
CREATE TABLE IF NOT EXISTS field_data_media_background_events (
 id UUID PRIMARY KEY, "authorizationId" UUID NOT NULL REFERENCES field_data_media_background(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('revoke','delivery')), "requestId" UUID NOT NULL, "requestHash" TEXT NOT NULL,
 details JSONB NOT NULL, attestation JSONB, UNIQUE("authorizationId",kind), UNIQUE("authorizationId","requestId")
);
DROP TRIGGER IF EXISTS field_data_media_background_guard ON field_data_media_background;
CREATE TRIGGER field_data_media_background_guard BEFORE UPDATE OR DELETE ON field_data_media_background FOR EACH ROW EXECUTE FUNCTION field_data_guard_xml_couriers();
DROP TRIGGER IF EXISTS field_data_media_background_event_guard ON field_data_media_background_events;
CREATE TRIGGER field_data_media_background_event_guard BEFORE UPDATE OR DELETE ON field_data_media_background_events FOR EACH ROW EXECUTE FUNCTION field_data_guard_xml_couriers();`);
const down = async db => db.raw(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM field_data_media_background) THEN DROP TABLE field_data_media_background_events; DROP TABLE field_data_media_background; END IF; END $$`);
module.exports = { up, down };
