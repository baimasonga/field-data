// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

// G1 location checks (docs/field-intelligence/G1-location-evidence.md). An
// open location concern adds its reason code to the claim version's review
// case, the same way a missing capture time does. A near-edge result is
// inconclusive and adds nothing. Reason codes record why a case was opened, so
// they are not removed when the finding is later resolved or withdrawn.
// No G1 finding exists before this migration, so there is nothing to backfill.
const up = async (db) => {
  await db.raw(`CREATE FUNCTION field_data_route_location_finding()
    RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE
      version_id UUID;
      code TEXT;
    BEGIN
      code := CASE NEW.rule
        WHEN 'location-accuracy' THEN 'location-accuracy-poor'
        WHEN 'outside-project-area' THEN 'location-outside-area'
        WHEN 'repeated-location' THEN 'location-repeated'
      END;
      IF code IS NULL OR NEW.outcome <> 'concern'
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
          VALUES (version_id, jsonb_build_array(code))
          ON CONFLICT DO NOTHING;
        UPDATE field_data_review_cases
          SET "reasonCodes" = "reasonCodes" || jsonb_build_array(code),
              revision = revision + 1, "updatedAt" = clock_timestamp()
          WHERE "claimVersionId" = version_id AND status IN ('open', 'in-review')
            AND NOT "reasonCodes" @> jsonb_build_array(code);
      END IF;
      RETURN NEW;
    END;
    $$;
  CREATE TRIGGER field_data_location_finding
    AFTER INSERT OR UPDATE OF outcome, evidence, status ON field_data_integrity_flags
    FOR EACH ROW EXECUTE FUNCTION field_data_route_location_finding()`);
};

const down = async (db) => {
  await db.raw(`DROP TRIGGER IF EXISTS field_data_location_finding ON field_data_integrity_flags;
    DROP FUNCTION IF EXISTS field_data_route_location_finding()`);
};

module.exports = { up, down };
