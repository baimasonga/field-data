// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// DHIS2 credentials are stored inside config and encrypted by the target
// registry. The constraint keeps an unknown target from failing only after a
// real Submission tries to use it.

const up = async (db) => {
  await db.raw(`ALTER TABLE field_data_webhooks
    DROP CONSTRAINT IF EXISTS field_data_webhooks_target`);
  await db.raw(`ALTER TABLE field_data_webhooks
    ADD CONSTRAINT field_data_webhooks_target
    CHECK (target IN ('json', 'xml', 'google-sheets', 'dhis2'))`);
};

const down = async (db) => {
  await db.raw(`DELETE FROM field_data_webhooks WHERE target = 'dhis2'`);
  await db.raw(`ALTER TABLE field_data_webhooks
    DROP CONSTRAINT IF EXISTS field_data_webhooks_target`);
  await db.raw(`ALTER TABLE field_data_webhooks
    ADD CONSTRAINT field_data_webhooks_target
    CHECK (target IN ('json', 'xml', 'google-sheets'))`);
};

module.exports = { up, down };
