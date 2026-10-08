// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const up = async (db) => {
  await db.raw(`CREATE TABLE field_data_analysis_views (
    id UUID PRIMARY KEY, "projectId" INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    "createdBy" INTEGER NOT NULL REFERENCES actors(id), title VARCHAR(255) NOT NULL,
    definition JSONB NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
  ); CREATE INDEX ON field_data_analysis_views ("projectId", "createdBy");`);
};
// Saved work is retained on rollback. Older application versions simply ignore it.
const down = async () => {};
module.exports = { up, down };
