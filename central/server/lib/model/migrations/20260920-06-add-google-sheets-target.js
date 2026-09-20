// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// The target constraint is the last defence against a service definition this
// build cannot deliver. Google OAuth credentials live inside config, encrypted
// with FIELD_DATA_WEBHOOK_ENCRYPTION_KEY by the application before insertion.

const up = async (db) => {
  await db.raw(`ALTER TABLE field_data_webhooks
    DROP CONSTRAINT IF EXISTS field_data_webhooks_target`);
  await db.raw(`ALTER TABLE field_data_webhooks
    ADD CONSTRAINT field_data_webhooks_target
    CHECK (target IN ('json', 'xml', 'google-sheets'))`);
};

const down = async (db) => {
  await db.raw(`DELETE FROM field_data_webhooks WHERE target = 'google-sheets'`);
  await db.raw(`ALTER TABLE field_data_webhooks
    DROP CONSTRAINT IF EXISTS field_data_webhooks_target`);
  await db.raw(`ALTER TABLE field_data_webhooks
    ADD CONSTRAINT field_data_webhooks_target CHECK (target IN ('json', 'xml'))`);
};

module.exports = { up, down };
