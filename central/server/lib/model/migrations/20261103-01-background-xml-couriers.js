// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const up = async db => db.raw(`ALTER TABLE field_data_xml_background ADD COLUMN IF NOT EXISTS "senderId" INTEGER;
ALTER TABLE field_data_xml_background ADD COLUMN IF NOT EXISTS "courierGrantId" UUID REFERENCES field_data_xml_couriers(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS field_data_xml_background_sender ON field_data_xml_background("senderId");`);
const down = async db => db.raw(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM field_data_xml_background WHERE "courierGrantId" IS NOT NULL) THEN
 ALTER TABLE field_data_xml_background DROP COLUMN "courierGrantId", DROP COLUMN "senderId"; END IF; END $$`);
module.exports = { up, down };
