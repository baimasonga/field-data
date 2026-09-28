// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// Public share links: tokenized, revocable read-only access to the project
// report (aggregates only - no raw submission data or PII).

const up = async (db) => {
  await db.raw(`CREATE TABLE IF NOT EXISTS field_data_share_links (
    id SERIAL PRIMARY KEY,
    token VARCHAR(64) NOT NULL UNIQUE,
    label VARCHAR(255),
    "formIds" INTEGER[] NOT NULL DEFAULT '{}'::INTEGER[],
    "createdAt" TIMESTAMP DEFAULT clock_timestamp(),
    "revokedAt" TIMESTAMP
  )`);
  await db.raw(`ALTER TABLE field_data_share_links
    ADD COLUMN IF NOT EXISTS "formIds" INTEGER[] NOT NULL DEFAULT '{}'::INTEGER[]`);
};

const down = async (db) => {
  await db.raw('DROP TABLE IF EXISTS field_data_share_links');
};

module.exports = { up, down };
