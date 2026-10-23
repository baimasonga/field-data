// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const up = async db => db.raw('ALTER TABLE field_data_backcheck_schedules ADD COLUMN IF NOT EXISTS "groupField" TEXT');
// Retain configured grouping on rollback instead of silently changing its sampling design.
const down = async db => db.raw(`DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM field_data_backcheck_schedules WHERE "groupField" IS NOT NULL) THEN
    ALTER TABLE field_data_backcheck_schedules DROP COLUMN "groupField";
  END IF;
END $$`);
module.exports = { up, down };
