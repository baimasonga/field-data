// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const up = async db => db.raw(`CREATE TABLE IF NOT EXISTS field_data_media_couriers (
 id UUID PRIMARY KEY, "uploadId" UUID UNIQUE NOT NULL, "projectId" INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 "submissionDefId" INTEGER NOT NULL REFERENCES submission_defs(id) ON DELETE CASCADE,
 "ownerId" INTEGER NOT NULL, "courierId" INTEGER NOT NULL, "requestId" UUID NOT NULL,
 "requestHash" TEXT NOT NULL, "expiresAt" TIMESTAMPTZ NOT NULL, manifest JSONB NOT NULL, attestation JSONB NOT NULL,
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), UNIQUE("ownerId","requestId")
);
CREATE INDEX IF NOT EXISTS field_data_media_courier_project ON field_data_media_couriers("projectId");
CREATE TABLE IF NOT EXISTS field_data_media_courier_events (
 id UUID PRIMARY KEY, "grantId" UUID NOT NULL REFERENCES field_data_media_couriers(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('revoke','delivery')), "requestId" UUID NOT NULL, "requestHash" TEXT NOT NULL,
 details JSONB NOT NULL, attestation JSONB, UNIQUE("grantId",kind), UNIQUE("grantId","requestId")
);
CREATE OR REPLACE FUNCTION field_data_guard_media_couriers() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN
  IF TG_TABLE_NAME='field_data_media_couriers' THEN
   IF NOT EXISTS(SELECT 1 FROM projects WHERE id=OLD."projectId") OR NOT EXISTS(SELECT 1 FROM submission_defs WHERE id=OLD."submissionDefId") THEN RETURN OLD; END IF;
  ELSE
   IF NOT EXISTS(SELECT 1 FROM field_data_media_couriers WHERE id=OLD."grantId") THEN RETURN OLD; END IF;
  END IF;
 END IF;
 RAISE EXCEPTION 'Courier custody records are append-only' USING ERRCODE='23514'; END $$;
DROP TRIGGER IF EXISTS field_data_media_courier_guard ON field_data_media_couriers;
CREATE TRIGGER field_data_media_courier_guard BEFORE UPDATE OR DELETE ON field_data_media_couriers FOR EACH ROW EXECUTE FUNCTION field_data_guard_media_couriers();
DROP TRIGGER IF EXISTS field_data_media_courier_event_guard ON field_data_media_courier_events;
CREATE TRIGGER field_data_media_courier_event_guard BEFORE UPDATE OR DELETE ON field_data_media_courier_events FOR EACH ROW EXECUTE FUNCTION field_data_guard_media_couriers();`);
const down = async db => db.raw(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM field_data_media_couriers) THEN
 DROP TABLE field_data_media_courier_events; DROP TABLE field_data_media_couriers; DROP FUNCTION field_data_guard_media_couriers(); END IF; END $$`);
module.exports = { up, down };
