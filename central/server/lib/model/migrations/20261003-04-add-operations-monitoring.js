// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const up = db => db.raw(`CREATE TABLE field_data_operations_checks (
 name TEXT PRIMARY KEY, status TEXT NOT NULL, "latencyMs" INTEGER, detail TEXT NOT NULL,
 failures INTEGER NOT NULL DEFAULT 0, alert BOOLEAN NOT NULL DEFAULT FALSE,
 "checkedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
); CREATE TABLE field_data_operations_events (
 id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL,
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
); CREATE TABLE field_data_operations_policy (
 id INTEGER PRIMARY KEY CHECK (id=1), definition JSONB NOT NULL
); INSERT INTO field_data_operations_policy VALUES (1, '{"version":1,"scheduledBackups":false,"backupHour":1,"retentionDays":30,"failAfter":3,"staleHours":48}');
CREATE TABLE field_data_storage_cleanup (key TEXT PRIMARY KEY, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp());
CREATE FUNCTION field_data_enqueue_layer_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD."storageKey" IS DISTINCT FROM NEW."storageKey" THEN
    EXECUTE format('INSERT INTO %I.field_data_storage_cleanup (key) VALUES ($1) ON CONFLICT DO NOTHING', TG_TABLE_SCHEMA) USING OLD."storageKey";
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER field_data_layer_cleanup AFTER DELETE OR UPDATE OF "storageKey" ON field_data_map_layers FOR EACH ROW EXECUTE FUNCTION field_data_enqueue_layer_cleanup();`);
const down = async () => {};
module.exports = { up, down };
