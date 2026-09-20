// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// Historical Sheet synchronization is deliberately a resumable background
// job. A browser request may disappear and a container may restart; neither is
// a reason to forget which Submissions were already sent.

const up = async (db) => {
  await db.raw(`CREATE TABLE IF NOT EXISTS field_data_google_sheet_syncs (
    id SERIAL PRIMARY KEY,
    "webhookId" INTEGER NOT NULL REFERENCES field_data_webhooks (id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'Pending'
      CHECK (status IN ('Pending', 'Running', 'Success', 'Partial', 'Failed', 'Cancelled')),
    total INTEGER NOT NULL DEFAULT 0,
    processed INTEGER NOT NULL DEFAULT 0,
    synced INTEGER NOT NULL DEFAULT 0,
    updated INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP NOT NULL DEFAULT clock_timestamp(),
    "startedAt" TIMESTAMP,
    "completedAt" TIMESTAMP
  )`);
  await db.raw(`CREATE UNIQUE INDEX IF NOT EXISTS field_data_google_sheet_syncs_active
    ON field_data_google_sheet_syncs ("webhookId")
    WHERE status IN ('Pending', 'Running')`);

  await db.raw(`CREATE TABLE IF NOT EXISTS field_data_google_sheet_sync_items (
    id BIGSERIAL PRIMARY KEY,
    "syncId" INTEGER NOT NULL REFERENCES field_data_google_sheet_syncs (id) ON DELETE CASCADE,
    "submissionId" INTEGER NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'Pending'
      CHECK (status IN ('Pending', 'Running', 'Synced', 'Updated', 'Failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    "completedAt" TIMESTAMP,
    UNIQUE ("syncId", "submissionId")
  )`);
  await db.raw(`CREATE INDEX IF NOT EXISTS field_data_google_sheet_sync_items_pending
    ON field_data_google_sheet_sync_items ("syncId", status, id)`);
};

const down = async (db) => {
  await db.raw('DROP TABLE IF EXISTS field_data_google_sheet_sync_items');
  await db.raw('DROP TABLE IF EXISTS field_data_google_sheet_syncs');
};

module.exports = { up, down };
