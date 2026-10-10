// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

// R1 receipt ledger (docs/field-intelligence/R1-receipt-ledger.md). One
// receipt per submission version received, chained per project, written by a
// trigger on the provenance row so that no path stores a submission without
// one. The hash format must match lib/util/receipts.js byte for byte.
const up = async (db) => {
  await db.raw(`CREATE TABLE IF NOT EXISTS field_data_receipts (
    "projectId" INTEGER NOT NULL,
    seq INTEGER NOT NULL CHECK (seq >= 1),
    -- Null once the submission version or its form is purged; the receipt stays.
    "submissionDefId" INTEGER UNIQUE REFERENCES submission_defs(id) ON DELETE SET NULL,
    "formId" INTEGER REFERENCES forms(id) ON DELETE SET NULL,
    "xmlFormId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "submitterId" INTEGER,
    "receivedAt" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL CHECK ("contentHash" ~ '^[0-9a-f]{64}$'),
    "prevHash" TEXT NOT NULL CHECK ("prevHash" ~ '^[0-9a-f]{64}$'),
    "entryHash" TEXT NOT NULL UNIQUE CHECK ("entryHash" ~ '^[0-9a-f]{64}$'),
    backfilled BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY ("projectId", seq)
  );
  CREATE INDEX IF NOT EXISTS field_data_receipts_submitter ON field_data_receipts ("projectId", "submitterId", seq);

  CREATE OR REPLACE FUNCTION field_data_receipt_field(value TEXT) RETURNS TEXT
    LANGUAGE sql IMMUTABLE AS $$ SELECT octet_length(coalesce(value, ''))::text || ':' || coalesce(value, '') $$;

  CREATE OR REPLACE FUNCTION field_data_append_receipt(def_id INTEGER, is_backfill BOOLEAN)
    RETURNS VOID LANGUAGE plpgsql AS $$
    DECLARE src RECORD; prev RECORD; next_seq INTEGER; prev_hash TEXT; received TEXT; entry TEXT;
    BEGIN
      SELECT sd."instanceId", sd."submitterId", s."formId", f."projectId", f."xmlFormId", p."integrityHash", p."receivedAt"
        INTO src
        FROM submission_defs sd
        JOIN submissions s ON s.id = sd."submissionId"
        JOIN forms f ON f.id = s."formId"
        JOIN field_data_submission_provenance p ON p."submissionDefId" = sd.id
        WHERE sd.id = def_id AND s.draft IS FALSE;
      IF NOT FOUND OR EXISTS (SELECT 1 FROM field_data_receipts WHERE "submissionDefId" = def_id) THEN
        RETURN;
      END IF;
      PERFORM pg_advisory_xact_lock(74140, src."projectId");
      SELECT seq, "entryHash" INTO prev FROM field_data_receipts
        WHERE "projectId" = src."projectId" ORDER BY seq DESC LIMIT 1;
      next_seq := coalesce(prev.seq, 0) + 1;
      prev_hash := coalesce(prev."entryHash", repeat('0', 64));
      received := to_char(src."receivedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
      entry := encode(sha256(convert_to('receipt@1'
        || field_data_receipt_field(src."projectId"::text) || field_data_receipt_field(next_seq::text)
        || field_data_receipt_field(src."xmlFormId") || field_data_receipt_field(src."instanceId")
        || field_data_receipt_field(src."submitterId"::text) || field_data_receipt_field(received)
        || field_data_receipt_field(src."integrityHash") || field_data_receipt_field(prev_hash), 'UTF8')), 'hex');
      INSERT INTO field_data_receipts ("projectId", seq, "submissionDefId", "formId", "xmlFormId", "instanceId",
        "submitterId", "receivedAt", "contentHash", "prevHash", "entryHash", backfilled)
      VALUES (src."projectId", next_seq, def_id, src."formId", src."xmlFormId", src."instanceId",
        src."submitterId", received, src."integrityHash", prev_hash, entry, is_backfill);
    END;
    $$;

  CREATE OR REPLACE FUNCTION field_data_receipt_on_provenance() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      PERFORM field_data_append_receipt(NEW."submissionDefId", false);
      RETURN NEW;
    END;
    $$;
  DROP TRIGGER IF EXISTS field_data_receipt ON field_data_submission_provenance;
  CREATE TRIGGER field_data_receipt AFTER INSERT ON field_data_submission_provenance
    FOR EACH ROW EXECUTE FUNCTION field_data_receipt_on_provenance();

  -- Receipts never change: only the links to a purged submission or form may
  -- become null.
  CREATE OR REPLACE FUNCTION field_data_guard_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Receipts are append-only' USING ERRCODE = '23514';
      END IF;
      IF (NEW."projectId", NEW.seq, NEW."xmlFormId", NEW."instanceId", NEW."submitterId", NEW."receivedAt",
          NEW."contentHash", NEW."prevHash", NEW."entryHash", NEW.backfilled)
        IS DISTINCT FROM (OLD."projectId", OLD.seq, OLD."xmlFormId", OLD."instanceId", OLD."submitterId", OLD."receivedAt",
          OLD."contentHash", OLD."prevHash", OLD."entryHash", OLD.backfilled)
        OR (NEW."submissionDefId" IS DISTINCT FROM OLD."submissionDefId" AND NEW."submissionDefId" IS NOT NULL)
        OR (NEW."formId" IS DISTINCT FROM OLD."formId" AND NEW."formId" IS NOT NULL) THEN
        RAISE EXCEPTION 'Receipts are append-only' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
    $$;
  DROP TRIGGER IF EXISTS field_data_receipt_guard ON field_data_receipts;
  CREATE TRIGGER field_data_receipt_guard BEFORE UPDATE OR DELETE ON field_data_receipts
    FOR EACH ROW EXECUTE FUNCTION field_data_guard_receipt()`);

  // Submissions received before the ledger, in the order they arrived.
  await db.raw(`DO $$ DECLARE d RECORD; BEGIN
    FOR d IN SELECT p."submissionDefId" FROM field_data_submission_provenance p
      LEFT JOIN field_data_receipts r ON r."submissionDefId" = p."submissionDefId"
      WHERE r."submissionDefId" IS NULL ORDER BY p."receivedAt", p."submissionDefId"
    LOOP PERFORM field_data_append_receipt(d."submissionDefId", true); END LOOP;
  END $$`);
};

// Receipts are a custody record: the table is kept on a rollback when it holds
// any. Appending stops until the migration runs again, which backfills.
const down = async (db) => {
  await db.raw(`DROP TRIGGER IF EXISTS field_data_receipt ON field_data_submission_provenance;
    DROP FUNCTION IF EXISTS field_data_receipt_on_provenance();
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM field_data_receipts) THEN
        DROP TABLE field_data_receipts;
        DROP FUNCTION IF EXISTS field_data_guard_receipt();
      END IF;
    END $$;
    DROP FUNCTION IF EXISTS field_data_append_receipt(INTEGER, BOOLEAN);
    DROP FUNCTION IF EXISTS field_data_receipt_field(TEXT)`);
};

module.exports = { up, down };
