// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const up = async (db) => {
  await db.raw(`ALTER TABLE field_data_backchecks ADD COLUMN IF NOT EXISTS "seenAt" TIMESTAMPTZ;
    CREATE TABLE IF NOT EXISTS field_data_app_user_push (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "actorId" INTEGER NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
    );
    CREATE INDEX IF NOT EXISTS field_data_app_user_push_actor ON field_data_app_user_push ("actorId")`);
};
// Subscriptions and acknowledgments survive application rollback/reapply.
const down = async () => {};
module.exports = { up, down };
