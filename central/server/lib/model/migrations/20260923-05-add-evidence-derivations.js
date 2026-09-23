// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

const up = async (db) => db.raw(`CREATE TABLE field_data_evidence_derivations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "evidenceId" UUID NOT NULL REFERENCES field_data_evidence_records(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  algorithm TEXT NOT NULL,
  "algorithmVersion" TEXT NOT NULL,
  "outputJson" JSONB NOT NULL,
  "contentHash" TEXT GENERATED ALWAYS AS
    ('sha256:' || encode(sha256(convert_to("outputJson"::text, 'UTF8')), 'hex')) STORED,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE ("evidenceId", kind, algorithm, "algorithmVersion")
);
CREATE INDEX field_data_evidence_derivations_evidence
  ON field_data_evidence_derivations ("evidenceId", "createdAt", id);
CREATE TRIGGER field_data_evidence_derivation_immutable
  BEFORE UPDATE ON field_data_evidence_derivations
  FOR EACH ROW EXECUTE FUNCTION field_data_reject_evidence_update()`);

const down = async (db) => db.raw('DROP TABLE IF EXISTS field_data_evidence_derivations');

module.exports = { up, down };
