// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// Records Field Data review decisions (approval workflow): who decided what on a
// submission, with an optional note. The submission's own reviewState is still
// the source of truth; this table is the decision history / audit trail.

const up = async (db) => {
  await db.raw(`CREATE TABLE IF NOT EXISTS field_data_reviews (
    id SERIAL PRIMARY KEY,
    "submissionId" INTEGER NOT NULL REFERENCES submissions (id) ON DELETE CASCADE,
    decision VARCHAR(20) NOT NULL,
    note TEXT,
    "reviewedBy" VARCHAR(255),
    "reviewedAt" TIMESTAMP DEFAULT clock_timestamp()
  )`);
  await db.raw(`CREATE INDEX IF NOT EXISTS idx_fk_field_data_reviews_submissionId
    ON field_data_reviews ("submissionId")`);
};

const down = async (db) => {
  await db.raw('DROP TABLE IF EXISTS field_data_reviews');
};

module.exports = { up, down };
