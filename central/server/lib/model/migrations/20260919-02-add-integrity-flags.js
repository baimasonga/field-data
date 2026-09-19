// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// Findings from the integrity checks, stored rather than recomputed on sight
// so that a finding can be reproduced later and so that a reviewer's decision
// outlives the next run.
//
// What is kept, and why:
//   rule, ruleVersion   A finding is only meaningful alongside the rule that
//                       produced it. Change the rule, change the version, and
//                       old findings still say what they meant.
//   evidence            A snapshot of the values the rule saw, so the finding
//                       can be read without re-deriving it from data that may
//                       since have changed.
//   outcome             What the rule concluded, including that it could not
//                       conclude. "Inconclusive" is a result, not a silence.
//   status, decision    A human's review, kept separately from the machine's
//   decidedBy, note     finding. A rule never resolves itself.
//
// There is deliberately no score column. An uncalibrated number presented as a
// probability is worse than no number.

const up = async (db) => {
  await db.raw(`CREATE TABLE IF NOT EXISTS field_data_integrity_flags (
    id SERIAL PRIMARY KEY,
    "formId" INTEGER NOT NULL REFERENCES forms(id),
    rule TEXT NOT NULL,
    "ruleVersion" INTEGER NOT NULL,

    -- The submissions the finding is about. The second is null for a rule
    -- that looks at one submission on its own.
    "instanceId" TEXT NOT NULL,
    "relatedInstanceId" TEXT,

    -- concern: the rule found something a person should look at.
    -- inconclusive: the rule ran and could not tell, and says why.
    outcome TEXT NOT NULL,
    evidence JSONB NOT NULL,

    -- open -> investigating -> resolved. A decision is a person's, never a
    -- rule's, and "explained" is as valid an ending as "confirmed".
    status TEXT NOT NULL DEFAULT 'open',
    decision TEXT,
    note TEXT,
    "decidedBy" INTEGER REFERENCES actors(id),
    "decidedAt" TIMESTAMPTZ,

    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
  )`);

  // One finding per rule version per pair, so re-running does not pile up
  // duplicates of the same observation.
  await db.raw(`CREATE UNIQUE INDEX IF NOT EXISTS field_data_integrity_flags_unique
    ON field_data_integrity_flags
    ("formId", rule, "ruleVersion", "instanceId", COALESCE("relatedInstanceId", ''))`);

  await db.raw(`CREATE INDEX IF NOT EXISTS field_data_integrity_flags_form_status
    ON field_data_integrity_flags ("formId", status)`);
};

const down = async (db) => {
  await db.raw('DROP TABLE IF EXISTS field_data_integrity_flags');
};

module.exports = { up, down };
