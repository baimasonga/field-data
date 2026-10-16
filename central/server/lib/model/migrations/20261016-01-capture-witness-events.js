// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const up = async db => db.raw(`CREATE TABLE IF NOT EXISTS field_data_capture_witness_events (
 id UUID PRIMARY KEY, "witnessRecordId" UUID NOT NULL REFERENCES field_data_capture_witnesses(id) ON DELETE CASCADE,
 sequence INTEGER NOT NULL CHECK (sequence BETWEEN 1 AND 21), action TEXT NOT NULL CHECK (action IN ('correct', 'withdraw')),
 "actorId" INTEGER REFERENCES actors(id) ON DELETE SET NULL, "actorName" TEXT NOT NULL,
 "requestId" UUID NOT NULL, "requestHash" TEXT NOT NULL,
 payload TEXT NOT NULL CHECK (length(payload) <= 24000), "publicKey" JSONB NOT NULL, signature TEXT NOT NULL,
 "receivedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE ("witnessRecordId", sequence), UNIQUE ("witnessRecordId", "requestId"),
 CHECK (action = 'withdraw' OR sequence <= 20)
);
CREATE OR REPLACE FUNCTION field_data_guard_capture_witness() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
   IF NOT EXISTS (SELECT 1 FROM field_data_capture_challenges WHERE id = OLD."challengeId") THEN RETURN OLD; END IF;
 ELSE
   IF NEW."witnessId" IS NULL AND NOT EXISTS (SELECT 1 FROM actors WHERE id = OLD."witnessId")
      AND to_jsonb(NEW) - 'witnessId' = to_jsonb(OLD) - 'witnessId' THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'Capture witness statements are immutable' USING ERRCODE = '23514';
END $$;
DROP TRIGGER IF EXISTS field_data_capture_witness_guard ON field_data_capture_witnesses;
CREATE TRIGGER field_data_capture_witness_guard BEFORE UPDATE OR DELETE ON field_data_capture_witnesses
 FOR EACH ROW EXECUTE FUNCTION field_data_guard_capture_witness();
CREATE OR REPLACE FUNCTION field_data_guard_capture_witness_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
   IF NOT EXISTS (SELECT 1 FROM field_data_capture_witnesses WHERE id = OLD."witnessRecordId") THEN RETURN OLD; END IF;
 ELSE
   IF NEW."actorId" IS NULL AND NOT EXISTS (SELECT 1 FROM actors WHERE id = OLD."actorId")
      AND to_jsonb(NEW) - 'actorId' = to_jsonb(OLD) - 'actorId' THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'Capture witness changes are append-only' USING ERRCODE = '23514';
END $$;
DROP TRIGGER IF EXISTS field_data_capture_witness_event_guard ON field_data_capture_witness_events;
CREATE TRIGGER field_data_capture_witness_event_guard BEFORE UPDATE OR DELETE ON field_data_capture_witness_events
 FOR EACH ROW EXECUTE FUNCTION field_data_guard_capture_witness_event();`);
// Keep signed correction/withdrawal history once any change has been recorded.
const down = async db => db.raw(`DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM field_data_capture_witness_events) THEN
   DROP TABLE field_data_capture_witness_events;
   DROP FUNCTION field_data_guard_capture_witness_event();
   DROP TRIGGER field_data_capture_witness_guard ON field_data_capture_witnesses;
   DROP FUNCTION field_data_guard_capture_witness();
 END IF;
END $$`);
module.exports = { up, down };
