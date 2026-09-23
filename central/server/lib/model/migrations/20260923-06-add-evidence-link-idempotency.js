// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

// No backfill: historical retries cannot be reconstructed reliably.
const up = async (db) => {
  await db.raw(`CREATE TABLE field_data_idempotency_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "projectId" INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    "operationType" TEXT NOT NULL CHECK ("operationType" = 'evidence.link.create'),
    "idempotencyKey" TEXT NOT NULL CHECK (length("idempotencyKey") BETWEEN 1 AND 200),
    "requestHash" TEXT NOT NULL CHECK ("requestHash" ~ '^sha256:[0-9a-f]{64}$'),
    status TEXT NOT NULL CHECK (status IN ('in-progress', 'succeeded')),
    "resourceId" UUID,
    "responseStatus" INTEGER,
    "policyVersion" TEXT NOT NULL DEFAULT 'p0.4',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    "completedAt" TIMESTAMPTZ,
    UNIQUE ("projectId", "operationType", "idempotencyKey"),
    CHECK ((status = 'in-progress' AND "completedAt" IS NULL AND "resourceId" IS NULL)
      OR (status = 'succeeded' AND "completedAt" IS NOT NULL
        AND "resourceId" IS NOT NULL AND "responseStatus" = 201))
  )`);
  await db.raw(`ALTER TABLE field_data_claim_evidence
    DROP CONSTRAINT field_data_claim_evidence_relation_check,
    ADD CONSTRAINT field_data_claim_evidence_relation_check
      CHECK (relation IN ('context', 'supports', 'contradicts')),
    ADD COLUMN "createdBy" INTEGER REFERENCES actors(id) ON DELETE SET NULL,
    ADD COLUMN "supersedesLinkId" UUID REFERENCES field_data_claim_evidence(id)
      ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED`);
};

const down = async (db) => {
  await db.raw(`ALTER TABLE field_data_claim_evidence
    DROP CONSTRAINT field_data_claim_evidence_relation_check,
    DROP COLUMN "supersedesLinkId", DROP COLUMN "createdBy",
    ADD CONSTRAINT field_data_claim_evidence_relation_check CHECK (relation = 'context')`);
  await db.raw('DROP TABLE IF EXISTS field_data_idempotency_records');
};

module.exports = { up, down };
