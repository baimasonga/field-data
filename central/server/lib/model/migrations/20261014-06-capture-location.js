// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const up = async db => db.raw(`ALTER TABLE field_data_capture_challenges ADD COLUMN IF NOT EXISTS "captureLocation" JSONB;`);
const down = async db => db.raw(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM field_data_capture_challenges WHERE "captureLocation" IS NOT NULL) THEN
 ALTER TABLE field_data_capture_challenges DROP COLUMN "captureLocation"; END IF; END $$`);
module.exports = { up, down };
