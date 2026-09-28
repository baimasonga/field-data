// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

const up = async (db) => {
  await db.raw(`CREATE TABLE IF NOT EXISTS field_data_backchecks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "caseId" UUID NOT NULL REFERENCES field_data_review_cases(id) ON DELETE CASCADE,
    "claimVersionId" UUID NOT NULL REFERENCES field_data_claim_versions(id) ON DELETE CASCADE,
    "requestId" UUID NOT NULL,
    "requestHash" TEXT NOT NULL,
    "requestedBy" INTEGER REFERENCES actors(id) ON DELETE SET NULL,
    "assignedTo" INTEGER REFERENCES actors(id) ON DELETE SET NULL,
    question TEXT NOT NULL CHECK (length(btrim(question)) BETWEEN 1 AND 2000),
    "dueAt" TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'requested'
      CHECK (status IN ('requested', 'linked', 'cancelled')),
    "responseSubmissionDefId" INTEGER UNIQUE REFERENCES submission_defs(id) ON DELETE RESTRICT,
    "responseInstanceId" TEXT,
    "linkedBy" INTEGER REFERENCES actors(id) ON DELETE SET NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    "linkedAt" TIMESTAMPTZ,
    "policyVersion" TEXT NOT NULL DEFAULT 'p0.6' CHECK ("policyVersion" = 'p0.6'),
    UNIQUE ("caseId", "requestId"),
    CHECK ((status = 'linked') = ("responseSubmissionDefId" IS NOT NULL)),
    CHECK ((status = 'linked') = ("linkedAt" IS NOT NULL))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS field_data_backchecks_pending_case
    ON field_data_backchecks ("caseId") WHERE status = 'requested';
  CREATE INDEX IF NOT EXISTS field_data_backchecks_assignee
    ON field_data_backchecks ("assignedTo", status, "createdAt")`);
};

const down = async (db) => {
  // Keep recorded field visits and audit links on a rollback.
  await db.raw(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM field_data_backchecks) THEN
      DROP TABLE field_data_backchecks;
    END IF;
  END $$`);
};

module.exports = { up, down };
