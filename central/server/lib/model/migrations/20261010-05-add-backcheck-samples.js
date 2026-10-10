// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

// O3 random backcheck sample (docs/field-intelligence/O3-backcheck-sample.md).
// A sample records its seed and eligible list so the draw can be recomputed;
// items link each chosen submission to the review case it was routed to.
// A submission is in at most one sample. A purged form takes its samples
// with it; a purged submission leaves its item, without the link.
const up = async (db) => {
  await db.raw(`CREATE TABLE IF NOT EXISTS field_data_backcheck_samples (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "formId" INTEGER NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
    "requestId" UUID NOT NULL,
    "requestHash" TEXT NOT NULL,
    seed TEXT NOT NULL CHECK (seed ~ '^[0-9a-f]{32}$'),
    settings JSONB NOT NULL CHECK (jsonb_typeof(settings) = 'object'),
    eligible JSONB NOT NULL CHECK (jsonb_typeof(eligible) = 'array'),
    "sampledBefore" INTEGER NOT NULL CHECK ("sampledBefore" >= 0),
    "drawnBy" INTEGER REFERENCES actors(id) ON DELETE SET NULL,
    "drawnAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE ("formId", "requestId")
  );
  CREATE INDEX IF NOT EXISTS field_data_backcheck_samples_form ON field_data_backcheck_samples ("formId", "drawnAt");

  CREATE TABLE IF NOT EXISTS field_data_backcheck_sample_items (
    "sampleId" UUID NOT NULL REFERENCES field_data_backcheck_samples(id) ON DELETE CASCADE,
    -- Null once the submission is purged; the instance ID stays as the record.
    "submissionId" INTEGER UNIQUE REFERENCES submissions(id) ON DELETE SET NULL,
    "instanceId" TEXT NOT NULL,
    "submitterId" INTEGER REFERENCES actors(id) ON DELETE SET NULL,
    rank INTEGER NOT NULL CHECK (rank >= 1),
    "caseId" UUID REFERENCES field_data_review_cases(id) ON DELETE SET NULL,
    routing TEXT NOT NULL CHECK (routing IN ('routed', 'already-decided')),
    PRIMARY KEY ("sampleId", "instanceId")
  )`);
};

// Samples are a record of fieldwork decisions: kept on a rollback when any exist.
const down = async (db) => {
  await db.raw(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM field_data_backcheck_samples) THEN
      DROP TABLE field_data_backcheck_sample_items;
      DROP TABLE field_data_backcheck_samples;
    END IF;
  END $$`);
};

module.exports = { up, down };
