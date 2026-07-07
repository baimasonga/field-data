// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// Creates the tables backing the Field Data platform resources: the media
// library, outbound webhooks, and manual backup history. These are created via
// a migration (run on startup by run-migrations) rather than at resource
// registration time, where no database container is available.

const up = async (db) => {
  await db.raw(`CREATE TABLE IF NOT EXISTS field_data_media (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL,
    size VARCHAR(50) NOT NULL,
    "createdAt" TIMESTAMP DEFAULT clock_timestamp()
  )`);

  await db.raw(`CREATE TABLE IF NOT EXISTS field_data_webhooks (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    url VARCHAR(255) NOT NULL,
    events JSONB NOT NULL,
    active BOOLEAN DEFAULT TRUE,
    "lastStatus" VARCHAR(50) DEFAULT 'Pending',
    "createdAt" TIMESTAMP DEFAULT clock_timestamp()
  )`);

  await db.raw(`CREATE TABLE IF NOT EXISTS field_data_backups (
    id SERIAL PRIMARY KEY,
    date TIMESTAMP DEFAULT clock_timestamp(),
    type VARCHAR(50) NOT NULL,
    size VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL,
    "statusColor" VARCHAR(50) NOT NULL
  )`);
};

const down = async (db) => {
  await db.raw('DROP TABLE IF EXISTS field_data_backups');
  await db.raw('DROP TABLE IF EXISTS field_data_webhooks');
  await db.raw('DROP TABLE IF EXISTS field_data_media');
};

module.exports = { up, down };
