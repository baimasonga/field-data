// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

// The verification panel uses device audit time, which is distinct from the
// submission's provenance timestamp. Route its recorded, unresolved question
// to the same claim version that the reviewer can inspect.
const up = async (db) => {
  await db.raw(`CREATE FUNCTION field_data_route_missing_capture_finding()
    RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE version_id UUID;
    BEGIN
      IF NEW.outcome <> 'inconclusive'
        OR NEW.evidence->>'reason' IS DISTINCT FROM 'no-capture-time'
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
          VALUES (version_id, '["capture-time-unavailable"]'::jsonb)
          ON CONFLICT DO NOTHING;
        UPDATE field_data_review_cases
          SET "reasonCodes" = "reasonCodes" || '["capture-time-unavailable"]'::jsonb,
              revision = revision + 1, "updatedAt" = clock_timestamp()
          WHERE "claimVersionId" = version_id AND status IN ('open', 'in-review')
            AND NOT "reasonCodes" @> '["capture-time-unavailable"]'::jsonb;
      END IF;
      RETURN NEW;
    END;
    $$;
  CREATE TRIGGER field_data_missing_capture_finding
    AFTER INSERT OR UPDATE OF outcome, evidence, status ON field_data_integrity_flags
    FOR EACH ROW EXECUTE FUNCTION field_data_route_missing_capture_finding();

  INSERT INTO field_data_review_cases ("claimVersionId", "reasonCodes")
    SELECT DISTINCT v.id, '["capture-time-unavailable"]'::jsonb
    FROM field_data_integrity_flags f
    JOIN submissions s ON s."formId" = f."formId"
      AND s."instanceId" = f."instanceId" AND s."deletedAt" IS NULL AND s.draft IS FALSE
    JOIN submission_defs sd ON sd."submissionId" = s.id AND sd.current IS TRUE
    JOIN field_data_claim_versions v ON v."submissionDefId" = sd.id
    WHERE f.outcome = 'inconclusive'
      AND f.evidence->>'reason' = 'no-capture-time'
      AND f.status IN ('open', 'investigating')
    ON CONFLICT DO NOTHING;

  UPDATE field_data_review_cases rc
    SET "reasonCodes" = rc."reasonCodes" || '["capture-time-unavailable"]'::jsonb,
        revision = rc.revision + 1, "updatedAt" = clock_timestamp()
    WHERE rc.status IN ('open', 'in-review')
      AND NOT rc."reasonCodes" @> '["capture-time-unavailable"]'::jsonb
      AND EXISTS (
        SELECT 1 FROM field_data_integrity_flags f
        JOIN submissions s ON s."formId" = f."formId"
          AND s."instanceId" = f."instanceId" AND s."deletedAt" IS NULL AND s.draft IS FALSE
        JOIN submission_defs sd ON sd."submissionId" = s.id AND sd.current IS TRUE
        JOIN field_data_claim_versions v ON v."submissionDefId" = sd.id
        WHERE v.id = rc."claimVersionId" AND f.outcome = 'inconclusive'
          AND f.evidence->>'reason' = 'no-capture-time'
          AND f.status IN ('open', 'investigating')
      )`);
};

const down = async (db) => {
  await db.raw('DROP TRIGGER IF EXISTS field_data_missing_capture_finding ON field_data_integrity_flags');
  await db.raw('DROP FUNCTION IF EXISTS field_data_route_missing_capture_finding()');
  // Keep recorded cases and decisions; a rollback changes only future routing.
};

module.exports = { up, down };
