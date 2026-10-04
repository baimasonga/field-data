// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const up = async db => db.raw(`ALTER TABLE field_data_map_layers ALTER COLUMN "storageKey" DROP NOT NULL; ALTER TABLE field_data_map_layers ADD COLUMN "remoteConfig" TEXT;
CREATE OR REPLACE FUNCTION field_data_enqueue_layer_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."storageKey" IS NOT NULL AND (TG_OP = 'DELETE' OR OLD."storageKey" IS DISTINCT FROM NEW."storageKey") THEN
    EXECUTE format('INSERT INTO %I.field_data_storage_cleanup (key) VALUES ($1) ON CONFLICT DO NOTHING', TG_TABLE_SCHEMA) USING OLD."storageKey";
  END IF;
  RETURN OLD;
END;
$$;`);
const down = async () => {};
module.exports = { up, down };
