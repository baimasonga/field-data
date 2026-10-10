// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

// F4 near-duplicate submissions (docs/field-intelligence/F4-near-duplicates.md).
// An open 'near-duplicate' finding adds that reason code to the claim
// version's review case, as the other checks' findings do.
const up = async (db) => {
  await db.raw(`CREATE FUNCTION field_data_route_near_duplicate()
    RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE version_id UUID; code JSONB := '["near-duplicate"]'::jsonb;
    BEGIN
      IF NEW.rule <> 'near-duplicate' OR NEW.outcome <> 'concern' OR NEW.status NOT IN ('open', 'investigating') THEN
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
          VALUES (version_id, code)
          ON CONFLICT DO NOTHING;
        UPDATE field_data_review_cases
          SET "reasonCodes" = "reasonCodes" || code,
              revision = revision + 1, "updatedAt" = clock_timestamp()
          WHERE "claimVersionId" = version_id AND status IN ('open', 'in-review')
            AND NOT "reasonCodes" @> code AND jsonb_array_length("reasonCodes") < 20;
      END IF;
      RETURN NEW;
    END;
    $$;
  CREATE TRIGGER field_data_near_duplicate
    AFTER INSERT OR UPDATE OF outcome, evidence, status ON field_data_integrity_flags
    FOR EACH ROW EXECUTE FUNCTION field_data_route_near_duplicate()`);
};

// The findings stay in field_data_integrity_flags; only the routing goes.
const down = async (db) => {
  await db.raw(`DROP TRIGGER IF EXISTS field_data_near_duplicate ON field_data_integrity_flags;
    DROP FUNCTION IF EXISTS field_data_route_near_duplicate()`);
};

module.exports = { up, down };
