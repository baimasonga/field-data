// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// Every Submission version gets provenance, written by a trigger rather than
// by the five upstream call sites that create one.
//
// A trigger is unusual enough to justify: ODK's submission routes are upstream
// code this fork keeps merging, and touching five of them -- or the two model
// functions under them -- is divergence that has to be re-resolved on every
// merge. It is also a stronger guarantee than remembering to call something:
// a Submission version cannot exist without provenance, including one written
// by an upstream path that does not exist yet.
//
// The default is 'collected', which is what an ODK submission is. A path that
// knows better updates the row it just caused, inside the same transaction;
// see the CSV import.

const up = async (db) => {
  await db.raw(`
    CREATE FUNCTION field_data_record_submission_provenance()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      INSERT INTO field_data_submission_provenance
        ("submissionDefId", origin, "sourceRef", "capturedAt", "receivedAt",
         "integrityHash", "transformVersion", "policyVersion", degraded)
      VALUES (
        NEW.id,
        'collected',
        NULL,
        -- ODK carries no separate observation time: what it records is when
        -- the server received the Submission. Saying so is the honest answer;
        -- copying createdAt into capturedAt would assert the interview
        -- happened at the moment it was uploaded.
        NULL,
        COALESCE(NEW."createdAt", clock_timestamp()),
        encode(sha256(convert_to(NEW.xml, 'UTF8')), 'hex'),
        'odk-submission@1',
        'p0.1',
        '{"capturedAt":"not-reported"}'::jsonb)
      ON CONFLICT ("submissionDefId") DO NOTHING;
      RETURN NULL;
    END $$`);

  await db.raw(`
    CREATE TRIGGER field_data_submission_provenance_trigger
    AFTER INSERT ON submission_defs
    FOR EACH ROW EXECUTE FUNCTION field_data_record_submission_provenance()`);
};

const down = async (db) => {
  await db.raw('DROP TRIGGER IF EXISTS field_data_submission_provenance_trigger ON submission_defs');
  await db.raw('DROP FUNCTION IF EXISTS field_data_record_submission_provenance()');
};

module.exports = { up, down };
