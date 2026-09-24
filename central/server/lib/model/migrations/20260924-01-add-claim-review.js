// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

// P0.5 stores a mutable case projection and an immutable decision history.
// Historical core submission review states are intentionally not backfilled as decisions.
const up = async (db) => {
  await db.raw(`CREATE TABLE field_data_review_cases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "claimVersionId" UUID NOT NULL REFERENCES field_data_claim_versions(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'open'
      CHECK (status IN ('open', 'in-review', 'resolved', 'superseded')),
    priority TEXT NOT NULL DEFAULT 'normal'
      CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    "reasonCodes" JSONB NOT NULL DEFAULT '[]'::jsonb
      CHECK (jsonb_typeof("reasonCodes") = 'array'
        AND jsonb_array_length("reasonCodes") <= 20),
    "assignedTo" INTEGER REFERENCES actors(id) ON DELETE SET NULL,
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
    "openedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    "resolvedAt" TIMESTAMPTZ,
    "supersededByCaseId" UUID REFERENCES field_data_review_cases(id)
      ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
    "policyVersion" TEXT NOT NULL DEFAULT 'p0.5' CHECK ("policyVersion" = 'p0.5'),
    UNIQUE (id, "claimVersionId"),
    CHECK ((status = 'resolved') = ("resolvedAt" IS NOT NULL))
  );
  CREATE UNIQUE INDEX field_data_review_cases_active_claim_version
    ON field_data_review_cases ("claimVersionId")
    WHERE status IN ('open', 'in-review', 'resolved');
  CREATE INDEX field_data_review_cases_queue
    ON field_data_review_cases (status, priority, "openedAt", id);

  CREATE TABLE field_data_review_decisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "caseId" UUID NOT NULL,
    "claimVersionId" UUID NOT NULL,
    "previousDecisionId" UUID,
    sequence INTEGER NOT NULL CHECK (sequence > 0),
    outcome TEXT NOT NULL CHECK (outcome IN (
      'accepted', 'needs-evidence', 'returned-for-correction', 'rejected')),
    override BOOLEAN NOT NULL DEFAULT false,
    "reasonCode" TEXT NOT NULL CHECK (length("reasonCode") BETWEEN 1 AND 100),
    note TEXT CHECK (note IS NULL OR length(note) <= 4000),
    "evidenceSnapshot" JSONB NOT NULL CHECK (jsonb_typeof("evidenceSnapshot") = 'array'
      AND jsonb_array_length("evidenceSnapshot") <= 100),
    "evidenceSnapshotHash" TEXT NOT NULL
      CHECK ("evidenceSnapshotHash" ~ '^sha256:[0-9a-f]{64}$'),
    "integritySnapshot" JSONB NOT NULL CHECK (jsonb_typeof("integritySnapshot") = 'array'
      AND jsonb_array_length("integritySnapshot") <= 100),
    "reviewerId" INTEGER REFERENCES actors(id) ON DELETE SET NULL,
    "policyVersion" TEXT NOT NULL DEFAULT 'p0.5' CHECK ("policyVersion" = 'p0.5'),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT field_data_review_decisions_case_version_fk
      FOREIGN KEY ("caseId", "claimVersionId")
      REFERENCES field_data_review_cases(id, "claimVersionId") ON DELETE RESTRICT,
    CONSTRAINT field_data_review_decisions_previous_fk
      FOREIGN KEY ("previousDecisionId") REFERENCES field_data_review_decisions(id)
      ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
    UNIQUE ("caseId", sequence),
    UNIQUE ("previousDecisionId"),
    CHECK (override = false OR (note IS NOT NULL AND length(btrim(note)) > 0))
  );
  CREATE INDEX field_data_review_decisions_case
    ON field_data_review_decisions ("caseId", sequence);

  CREATE FUNCTION field_data_validate_review_decision()
    RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE previous_record field_data_review_decisions%ROWTYPE;
    BEGIN
      IF NEW.sequence = 1 THEN
        IF NEW."previousDecisionId" IS NOT NULL THEN
          RAISE EXCEPTION 'REVIEW_LINEAGE_INVALID: first decision has predecessor'
            USING ERRCODE = '23514';
        END IF;
      ELSE
        SELECT * INTO previous_record FROM field_data_review_decisions
          WHERE id = NEW."previousDecisionId";
        IF NOT FOUND OR previous_record."caseId" <> NEW."caseId"
          OR previous_record.sequence <> NEW.sequence - 1 THEN
          RAISE EXCEPTION 'REVIEW_LINEAGE_INVALID: wrong predecessor'
            USING ERRCODE = '23514';
        END IF;
      END IF;
      RETURN NEW;
    END;
    $$;
  CREATE CONSTRAINT TRIGGER field_data_review_decision_lineage
    AFTER INSERT ON field_data_review_decisions
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION field_data_validate_review_decision();
  CREATE TRIGGER field_data_review_decision_immutable
    BEFORE UPDATE OR DELETE ON field_data_review_decisions
    FOR EACH ROW EXECUTE FUNCTION field_data_reject_evidence_update()`);
};

const down = async (db) => {
  await db.raw('DROP TABLE IF EXISTS field_data_review_decisions');
  await db.raw('DROP TABLE IF EXISTS field_data_review_cases');
  await db.raw('DROP FUNCTION IF EXISTS field_data_validate_review_decision()');
};

module.exports = { up, down };
