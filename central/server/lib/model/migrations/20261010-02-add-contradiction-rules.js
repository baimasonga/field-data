// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

// F1 answer contradictions (docs/field-intelligence/F1-answer-contradictions.md).
// Rules a project manager writes per form; findings go to the existing
// field_data_integrity_flags table as rule 'contradiction:<id>'. An open
// contradiction adds 'answer-contradiction' to the claim version's review case,
// as the other checks do. Changing a rule's conditions raises its version, so
// findings keep the version they were found under; each finding's evidence also
// carries the conditions as they were, so no history table is needed.
const up = async (db) => {
  await db.raw(`CREATE TABLE field_data_contradiction_rules (
    id UUID PRIMARY KEY,
    "formId" INTEGER NOT NULL REFERENCES forms(id),
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
    explanation TEXT NOT NULL,
    "benignExplanations" JSONB NOT NULL CHECK (jsonb_typeof("benignExplanations") = 'array'
      AND jsonb_array_length("benignExplanations") >= 1),
    "nextStep" TEXT NOT NULL,
    conditions JSONB NOT NULL CHECK (jsonb_typeof(conditions) = 'array'),
    "conditionsHash" TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
    "createdBy" INTEGER REFERENCES actors(id),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    "updatedAt" TIMESTAMPTZ
  );
  CREATE INDEX field_data_contradiction_rules_form ON field_data_contradiction_rules ("formId", active);

  CREATE FUNCTION field_data_route_contradiction_finding()
    RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE version_id UUID;
    BEGIN
      IF NEW.rule NOT LIKE 'contradiction:%' OR NEW.outcome <> 'concern'
        OR NEW.status NOT IN ('open', 'investigating') THEN
        RETURN NEW;
      END IF;

      SELECT v.id INTO version_id
      FROM submissions s
      JOIN submission_defs sd ON sd."submissionId" = s.id AND sd.current IS TRUE
      JOIN field_data_claim_versions v ON v."submissionDefId" = sd.id
      WHERE s."formId" = NEW."formId" AND s."instanceId" = NEW."instanceId"
        AND s."deletedAt" IS NULL AND s.draft IS FALSE;

      IF version_id IS NOT NULL THEN
        INSERT INTO field_data_review_cases ("claimVersionId", "reasonCodes")
          VALUES (version_id, '["answer-contradiction"]'::jsonb)
          ON CONFLICT DO NOTHING;
        UPDATE field_data_review_cases
          SET "reasonCodes" = "reasonCodes" || '["answer-contradiction"]'::jsonb,
              revision = revision + 1, "updatedAt" = clock_timestamp()
          WHERE "claimVersionId" = version_id AND status IN ('open', 'in-review')
            AND NOT "reasonCodes" @> '["answer-contradiction"]'::jsonb;
      END IF;
      RETURN NEW;
    END;
    $$;
  CREATE TRIGGER field_data_contradiction_finding
    AFTER INSERT OR UPDATE OF outcome, evidence, status ON field_data_integrity_flags
    FOR EACH ROW EXECUTE FUNCTION field_data_route_contradiction_finding()`);
};

// Rules are configuration, not evidence: findings they produced stay in
// field_data_integrity_flags, with their conditions in the evidence.
const down = async (db) => {
  await db.raw(`DROP TRIGGER IF EXISTS field_data_contradiction_finding ON field_data_integrity_flags;
    DROP FUNCTION IF EXISTS field_data_route_contradiction_finding();
    DROP TABLE IF EXISTS field_data_contradiction_rules`);
};

module.exports = { up, down };
