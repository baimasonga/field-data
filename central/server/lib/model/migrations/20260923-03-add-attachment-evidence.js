// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

// Attachment rows can be inserted before their bytes arrive. Each distinct
// attachment state becomes an immutable evidence snapshot; later uploads do
// not rewrite what a reviewer could have seen earlier.
const up = async (db) => {
  await db.raw(`ALTER TABLE field_data_evidence_records
    DROP CONSTRAINT "field_data_evidence_records_sourceKind_check",
    DROP CONSTRAINT "field_data_evidence_records_contentHash_check",
    DROP CONSTRAINT "field_data_evidence_records_submissionDefId_sourceKind_key"`);
  await db.raw(`ALTER TABLE field_data_evidence_records
    ALTER COLUMN "contentHash" DROP NOT NULL,
    ADD COLUMN "attachmentName" TEXT,
    ADD COLUMN "blobId" INTEGER REFERENCES blobs(id) ON DELETE RESTRICT,
    ADD CONSTRAINT field_data_evidence_source_kind_check
      CHECK ("sourceKind" IN ('submission-xml', 'attachment', 'client-audit')),
    ADD CONSTRAINT field_data_evidence_hash_check
      CHECK ("contentHash" IS NULL OR "contentHash" ~ '^sha256:[0-9a-f]{64}$'),
    ADD CONSTRAINT field_data_evidence_attachment_shape_check CHECK (
      ("sourceKind" = 'submission-xml' AND "attachmentName" IS NULL AND "blobId" IS NULL
       AND "contentHash" IS NOT NULL)
      OR ("sourceKind" IN ('attachment', 'client-audit') AND "attachmentName" IS NOT NULL)
    )`);
  await db.raw(`CREATE UNIQUE INDEX field_data_evidence_xml_source
    ON field_data_evidence_records ("submissionDefId")
    WHERE "sourceKind" = 'submission-xml'`);
  // NULL blob ID represents an expected file whose bytes never arrived.
  await db.raw(`CREATE UNIQUE INDEX field_data_evidence_attachment_snapshot
    ON field_data_evidence_records ("submissionDefId", "attachmentName", "sourceKind",
      COALESCE("blobId", -1)) WHERE "attachmentName" IS NOT NULL`);
  // P0.3 XML registration used a named conflict target. Its uniqueness is now
  // a partial index so attachment snapshots can coexist on the same def.
  await db.raw(`CREATE OR REPLACE FUNCTION field_data_register_xml_evidence()
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
      ON CONFLICT DO NOTHING;
      SELECT id INTO registered_id FROM field_data_evidence_records
        WHERE "submissionDefId" = NEW."submissionDefId" AND "sourceKind" = 'submission-xml';
      INSERT INTO field_data_claim_evidence ("claimVersionId", "evidenceId", relation)
        VALUES (NEW.id, registered_id, 'context') ON CONFLICT DO NOTHING;
      RETURN NEW;
    END;
    $$`);
  await db.raw(`CREATE FUNCTION field_data_register_attachment_evidence()
    RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE registered_id UUID;
    DECLARE kind TEXT;
    BEGIN
      kind := CASE WHEN NEW."isClientAudit" IS TRUE THEN 'client-audit' ELSE 'attachment' END;
      INSERT INTO field_data_evidence_records
        ("submissionDefId", "sourceKind", "attachmentName", "blobId",
         "contentHash", "mimeType", "byteSize", "receivedAt", degraded)
      SELECT NEW."submissionDefId", kind, NEW.name, NEW."blobId",
        CASE WHEN b.content IS NOT NULL
          THEN 'sha256:' || encode(sha256(b.content), 'hex') ELSE NULL END,
        COALESCE(b."contentType", 'application/octet-stream'),
        COALESCE(octet_length(b.content), 0), clock_timestamp(),
        CASE WHEN NEW."blobId" IS NULL
          THEN '{"reason":"expected-attachment-not-received"}'::jsonb
          WHEN b.content IS NULL
          THEN '{"reason":"object-store-bytes-not-verified-at-registration"}'::jsonb
          ELSE NULL END
      FROM (SELECT 1) stub LEFT JOIN blobs b ON b.id = NEW."blobId"
      ON CONFLICT DO NOTHING;

      SELECT id INTO registered_id FROM field_data_evidence_records
        WHERE "submissionDefId" = NEW."submissionDefId"
          AND "attachmentName" = NEW.name AND "sourceKind" = kind
          AND "blobId" IS NOT DISTINCT FROM NEW."blobId";
      INSERT INTO field_data_claim_evidence ("claimVersionId", "evidenceId", relation)
        SELECT v.id, registered_id, 'context' FROM field_data_claim_versions v
        WHERE v."submissionDefId" = NEW."submissionDefId"
        ON CONFLICT DO NOTHING;
      RETURN NEW;
    END;
    $$`);
  await db.raw(`CREATE TRIGGER field_data_attachment_evidence
    AFTER INSERT OR UPDATE OF "blobId" ON submission_attachments
    FOR EACH ROW EXECUTE FUNCTION field_data_register_attachment_evidence()`);
  // Backfill only attachments belonging to mapped versions; older uploaded
  // objects have no local content, so they remain explicitly unverified.
  await db.raw(`INSERT INTO field_data_evidence_records
    ("submissionDefId", "sourceKind", "attachmentName", "blobId",
     "contentHash", "mimeType", "byteSize", "receivedAt", degraded)
    SELECT sa."submissionDefId",
      CASE WHEN sa."isClientAudit" IS TRUE THEN 'client-audit' ELSE 'attachment' END,
      sa.name, sa."blobId",
      CASE WHEN b.content IS NOT NULL
        THEN 'sha256:' || encode(sha256(b.content), 'hex') ELSE NULL END,
      COALESCE(b."contentType", 'application/octet-stream'),
      COALESCE(octet_length(b.content), 0), clock_timestamp(),
      CASE WHEN sa."blobId" IS NULL
        THEN '{"reason":"expected-attachment-not-received"}'::jsonb
        WHEN b.content IS NULL
        THEN '{"reason":"object-store-bytes-not-verified-at-backfill"}'::jsonb
        ELSE '{"reason":"historical-capture-time-unknown","hashTiming":"computed-during-p0.3-backfill"}'::jsonb END
    FROM submission_attachments sa
    JOIN field_data_claim_versions v ON v."submissionDefId" = sa."submissionDefId"
    LEFT JOIN blobs b ON b.id = sa."blobId"
    ON CONFLICT DO NOTHING`);
  await db.raw(`INSERT INTO field_data_claim_evidence ("claimVersionId", "evidenceId", relation)
    SELECT v.id, e.id, 'context' FROM field_data_evidence_records e
    JOIN field_data_claim_versions v ON v."submissionDefId" = e."submissionDefId"
    WHERE e."sourceKind" <> 'submission-xml' ON CONFLICT DO NOTHING`);
};

const down = async (db) => {
  await db.raw('DROP TRIGGER IF EXISTS field_data_attachment_evidence ON submission_attachments');
  await db.raw('DROP FUNCTION IF EXISTS field_data_register_attachment_evidence()');
  await db.raw(`DELETE FROM field_data_claim_evidence WHERE "evidenceId" IN
    (SELECT id FROM field_data_evidence_records WHERE "sourceKind" <> 'submission-xml')`);
  await db.raw(`DELETE FROM field_data_evidence_records WHERE "sourceKind" <> 'submission-xml'`);
  await db.raw('DROP INDEX IF EXISTS field_data_evidence_attachment_snapshot');
  await db.raw('DROP INDEX IF EXISTS field_data_evidence_xml_source');
  await db.raw(`ALTER TABLE field_data_evidence_records DROP CONSTRAINT field_data_evidence_source_kind_check,
    DROP CONSTRAINT field_data_evidence_hash_check,
    DROP CONSTRAINT field_data_evidence_attachment_shape_check,
    DROP COLUMN "attachmentName", DROP COLUMN "blobId"`);
  await db.raw(`ALTER TABLE field_data_evidence_records
    ALTER COLUMN "contentHash" SET NOT NULL,
    ADD CONSTRAINT "field_data_evidence_records_sourceKind_check" CHECK ("sourceKind" = 'submission-xml'),
    ADD CONSTRAINT "field_data_evidence_records_contentHash_check"
      CHECK ("contentHash" ~ '^sha256:[0-9a-f]{64}$'),
    ADD CONSTRAINT "field_data_evidence_records_submissionDefId_sourceKind_key"
      UNIQUE ("submissionDefId", "sourceKind")`);
  // Restoring the original function here is not necessary for a full rollback:
  // the P0.3 XML migration's down step drops it with its table.
};

module.exports = { up, down };
