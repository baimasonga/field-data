// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// Provenance for a Submission version: where it came from, when it was
// observed as distinct from when it arrived, and whether its bytes are still
// its bytes. See docs/field-intelligence/P0.1-provenance-envelope.md.
//
// Its own table rather than columns on submission_defs. This is a fork that
// keeps merging upstream, and columns added to a core table turn every future
// upstream migration into a conflict.

const up = async (db) => {
  await db.raw(`
    CREATE TABLE field_data_submission_provenance (
      "submissionDefId"  INTEGER PRIMARY KEY
                         REFERENCES submission_defs(id) ON DELETE CASCADE,
      origin             TEXT NOT NULL
                         CHECK (origin IN ('collected','imported','migrated','api')),
      "sourceRef"        TEXT,
      -- Nullable on purpose. An import does not know when the observation was
      -- made, and defaulting it to the receipt time would invent a fact.
      "capturedAt"       TIMESTAMPTZ,
      "receivedAt"       TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
      "integrityHash"    TEXT NOT NULL,
      "transformVersion" TEXT NOT NULL,
      "policyVersion"    TEXT NOT NULL,
      -- What was unavailable, recorded rather than inferred from absence.
      degraded           JSONB
    )`);

  // Reviewers filter by how a row arrived far more often than by anything else
  // here, and the backfill below makes every existing row 'collected', so the
  // interesting values are the rare ones.
  await db.raw(`
    CREATE INDEX field_data_submission_provenance_origin
      ON field_data_submission_provenance (origin)`);

  // Every row that predates the envelope. 'collected' is an assumption -- these
  // rows are older than the question -- so degraded says so rather than
  // presenting the assumption as knowledge. The hash is computed now, not at
  // capture, and transformVersion records that.
  await db.raw(`
    INSERT INTO field_data_submission_provenance
      ("submissionDefId", origin, "sourceRef", "capturedAt", "receivedAt",
       "integrityHash", "transformVersion", "policyVersion", degraded)
    SELECT sd.id,
           'collected',
           NULL,
           NULL,
           COALESCE(sd."createdAt", clock_timestamp()),
           encode(sha256(convert_to(sd.xml, 'UTF8')), 'hex'),
           'backfill@1',
           'p0.1',
           '{"capturedAt":"unknown","origin":"assumed","integrityHash":"computed-at-backfill"}'::jsonb
    FROM submission_defs sd
    ON CONFLICT ("submissionDefId") DO NOTHING`);
};

const down = async (db) => {
  await db.raw('DROP TABLE IF EXISTS field_data_submission_provenance');
};

module.exports = { up, down };
