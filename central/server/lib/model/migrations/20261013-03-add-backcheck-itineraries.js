// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const up = async db => db.raw(`CREATE TABLE IF NOT EXISTS field_data_backcheck_itineraries (
  id UUID PRIMARY KEY, "projectId" INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  "actorId" INTEGER NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
  "visitDate" DATE NOT NULL, snapshot JSONB NOT NULL, note TEXT NOT NULL,
  "approvedBy" INTEGER REFERENCES actors(id) ON DELETE SET NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS field_data_backcheck_itineraries_actor_day
  ON field_data_backcheck_itineraries ("actorId", "visitDate", "createdAt" DESC)`);
const down = async db => db.raw(`DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM field_data_backcheck_itineraries) THEN DROP TABLE field_data_backcheck_itineraries; END IF;
END $$`);
module.exports = { up, down };
