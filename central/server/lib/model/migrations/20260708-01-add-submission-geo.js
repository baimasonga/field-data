// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// Maps a submission to a Sierra Leone district, backing the dashboard's
// "Submissions by Location" map. Populated when a submission carries district
// information (e.g. a `district` field); the demo seed populates it directly.

const up = async (db) => {
  await db.raw(`CREATE TABLE IF NOT EXISTS field_data_submission_geo (
    "submissionId" INTEGER PRIMARY KEY REFERENCES submissions (id) ON DELETE CASCADE,
    district VARCHAR(80) NOT NULL
  )`);
  await db.raw(`CREATE INDEX IF NOT EXISTS idx_field_data_submission_geo_district
    ON field_data_submission_geo (district)`);
};

const down = async (db) => {
  await db.raw('DROP TABLE IF EXISTS field_data_submission_geo');
};

module.exports = { up, down };
