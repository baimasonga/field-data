// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

// First P0.3 slice: register the exact stored XML for every claim version.
// The trigger covers all ODK submission paths, including imports and edits.
const up = async (db) => {
  await db.raw(`CREATE TABLE field_data_evidence_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "submissionDefId" INTEGER NOT NULL REFERENCES submission_defs(id) ON DELETE CASCADE,
    "sourceKind" TEXT NOT NULL CHECK ("sourceKind" = 'submission-xml'),
    "contentHash" TEXT NOT NULL CHECK ("contentHash" ~ '^sha256:[0-9a-f]{64}$'),
    "hashAlgorithm" TEXT NOT NULL DEFAULT 'sha256' CHECK ("hashAlgorithm" = 'sha256'),
    "mimeType" TEXT NOT NULL DEFAULT 'application/xml',
    "byteSize" BIGINT NOT NULL CHECK ("byteSize" >= 0),
    "receivedAt" TIMESTAMPTZ NOT NULL,
    "policyVersion" TEXT NOT NULL DEFAULT 'p0.3',
    degraded JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE ("submissionDefId", "sourceKind")
  )`);
  await db.raw(`CREATE TABLE field_data_claim_evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "claimVersionId" UUID NOT NULL REFERENCES field_data_claim_versions(id) ON DELETE CASCADE,
    "evidenceId" UUID NOT NULL REFERENCES field_data_evidence_records(id) ON DELETE CASCADE,
    relation TEXT NOT NULL CHECK (relation = 'context'),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE ("claimVersionId", "evidenceId", relation)
  )`);
  await db.raw(`CREATE FUNCTION field_data_reject_evidence_update()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'Evidence records and links are append-only' USING ERRCODE = '23514';
    END;
    $$`);
  await db.raw(`CREATE TRIGGER field_data_evidence_immutable
    BEFORE UPDATE ON field_data_evidence_records
    FOR EACH ROW EXECUTE FUNCTION field_data_reject_evidence_update()`);
  await db.raw(`CREATE TRIGGER field_data_evidence_link_immutable
    BEFORE UPDATE ON field_data_claim_evidence
    FOR EACH ROW EXECUTE FUNCTION field_data_reject_evidence_update()`);
  await db.raw(`CREATE FUNCTION field_data_register_xml_evidence()
    RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE registered_id UUID;
    BEGIN
      INSERT INTO field_data_evidence_records
        ("submissionDefId", "sourceKind", "contentHash", "byteSize", "receivedAt", degraded)
      SELECT sd.id, 'submission-xml',
        'sha256:' || encode(sha256(convert_to(sd.xml, 'UTF8')), 'hex'),
        octet_length(convert_to(sd.xml, 'UTF8')),
        COALESCE(p."receivedAt", sd."createdAt", clock_timestamp()),
        CASE WHEN NEW."lineageBasis" = 'backfill-id-order'
          THEN '{"reason":"historical-capture-time-unknown","hashTiming":"computed-during-p0.3-backfill"}'::jsonb
          ELSE NULL END
      FROM submission_defs sd
      LEFT JOIN field_data_submission_provenance p ON p."submissionDefId" = sd.id
      WHERE sd.id = NEW."submissionDefId"
      ON CONFLICT ("submissionDefId", "sourceKind") DO NOTHING;

      SELECT id INTO registered_id FROM field_data_evidence_records
        WHERE "submissionDefId" = NEW."submissionDefId" AND "sourceKind" = 'submission-xml';
      INSERT INTO field_data_claim_evidence ("claimVersionId", "evidenceId", relation)
        VALUES (NEW.id, registered_id, 'context') ON CONFLICT DO NOTHING;
      RETURN NEW;
    END;
    $$`);
  await db.raw(`CREATE TRIGGER field_data_claim_xml_evidence
    AFTER INSERT ON field_data_claim_versions
    FOR EACH ROW EXECUTE FUNCTION field_data_register_xml_evidence()`);
  await db.raw(`INSERT INTO field_data_evidence_records
    ("submissionDefId", "sourceKind", "contentHash", "byteSize", "receivedAt", degraded)
    SELECT sd.id, 'submission-xml',
      'sha256:' || encode(sha256(convert_to(sd.xml, 'UTF8')), 'hex'),
      octet_length(convert_to(sd.xml, 'UTF8')),
      COALESCE(p."receivedAt", sd."createdAt", clock_timestamp()),
      '{"reason":"historical-capture-time-unknown","hashTiming":"computed-during-p0.3-backfill"}'::jsonb
    FROM field_data_claim_versions v
    JOIN submission_defs sd ON sd.id = v."submissionDefId"
    LEFT JOIN field_data_submission_provenance p ON p."submissionDefId" = sd.id
    ON CONFLICT ("submissionDefId", "sourceKind") DO NOTHING`);
  await db.raw(`INSERT INTO field_data_claim_evidence ("claimVersionId", "evidenceId", relation)
    SELECT v.id, e.id, 'context' FROM field_data_claim_versions v
    JOIN field_data_evidence_records e ON e."submissionDefId" = v."submissionDefId"
    ON CONFLICT DO NOTHING`);
};

const down = async (db) => {
  await db.raw('DROP TRIGGER IF EXISTS field_data_claim_xml_evidence ON field_data_claim_versions');
  await db.raw('DROP FUNCTION IF EXISTS field_data_register_xml_evidence()');
  await db.raw('DROP TABLE IF EXISTS field_data_claim_evidence');
  await db.raw('DROP TABLE IF EXISTS field_data_evidence_records');
  await db.raw('DROP FUNCTION IF EXISTS field_data_reject_evidence_update()');
};

module.exports = { up, down };
