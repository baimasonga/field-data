// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const up = async db => db.raw(`CREATE TABLE IF NOT EXISTS field_data_sensor_keys (
 id UUID PRIMARY KEY, sequence SERIAL UNIQUE, "projectId" INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 "deviceId" UUID NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('enroll','revoke')), "requestId" UUID NOT NULL,
 "requestHash" TEXT NOT NULL, details JSONB NOT NULL, attestation JSONB NOT NULL,
 UNIQUE("projectId","requestId"), UNIQUE("deviceId",kind)
);
CREATE UNIQUE INDEX IF NOT EXISTS field_data_sensor_key_material ON field_data_sensor_keys("projectId",(details->>'keyHash')) WHERE kind='enroll';
CREATE TABLE IF NOT EXISTS field_data_sensor_readings (
 id UUID PRIMARY KEY, "projectId" INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 "challengeId" UUID NOT NULL REFERENCES field_data_capture_challenges(id) ON DELETE CASCADE,
 "deviceId" UUID NOT NULL, "readingId" UUID NOT NULL, counter INTEGER NOT NULL CHECK(counter>0),
 "requestId" UUID NOT NULL, "requestHash" TEXT NOT NULL, "sampledAt" TIMESTAMPTZ NOT NULL, measurement JSONB NOT NULL, envelope JSONB NOT NULL, receipt JSONB NOT NULL,
 "receivedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), UNIQUE("projectId","requestId"), UNIQUE("deviceId","readingId"), UNIQUE("deviceId",counter)
);
CREATE TABLE IF NOT EXISTS field_data_sensor_replays (
 id UUID PRIMARY KEY, "projectId" INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, "deviceId" UUID NOT NULL,
 "readingId" UUID NOT NULL, counter INTEGER NOT NULL, "payloadHash" TEXT NOT NULL, UNIQUE("deviceId","readingId"), UNIQUE("deviceId",counter)
);
CREATE TABLE IF NOT EXISTS field_data_sensor_reviews (
 id UUID PRIMARY KEY, "projectId" INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 "readingRecordId" UUID NOT NULL REFERENCES field_data_sensor_readings(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL, "requestId" UUID NOT NULL, "requestHash" TEXT NOT NULL, details JSONB NOT NULL, attestation JSONB NOT NULL,
 UNIQUE("readingRecordId",revision), UNIQUE("projectId","requestId")
);
CREATE OR REPLACE FUNCTION field_data_guard_sensor_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN
  IF NOT EXISTS(SELECT 1 FROM projects WHERE id=OLD."projectId") THEN RETURN OLD; END IF;
  IF TG_TABLE_NAME='field_data_sensor_readings' THEN
   IF NOT EXISTS(SELECT 1 FROM field_data_capture_challenges WHERE id=OLD."challengeId") THEN RETURN OLD; END IF;
  ELSIF TG_TABLE_NAME='field_data_sensor_reviews' THEN
   IF NOT EXISTS(SELECT 1 FROM field_data_sensor_readings WHERE id=OLD."readingRecordId") THEN RETURN OLD; END IF;
  END IF;
 END IF;
 RAISE EXCEPTION 'Sensor records are append-only' USING ERRCODE='23514'; END $$;
DROP TRIGGER IF EXISTS field_data_sensor_replay_guard ON field_data_sensor_replays;
CREATE TRIGGER field_data_sensor_replay_guard BEFORE UPDATE OR DELETE ON field_data_sensor_replays FOR EACH ROW EXECUTE FUNCTION field_data_guard_sensor_ledger();
DROP TRIGGER IF EXISTS field_data_sensor_key_guard ON field_data_sensor_keys;
CREATE TRIGGER field_data_sensor_key_guard BEFORE UPDATE OR DELETE ON field_data_sensor_keys FOR EACH ROW EXECUTE FUNCTION field_data_guard_sensor_ledger();
DROP TRIGGER IF EXISTS field_data_sensor_reading_guard ON field_data_sensor_readings;
CREATE TRIGGER field_data_sensor_reading_guard BEFORE UPDATE OR DELETE ON field_data_sensor_readings FOR EACH ROW EXECUTE FUNCTION field_data_guard_sensor_ledger();
DROP TRIGGER IF EXISTS field_data_sensor_review_guard ON field_data_sensor_reviews;
CREATE TRIGGER field_data_sensor_review_guard BEFORE UPDATE OR DELETE ON field_data_sensor_reviews FOR EACH ROW EXECUTE FUNCTION field_data_guard_sensor_ledger();`);
const down = async db => db.raw(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM field_data_sensor_keys) AND NOT EXISTS(SELECT 1 FROM field_data_sensor_readings) AND NOT EXISTS(SELECT 1 FROM field_data_sensor_replays) THEN
 DROP TABLE field_data_sensor_reviews; DROP TABLE field_data_sensor_readings; DROP TABLE field_data_sensor_keys; DROP TABLE field_data_sensor_replays; DROP FUNCTION field_data_guard_sensor_ledger(); END IF; END $$`);
module.exports = { up, down };
