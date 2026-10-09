// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const up = async (db) => {
  await db.raw(`CREATE TABLE IF NOT EXISTS field_data_backcheck_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "backcheckId" UUID NOT NULL REFERENCES field_data_backchecks(id),
    revision INTEGER NOT NULL CHECK (revision > 0),
    "requestId" UUID NOT NULL,
    "requestHash" TEXT NOT NULL,
    "actorId" INTEGER NOT NULL REFERENCES actors(id),
    "originalSubmissionDefId" INTEGER NOT NULL REFERENCES submission_defs(id),
    "backcheckSubmissionDefId" INTEGER NOT NULL REFERENCES submission_defs(id),
    "originalHash" TEXT NOT NULL,
    "backcheckHash" TEXT NOT NULL,
    note TEXT NOT NULL CHECK (char_length(note) BETWEEN 1 AND 2000),
    pairs JSONB NOT NULL CHECK (jsonb_typeof(pairs) = 'array' AND jsonb_array_length(pairs) <= 100),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE ("backcheckId", revision),
    UNIQUE ("backcheckId", "requestId")
  )`);
};
// Mapping evidence and audit history survive application rollback/reapply.
const down = async (db) => {
  // Removing an empty table permits older migrations to roll back as well.
  await db.raw(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM field_data_backcheck_mappings) THEN
      DROP TABLE field_data_backcheck_mappings;
    END IF;
  END $$`);
};
module.exports = { up, down };
