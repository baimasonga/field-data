// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// Adds per-webhook HMAC signing secrets and a delivery-history table for the
// Field Data webhooks feature. Existing webhooks (created before signing) keep
// a null secret and are delivered unsigned until updated.

const up = async (db) => {
  await db.raw('ALTER TABLE field_data_webhooks ADD COLUMN IF NOT EXISTS secret VARCHAR(255)');

  await db.raw(`CREATE TABLE IF NOT EXISTS field_data_webhook_deliveries (
    id SERIAL PRIMARY KEY,
    "webhookId" INTEGER NOT NULL REFERENCES field_data_webhooks (id) ON DELETE CASCADE,
    event VARCHAR(100) NOT NULL,
    "statusCode" INTEGER,
    success BOOLEAN NOT NULL DEFAULT FALSE,
    error TEXT,
    "createdAt" TIMESTAMP DEFAULT clock_timestamp()
  )`);

  await db.raw(`CREATE INDEX IF NOT EXISTS idx_fk_field_data_webhook_deliveries_webhookId
    ON field_data_webhook_deliveries ("webhookId")`);
};

const down = async (db) => {
  await db.raw('DROP TABLE IF EXISTS field_data_webhook_deliveries');
  await db.raw('ALTER TABLE field_data_webhooks DROP COLUMN IF EXISTS secret');
};

module.exports = { up, down };
