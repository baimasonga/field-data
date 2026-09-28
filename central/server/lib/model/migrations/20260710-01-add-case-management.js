// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// Case management: registered beneficiaries/sites ("cases") that are revisited
// over time, the links from cases to their submissions (visit history), and
// assignments dispatching a case to an enumerator with a due date.

const up = async (db) => {
  await db.raw(`CREATE TABLE IF NOT EXISTS field_data_cases (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(40) NOT NULL DEFAULT 'household',
    district VARCHAR(80),
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    note TEXT,
    "createdAt" TIMESTAMP DEFAULT clock_timestamp()
  )`);
  await db.raw(`CREATE INDEX IF NOT EXISTS idx_field_data_cases_district
    ON field_data_cases (district)`);

  await db.raw(`CREATE TABLE IF NOT EXISTS field_data_case_submissions (
    "caseId" INTEGER NOT NULL REFERENCES field_data_cases (id) ON DELETE CASCADE,
    "submissionId" INTEGER NOT NULL REFERENCES submissions (id) ON DELETE CASCADE,
    PRIMARY KEY ("caseId", "submissionId")
  )`);
  await db.raw(`CREATE INDEX IF NOT EXISTS idx_field_data_case_submissions_submission
    ON field_data_case_submissions ("submissionId")`);

  await db.raw(`CREATE TABLE IF NOT EXISTS field_data_assignments (
    id SERIAL PRIMARY KEY,
    "caseId" INTEGER REFERENCES field_data_cases (id) ON DELETE CASCADE,
    "actorId" INTEGER NOT NULL,
    form VARCHAR(255),
    note TEXT,
    "dueDate" DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'assigned',
    "createdAt" TIMESTAMP DEFAULT clock_timestamp(),
    "completedAt" TIMESTAMP
  )`);
  await db.raw(`CREATE INDEX IF NOT EXISTS idx_field_data_assignments_actor
    ON field_data_assignments ("actorId")`);
  await db.raw(`CREATE INDEX IF NOT EXISTS idx_field_data_assignments_case
    ON field_data_assignments ("caseId")`);
};

const down = async (db) => {
  await db.raw('DROP TABLE IF EXISTS field_data_assignments');
  await db.raw('DROP TABLE IF EXISTS field_data_case_submissions');
  await db.raw('DROP TABLE IF EXISTS field_data_cases');
};

module.exports = { up, down };
