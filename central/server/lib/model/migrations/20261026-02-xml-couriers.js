// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const up = async db => db.raw(`CREATE TABLE IF NOT EXISTS field_data_xml_courier_targets (
 id UUID PRIMARY KEY, "projectId" INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 "formId" INTEGER NOT NULL REFERENCES forms(id) ON DELETE CASCADE, "formDefId" INTEGER NOT NULL REFERENCES form_defs(id) ON DELETE CASCADE,
 "ownerId" INTEGER NOT NULL, manifest JSONB NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS field_data_xml_courier_instance ON field_data_xml_courier_targets("formId",(manifest->>'instanceId'));
CREATE INDEX IF NOT EXISTS field_data_xml_courier_project ON field_data_xml_courier_targets("projectId");
CREATE TABLE IF NOT EXISTS field_data_xml_couriers (
 id UUID PRIMARY KEY, "targetId" UUID NOT NULL REFERENCES field_data_xml_courier_targets(id) ON DELETE CASCADE,
 "ownerId" INTEGER NOT NULL, "courierId" INTEGER NOT NULL, "requestId" UUID NOT NULL, "requestHash" TEXT NOT NULL,
 "expiresAt" TIMESTAMPTZ NOT NULL, attestation JSONB NOT NULL, UNIQUE("ownerId","requestId")
);
CREATE TABLE IF NOT EXISTS field_data_xml_courier_events (
 id UUID PRIMARY KEY, "targetId" UUID NOT NULL REFERENCES field_data_xml_courier_targets(id) ON DELETE CASCADE,
 "grantId" UUID NOT NULL REFERENCES field_data_xml_couriers(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('revoke','delivery')), "requestId" UUID NOT NULL, "requestHash" TEXT NOT NULL,
 details JSONB NOT NULL, attestation JSONB, UNIQUE("grantId",kind), UNIQUE("grantId","requestId")
);
CREATE UNIQUE INDEX IF NOT EXISTS field_data_xml_courier_once ON field_data_xml_courier_events("targetId") WHERE kind='delivery';
CREATE OR REPLACE FUNCTION field_data_guard_xml_couriers() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN
  IF TG_TABLE_NAME='field_data_xml_courier_targets' THEN
   IF NOT EXISTS(SELECT 1 FROM forms WHERE id=OLD."formId") OR NOT EXISTS(SELECT 1 FROM projects WHERE id=OLD."projectId") OR NOT EXISTS(SELECT 1 FROM form_defs WHERE id=OLD."formDefId") THEN RETURN OLD; END IF;
  ELSE
   IF NOT EXISTS(SELECT 1 FROM field_data_xml_courier_targets WHERE id=OLD."targetId") THEN RETURN OLD; END IF;
  END IF;
 END IF;
 RAISE EXCEPTION 'XML courier custody records are append-only' USING ERRCODE='23514'; END $$;
DROP TRIGGER IF EXISTS field_data_xml_courier_target_guard ON field_data_xml_courier_targets;
CREATE TRIGGER field_data_xml_courier_target_guard BEFORE UPDATE OR DELETE ON field_data_xml_courier_targets FOR EACH ROW EXECUTE FUNCTION field_data_guard_xml_couriers();
DROP TRIGGER IF EXISTS field_data_xml_courier_guard ON field_data_xml_couriers;
CREATE TRIGGER field_data_xml_courier_guard BEFORE UPDATE OR DELETE ON field_data_xml_couriers FOR EACH ROW EXECUTE FUNCTION field_data_guard_xml_couriers();
DROP TRIGGER IF EXISTS field_data_xml_courier_event_guard ON field_data_xml_courier_events;
CREATE TRIGGER field_data_xml_courier_event_guard BEFORE UPDATE OR DELETE ON field_data_xml_courier_events FOR EACH ROW EXECUTE FUNCTION field_data_guard_xml_couriers();`);
const down = async db => db.raw(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM field_data_xml_courier_targets) THEN
 DROP TABLE field_data_xml_courier_events; DROP TABLE field_data_xml_couriers; DROP TABLE field_data_xml_courier_targets; DROP FUNCTION field_data_guard_xml_couriers(); END IF; END $$`);
module.exports = { up, down };
