// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const up = async db => db.raw(`CREATE TABLE IF NOT EXISTS field_data_knowledge_definitions (
 id UUID PRIMARY KEY, "projectId" INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 title TEXT NOT NULL, definition JSONB NOT NULL, revision INTEGER NOT NULL CHECK(revision>0), archived BOOLEAN NOT NULL DEFAULT FALSE,
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS field_data_knowledge_definitions_project ON field_data_knowledge_definitions("projectId");
CREATE TABLE IF NOT EXISTS field_data_knowledge_definition_events (
 id UUID PRIMARY KEY, "definitionId" UUID NOT NULL REFERENCES field_data_knowledge_definitions(id) ON DELETE CASCADE,
 "projectId" INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, revision INTEGER NOT NULL,
 "requestId" UUID NOT NULL, "requestHash" TEXT NOT NULL, "actorId" INTEGER NOT NULL, reason TEXT NOT NULL,
 snapshot JSONB NOT NULL, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE("projectId","requestId"), UNIQUE("definitionId",revision)
);
CREATE OR REPLACE FUNCTION field_data_guard_knowledge_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM projects WHERE id=OLD."projectId") THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Knowledge definition events are append-only' USING ERRCODE='23514'; END $$;
DROP TRIGGER IF EXISTS field_data_knowledge_event_guard ON field_data_knowledge_definition_events;
CREATE TRIGGER field_data_knowledge_event_guard BEFORE UPDATE OR DELETE ON field_data_knowledge_definition_events FOR EACH ROW EXECUTE FUNCTION field_data_guard_knowledge_event();`);
const down = async db => db.raw(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM field_data_knowledge_definition_events) THEN
 DROP TABLE field_data_knowledge_definition_events; DROP TABLE field_data_knowledge_definitions; DROP FUNCTION field_data_guard_knowledge_event(); END IF; END $$`);
module.exports = { up, down };
