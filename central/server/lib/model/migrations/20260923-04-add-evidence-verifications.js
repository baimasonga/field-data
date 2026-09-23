// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

// A later observation never changes the immutable capture-time evidence row.
const up = async (db) => db.raw(`CREATE TABLE field_data_evidence_verifications (
  "evidenceId" UUID PRIMARY KEY REFERENCES field_data_evidence_records(id) ON DELETE CASCADE,
  "contentHash" TEXT NOT NULL CHECK ("contentHash" ~ '^sha256:[0-9a-f]{64}$'),
  "byteSize" BIGINT NOT NULL CHECK ("byteSize" >= 0),
  "legacySha1Matched" BOOLEAN NOT NULL,
  "verifiedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  "basis" TEXT NOT NULL DEFAULT 'object-store-vs-upload-sha1'
    CHECK ("basis" = 'object-store-vs-upload-sha1')
);
CREATE TRIGGER field_data_evidence_verification_immutable
  BEFORE UPDATE ON field_data_evidence_verifications
  FOR EACH ROW EXECUTE FUNCTION field_data_reject_evidence_update()`);

const down = async (db) => db.raw('DROP TABLE IF EXISTS field_data_evidence_verifications');

module.exports = { up, down };
