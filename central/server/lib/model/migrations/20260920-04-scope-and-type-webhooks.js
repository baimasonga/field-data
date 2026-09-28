// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// Webhooks were site-wide and untyped: every row was assumed to be a URL that
// would accept whatever JSON we happened to send. Two things follow from that
// and both are fixed here, before any new kind of target exists.
//
// "formId" scopes a service to one form. What people want is "sync this survey
// to that place", not "send everything everywhere", and a site-wide firehose
// is also the version most likely to leak one project's data to another
// project's integration.
//
// NULL "formId" deliberately keeps meaning "every form". Every row that
// existed before this migration gets it, so no running integration breaks on
// deploy. That is a decision, not an oversight -- the next person to read this
// column will wonder, so: null is the site-wide case and is still supported.
//
// "target" names how to build the outbound request; 'json' is what every
// existing row already did. "config" holds whatever that target needs beyond a
// URL, and is empty for the two that need nothing.

const up = async (db) => {
  await db.raw(`ALTER TABLE field_data_webhooks
    ADD COLUMN IF NOT EXISTS "formId" INTEGER REFERENCES forms(id) ON DELETE CASCADE`);
  await db.raw(`ALTER TABLE field_data_webhooks
    ADD COLUMN IF NOT EXISTS target TEXT NOT NULL DEFAULT 'json'`);
  await db.raw(`ALTER TABLE field_data_webhooks
    ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}'::jsonb`);

  await db.raw(`CREATE INDEX IF NOT EXISTS field_data_webhooks_form
    ON field_data_webhooks ("formId")`);

  // A target this build does not know how to dispatch would fail silently at
  // delivery time, which is the worst place to find out.
  await db.raw(`ALTER TABLE field_data_webhooks
    DROP CONSTRAINT IF EXISTS field_data_webhooks_target`);
  await db.raw(`ALTER TABLE field_data_webhooks
    ADD CONSTRAINT field_data_webhooks_target CHECK (target IN ('json', 'xml'))`);
};

const down = async (db) => {
  await db.raw('ALTER TABLE field_data_webhooks DROP CONSTRAINT IF EXISTS field_data_webhooks_target');
  await db.raw('ALTER TABLE field_data_webhooks DROP COLUMN IF EXISTS config');
  await db.raw('ALTER TABLE field_data_webhooks DROP COLUMN IF EXISTS target');
  await db.raw('ALTER TABLE field_data_webhooks DROP COLUMN IF EXISTS "formId"');
};

module.exports = { up, down };
