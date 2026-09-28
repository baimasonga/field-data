// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// Adds latitude/longitude to the submission geo table so the Data Explorer can
// plot individual submissions as points (not just district aggregates).

const up = async (db) => {
  await db.raw('ALTER TABLE field_data_submission_geo ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION');
  await db.raw('ALTER TABLE field_data_submission_geo ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION');
};

const down = async (db) => {
  await db.raw('ALTER TABLE field_data_submission_geo DROP COLUMN IF EXISTS lat');
  await db.raw('ALTER TABLE field_data_submission_geo DROP COLUMN IF EXISTS lng');
};

module.exports = { up, down };
