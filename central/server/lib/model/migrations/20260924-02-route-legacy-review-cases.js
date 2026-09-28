// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

// A flagged core Submission opens a claim-version case. It does not invent a
// reviewer decision or alter Central's existing review state semantics.
const up = async (db) => {
  await db.raw(`CREATE FUNCTION field_data_open_legacy_review_case()
    RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE current_version UUID;
    BEGIN
      IF NEW."reviewState" IS DISTINCT FROM 'hasIssues' OR NEW."deletedAt" IS NOT NULL THEN
        RETURN NEW;
      END IF;
      SELECT v.id INTO current_version
        FROM field_data_claims c
        JOIN field_data_claim_versions v ON v."claimId" = c.id
        JOIN submission_defs sd ON sd.id = v."submissionDefId"
        WHERE c."submissionId" = NEW.id AND sd.current IS TRUE;
      IF current_version IS NOT NULL THEN
        INSERT INTO field_data_review_cases ("claimVersionId", "reasonCodes")
          VALUES (current_version, '["legacy-review-state"]'::jsonb)
          ON CONFLICT DO NOTHING;
      END IF;
      RETURN NEW;
    END;
    $$;
  CREATE TRIGGER field_data_legacy_review_case
    AFTER UPDATE OF "reviewState" ON submissions
    FOR EACH ROW WHEN (NEW."reviewState" = 'hasIssues')
    EXECUTE FUNCTION field_data_open_legacy_review_case();

  INSERT INTO field_data_review_cases ("claimVersionId", "reasonCodes")
    SELECT v.id, '["legacy-review-state"]'::jsonb
    FROM submissions s
    JOIN field_data_claims c ON c."submissionId" = s.id
    JOIN field_data_claim_versions v ON v."claimId" = c.id
    JOIN submission_defs sd ON sd.id = v."submissionDefId" AND sd.current IS TRUE
    WHERE s."reviewState" = 'hasIssues' AND s."deletedAt" IS NULL
    ON CONFLICT DO NOTHING`);
};

const down = async (db) => {
  await db.raw('DROP TRIGGER IF EXISTS field_data_legacy_review_case ON submissions');
  await db.raw('DROP FUNCTION IF EXISTS field_data_open_legacy_review_case()');
  // Keep cases and decision history. Rolling back routing must never delete review work.
};

module.exports = { up, down };
