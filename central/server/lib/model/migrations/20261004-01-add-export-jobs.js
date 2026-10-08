// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const up = db => db.raw(`
  CREATE TABLE field_data_export_jobs (
    id UUID PRIMARY KEY, "projectId" INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    "createdBy" INTEGER NOT NULL REFERENCES actors(id), request JSONB NOT NULL, payload JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'Pending', total INTEGER NOT NULL DEFAULT 0, completed INTEGER NOT NULL DEFAULT 0,
    error TEXT, "storageKey" TEXT, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    "expiresAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp() + interval '24 hours'
  );
  CREATE TABLE field_data_export_rows (
    id BIGSERIAL PRIMARY KEY, "jobId" UUID NOT NULL REFERENCES field_data_export_jobs(id) ON DELETE CASCADE,
    row JSONB NOT NULL
  );
  CREATE INDEX ON field_data_export_rows ("jobId", id);
  CREATE INDEX ON field_data_export_jobs ("createdBy", "projectId");
  CREATE FUNCTION queue_export_cleanup() RETURNS trigger AS $$
  BEGIN
    IF OLD."storageKey" IS NOT NULL THEN
      INSERT INTO field_data_storage_cleanup (key) VALUES (OLD."storageKey") ON CONFLICT DO NOTHING;
    END IF;
    RETURN OLD;
  END; $$ LANGUAGE plpgsql;
  CREATE TRIGGER export_cleanup BEFORE DELETE ON field_data_export_jobs FOR EACH ROW EXECUTE FUNCTION queue_export_cleanup();
`);
const down = async () => {};
module.exports = { up, down };
