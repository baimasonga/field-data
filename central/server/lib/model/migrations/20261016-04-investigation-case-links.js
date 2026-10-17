// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const up = async db => db.raw(`CREATE TABLE IF NOT EXISTS field_data_investigation_case_events (
 id UUID PRIMARY KEY, "investigationId" UUID NOT NULL REFERENCES field_data_investigations(id) ON DELETE CASCADE,
 sequence INTEGER NOT NULL CHECK (sequence BETWEEN 1 AND 500), "investigationRevision" INTEGER NOT NULL,
 action TEXT NOT NULL CHECK (action IN ('linked','removed')), "linkId" UUID NOT NULL, "caseId" UUID NOT NULL,
 "claimVersionId" UUID NOT NULL, "requestId" UUID NOT NULL, "requestHash" TEXT NOT NULL,
 reason TEXT NOT NULL CHECK (length(reason) BETWEEN 10 AND 2000),
 "actorId" INTEGER REFERENCES actors(id) ON DELETE SET NULL, "actorName" TEXT NOT NULL,
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE ("investigationId", sequence), UNIQUE ("investigationId", "requestId"),
 CHECK ((action = 'linked') = (id = "linkId"))
);
CREATE INDEX IF NOT EXISTS field_data_investigation_cases ON field_data_investigation_case_events ("investigationId", "caseId", sequence DESC);
CREATE OR REPLACE FUNCTION field_data_guard_investigation_case_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
   IF NOT EXISTS (SELECT 1 FROM field_data_investigations WHERE id = OLD."investigationId") THEN RETURN OLD; END IF;
 ELSE
   IF NEW."actorId" IS NULL AND NOT EXISTS (SELECT 1 FROM actors WHERE id = OLD."actorId")
      AND to_jsonb(NEW) - 'actorId' = to_jsonb(OLD) - 'actorId' THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'Investigation case links are append-only' USING ERRCODE = '23514';
END $$;
DROP TRIGGER IF EXISTS field_data_investigation_case_event_guard ON field_data_investigation_case_events;
CREATE TRIGGER field_data_investigation_case_event_guard BEFORE UPDATE OR DELETE ON field_data_investigation_case_events
 FOR EACH ROW EXECUTE FUNCTION field_data_guard_investigation_case_event();`);
const down = async db => db.raw(`DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM field_data_investigation_case_events) THEN
   DROP TABLE field_data_investigation_case_events; DROP FUNCTION field_data_guard_investigation_case_event();
 END IF;
END $$`);
module.exports = { up, down };
