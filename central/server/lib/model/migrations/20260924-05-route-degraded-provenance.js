// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

// Degraded capture evidence is a review question, never a finding of fraud.
// The version carries the degradation into this trigger because sibling writes
// in the submission's data-modifying CTE cannot see one another's table rows.
const up = async (db) => {
  await db.raw(`CREATE FUNCTION field_data_route_degraded_claim_version()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.degraded IS NOT NULL THEN
        INSERT INTO field_data_review_cases ("claimVersionId", "reasonCodes")
          VALUES (NEW.id, '["provenance-degraded"]'::jsonb)
          ON CONFLICT DO NOTHING;
      END IF;
      RETURN NEW;
    END;
    $$;
  CREATE TRIGGER field_data_degraded_claim_version
    AFTER INSERT ON field_data_claim_versions
    FOR EACH ROW EXECUTE FUNCTION field_data_route_degraded_claim_version();

  INSERT INTO field_data_review_cases ("claimVersionId", "reasonCodes")
    SELECT v.id, '["provenance-degraded"]'::jsonb
    FROM field_data_claim_versions v
    JOIN submission_defs sd ON sd.id = v."submissionDefId" AND sd.current IS TRUE
    JOIN submissions s ON s.id = sd."submissionId" AND s."deletedAt" IS NULL
    JOIN field_data_submission_provenance p ON p."submissionDefId" = sd.id
    WHERE p.degraded IS NOT NULL
    ON CONFLICT DO NOTHING;

  UPDATE field_data_review_cases rc
    SET "reasonCodes" = rc."reasonCodes" || '["provenance-degraded"]'::jsonb,
        revision = rc.revision + 1, "updatedAt" = clock_timestamp()
    FROM field_data_claim_versions v
    JOIN submission_defs sd ON sd.id = v."submissionDefId" AND sd.current IS TRUE
    JOIN submissions s ON s.id = sd."submissionId" AND s."deletedAt" IS NULL
    JOIN field_data_submission_provenance p ON p."submissionDefId" = sd.id
    WHERE rc."claimVersionId" = v.id AND p.degraded IS NOT NULL
      AND rc.status IN ('open', 'in-review')
      AND NOT rc."reasonCodes" @> '["provenance-degraded"]'::jsonb`);

  // A later core review flag adds its reason to an existing provenance case.
  await db.raw(`CREATE FUNCTION field_data_append_legacy_review_reason()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      UPDATE field_data_review_cases rc
        SET "reasonCodes" = rc."reasonCodes" || '["legacy-review-state"]'::jsonb,
            revision = rc.revision + 1, "updatedAt" = clock_timestamp()
        FROM field_data_claim_versions v
        JOIN field_data_claims c ON c.id = v."claimId"
        JOIN submission_defs sd ON sd.id = v."submissionDefId" AND sd.current IS TRUE
        WHERE rc."claimVersionId" = v.id AND c."submissionId" = NEW.id
          AND rc.status IN ('open', 'in-review')
          AND NOT rc."reasonCodes" @> '["legacy-review-state"]'::jsonb;
      RETURN NEW;
    END;
    $$;
  CREATE TRIGGER field_data_append_legacy_review_reason
    AFTER UPDATE OF "reviewState" ON submissions
    FOR EACH ROW WHEN (NEW."reviewState" = 'hasIssues' AND NEW."deletedAt" IS NULL)
    EXECUTE FUNCTION field_data_append_legacy_review_reason()`);
};

const down = async (db) => {
  await db.raw('DROP TRIGGER IF EXISTS field_data_append_legacy_review_reason ON submissions');
  await db.raw('DROP FUNCTION IF EXISTS field_data_append_legacy_review_reason()');
  await db.raw('DROP TRIGGER IF EXISTS field_data_degraded_claim_version ON field_data_claim_versions');
  await db.raw('DROP FUNCTION IF EXISTS field_data_route_degraded_claim_version()');
  // Preserve review cases and all human decisions across a routing rollback.
};

module.exports = { up, down };
