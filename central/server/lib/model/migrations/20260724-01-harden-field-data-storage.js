// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

const up = async (db) => {
  await db.raw(`ALTER TABLE field_data_media
    ADD COLUMN IF NOT EXISTS "sizeBytes" BIGINT,
    ADD COLUMN IF NOT EXISTS "mimeType" VARCHAR(255),
    ADD COLUMN IF NOT EXISTS "storageKey" VARCHAR(500)`);
  await db.raw(`ALTER TABLE field_data_backups
    ADD COLUMN IF NOT EXISTS "sizeBytes" BIGINT,
    ADD COLUMN IF NOT EXISTS "storageKey" VARCHAR(500),
    ADD COLUMN IF NOT EXISTS error TEXT,
    ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP`);
  await db.raw(`CREATE INDEX IF NOT EXISTS idx_field_data_webhook_deliveries_created_at
    ON field_data_webhook_deliveries ("createdAt")`);
  await db.raw(`ALTER TABLE field_data_webhook_deliveries
    ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 1`);
};

const down = async (db) => {
  await db.raw('DROP INDEX IF EXISTS idx_field_data_webhook_deliveries_created_at');
  await db.raw('ALTER TABLE field_data_webhook_deliveries DROP COLUMN IF EXISTS attempts');
  await db.raw(`ALTER TABLE field_data_backups
    DROP COLUMN IF EXISTS "completedAt",
    DROP COLUMN IF EXISTS error,
    DROP COLUMN IF EXISTS "storageKey",
    DROP COLUMN IF EXISTS "sizeBytes"`);
  await db.raw(`ALTER TABLE field_data_media
    DROP COLUMN IF EXISTS "storageKey",
    DROP COLUMN IF EXISTS "mimeType",
    DROP COLUMN IF EXISTS "sizeBytes"`);
};

module.exports = { up, down };
