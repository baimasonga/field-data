// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

// F2 identity reuse (docs/field-intelligence/F2-identity-reuse.md). Keys a
// project manager declares per form; findings go to the existing
// field_data_integrity_flags table as rules 'identity-reused:<id>' and
// 'identity-inconsistent:<id>'. An open finding adds the reason code named by
// the rule's prefix to the claim version's review case, as the other checks
// do. Findings hold submission IDs and field paths, never answers.
const up = async (db) => {
  await db.raw(`CREATE TABLE field_data_identity_keys (
    id UUID PRIMARY KEY,
    "formId" INTEGER NOT NULL REFERENCES forms(id),
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
    explanation TEXT NOT NULL,
    "benignExplanations" JSONB NOT NULL CHECK (jsonb_typeof("benignExplanations") = 'array'
      AND jsonb_array_length("benignExplanations") >= 1),
    "nextStep" TEXT NOT NULL,
    definition JSONB NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
    "definitionHash" TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
    "createdBy" INTEGER REFERENCES actors(id),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    "updatedAt" TIMESTAMPTZ
  );
  CREATE INDEX field_data_identity_keys_form ON field_data_identity_keys ("formId", active);

  CREATE FUNCTION field_data_route_identity_finding()
    RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE version_id UUID; code JSONB;
    BEGIN
      IF (NEW.rule NOT LIKE 'identity-reused:%' AND NEW.rule NOT LIKE 'identity-inconsistent:%')
        OR NEW.outcome <> 'concern' OR NEW.status NOT IN ('open', 'investigating') THEN
        RETURN NEW;
      END IF;
      code := jsonb_build_array(split_part(NEW.rule, ':', 1));

      SELECT v.id INTO version_id
      FROM submissions s
      JOIN submission_defs sd ON sd."submissionId" = s.id AND sd.current IS TRUE
      JOIN field_data_claim_versions v ON v."submissionDefId" = sd.id
      WHERE s."formId" = NEW."formId" AND s."instanceId" = NEW."instanceId"
        AND s."deletedAt" IS NULL AND s.draft IS FALSE;

      IF version_id IS NOT NULL THEN
        INSERT INTO field_data_review_cases ("claimVersionId", "reasonCodes")
          VALUES (version_id, code)
          ON CONFLICT DO NOTHING;
        UPDATE field_data_review_cases
          SET "reasonCodes" = "reasonCodes" || code,
              revision = revision + 1, "updatedAt" = clock_timestamp()
          WHERE "claimVersionId" = version_id AND status IN ('open', 'in-review')
            AND NOT "reasonCodes" @> code;
      END IF;
      RETURN NEW;
    END;
    $$;
  CREATE TRIGGER field_data_identity_finding
    AFTER INSERT OR UPDATE OF outcome, evidence, status ON field_data_integrity_flags
    FOR EACH ROW EXECUTE FUNCTION field_data_route_identity_finding()`);
};

// Keys are configuration, not evidence: findings they produced stay in
// field_data_integrity_flags.
const down = async (db) => {
  await db.raw(`DROP TRIGGER IF EXISTS field_data_identity_finding ON field_data_integrity_flags;
    DROP FUNCTION IF EXISTS field_data_route_identity_finding();
    DROP TABLE IF EXISTS field_data_identity_keys`);
};

module.exports = { up, down };
