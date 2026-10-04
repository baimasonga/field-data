// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const up = async db => db.raw(`ALTER TABLE field_data_analysis_views ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'project'));`);
const down = async () => {};
module.exports = { up, down };
