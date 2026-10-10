// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

// G1b imagery availability (docs/field-intelligence/G1b-imagery-availability.md).
// A cache of catalogue answers by grid cell and visit day: which scenes cover
// the cell in the window around that day. It holds no submission data: the
// cell is a 0.05° grid centre and the day is a whole day. Failed lookups are
// not stored.
const up = async (db) => {
  await db.raw(`CREATE TABLE field_data_imagery_lookups (
    id SERIAL PRIMARY KEY,
    catalogue TEXT NOT NULL,
    collection TEXT NOT NULL,
    "cellKey" TEXT NOT NULL,
    "visitDay" DATE NOT NULL,
    "windowDays" INTEGER NOT NULL CHECK ("windowDays" > 0),
    scenes JSONB NOT NULL CHECK (jsonb_typeof(scenes) = 'array'),
    matched INTEGER,
    "fetchedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (catalogue, collection, "cellKey", "visitDay", "windowDays")
  )`);
};

const down = async (db) => {
  await db.raw('DROP TABLE IF EXISTS field_data_imagery_lookups');
};

module.exports = { up, down };
