// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const up = async db => db.raw(`CREATE TABLE IF NOT EXISTS field_data_xml_background (
 id UUID PRIMARY KEY, "targetId" UUID NOT NULL REFERENCES field_data_xml_courier_targets(id) ON DELETE CASCADE,
 "ownerId" INTEGER NOT NULL, "tokenHash" TEXT NOT NULL, "requestHash" TEXT NOT NULL,
 "expiresAt" TIMESTAMPTZ NOT NULL, attestation JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS field_data_xml_background_target ON field_data_xml_background("targetId");
CREATE TABLE IF NOT EXISTS field_data_xml_background_events (
 id UUID PRIMARY KEY, "targetId" UUID NOT NULL REFERENCES field_data_xml_courier_targets(id) ON DELETE CASCADE,
 "authorizationId" UUID NOT NULL REFERENCES field_data_xml_background(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('revoke','delivery')), "requestId" UUID NOT NULL, "requestHash" TEXT NOT NULL,
 details JSONB NOT NULL, attestation JSONB, UNIQUE("authorizationId",kind), UNIQUE("authorizationId","requestId")
);
CREATE UNIQUE INDEX IF NOT EXISTS field_data_xml_background_once ON field_data_xml_background_events("targetId") WHERE kind='delivery';
DROP TRIGGER IF EXISTS field_data_xml_background_guard ON field_data_xml_background;
CREATE TRIGGER field_data_xml_background_guard BEFORE UPDATE OR DELETE ON field_data_xml_background FOR EACH ROW EXECUTE FUNCTION field_data_guard_xml_couriers();
DROP TRIGGER IF EXISTS field_data_xml_background_event_guard ON field_data_xml_background_events;
CREATE TRIGGER field_data_xml_background_event_guard BEFORE UPDATE OR DELETE ON field_data_xml_background_events FOR EACH ROW EXECUTE FUNCTION field_data_guard_xml_couriers();`);
const down = async db => db.raw(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM field_data_xml_background) THEN DROP TABLE field_data_xml_background_events; DROP TABLE field_data_xml_background; END IF; END $$`);
module.exports = { up, down };
