// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const up = async db => db.raw(`CREATE TABLE IF NOT EXISTS field_data_witness_key_revocations (
 "projectId" INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 "keyHash" TEXT NOT NULL CHECK ("keyHash" ~ '^[0-9a-f]{64}$'),
 "requestId" UUID NOT NULL, "requestHash" TEXT NOT NULL, attestation JSONB NOT NULL,
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY ("projectId", "keyHash"), UNIQUE ("projectId", "requestId")
);
CREATE OR REPLACE FUNCTION field_data_guard_witness_key_revocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM projects WHERE id = OLD."projectId") THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Witness key revocations are append-only' USING ERRCODE = '23514';
END $$;
DROP TRIGGER IF EXISTS field_data_witness_key_revocation_guard ON field_data_witness_key_revocations;
CREATE TRIGGER field_data_witness_key_revocation_guard BEFORE UPDATE OR DELETE ON field_data_witness_key_revocations
 FOR EACH ROW EXECUTE FUNCTION field_data_guard_witness_key_revocation();`);
const down = async db => db.raw(`DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM field_data_witness_key_revocations) THEN
   DROP TABLE field_data_witness_key_revocations;
   DROP FUNCTION field_data_guard_witness_key_revocation();
 END IF;
END $$`);
module.exports = { up, down };
