// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const up = async db => db.raw('ALTER TABLE field_data_backcheck_schedules ADD COLUMN IF NOT EXISTS "groupBreaks" JSONB');
// Retain configured boundaries instead of silently changing a sampling design.
const down = async db => db.raw(`DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM field_data_backcheck_schedules WHERE "groupBreaks" IS NOT NULL AND "groupBreaks" <> '[]'::jsonb) THEN
    ALTER TABLE field_data_backcheck_schedules DROP COLUMN "groupBreaks";
  END IF;
END $$`);
module.exports = { up, down };
