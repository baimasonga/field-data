// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const up = async db => db.raw(`CREATE TABLE IF NOT EXISTS field_data_witness_delegations (
 id UUID PRIMARY KEY, sequence SERIAL UNIQUE, "projectId" INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 "formId" INTEGER NOT NULL, "delegateId" INTEGER NOT NULL, "delegationId" UUID NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('grant','revoke')),
 "requestId" UUID NOT NULL, "requestHash" TEXT NOT NULL, details JSONB NOT NULL, attestation JSONB NOT NULL,
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), UNIQUE("projectId","requestId"), UNIQUE("delegationId",kind)
);
CREATE INDEX IF NOT EXISTS field_data_witness_delegations_scope ON field_data_witness_delegations("projectId","formId","delegateId");
CREATE OR REPLACE FUNCTION field_data_guard_witness_delegation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM projects WHERE id=OLD."projectId") THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Witness delegations are append-only' USING ERRCODE='23514'; END $$;
DROP TRIGGER IF EXISTS field_data_witness_delegation_guard ON field_data_witness_delegations;
CREATE TRIGGER field_data_witness_delegation_guard BEFORE UPDATE OR DELETE ON field_data_witness_delegations FOR EACH ROW EXECUTE FUNCTION field_data_guard_witness_delegation();
ALTER TABLE field_data_capture_witnesses ADD COLUMN IF NOT EXISTS "authorization" JSONB;
ALTER TABLE field_data_capture_witness_events ADD COLUMN IF NOT EXISTS "authorization" JSONB;`);
const down = async db => db.raw(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM field_data_witness_delegations) THEN
 DROP TABLE field_data_witness_delegations; DROP FUNCTION field_data_guard_witness_delegation(); END IF; END $$`);
module.exports = { up, down };
