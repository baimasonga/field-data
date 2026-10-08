// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const up = db => db.raw(`CREATE TABLE field_data_map_layers (
 id UUID PRIMARY KEY, "projectId" INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 "createdBy" INTEGER NOT NULL REFERENCES actors(id), title VARCHAR(255) NOT NULL,
 definition JSONB NOT NULL, "storageKey" TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0,
 revision INTEGER NOT NULL DEFAULT 1, "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
); CREATE INDEX ON field_data_map_layers ("projectId", position);`);
const down = async () => {};
module.exports = { up, down };
