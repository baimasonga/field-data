// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const up = async db => db.raw(`CREATE TABLE IF NOT EXISTS field_data_witness_key_certificates (
 id UUID PRIMARY KEY, "projectId" INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 "keyHash" TEXT NOT NULL CHECK("keyHash" ~ '^[0-9a-f]{64}$'), "subjectAccountId" INTEGER NOT NULL,
 "requestId" UUID NOT NULL, "requestHash" TEXT NOT NULL, attestation JSONB NOT NULL,
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), UNIQUE("projectId","keyHash"), UNIQUE("projectId","requestId")
);
CREATE OR REPLACE FUNCTION field_data_guard_witness_certificate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM projects WHERE id=OLD."projectId") THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Witness key certificates are append-only' USING ERRCODE='23514'; END $$;
DROP TRIGGER IF EXISTS field_data_witness_certificate_guard ON field_data_witness_key_certificates;
CREATE TRIGGER field_data_witness_certificate_guard BEFORE UPDATE OR DELETE ON field_data_witness_key_certificates FOR EACH ROW EXECUTE FUNCTION field_data_guard_witness_certificate();`);
const down = async db => db.raw(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM field_data_witness_key_certificates) THEN
 DROP TABLE field_data_witness_key_certificates; DROP FUNCTION field_data_guard_witness_certificate(); END IF; END $$`);
module.exports = { up, down };
