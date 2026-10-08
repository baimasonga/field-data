// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const up = db => db.raw(`CREATE TABLE field_data_public_releases (
 id UUID PRIMARY KEY, "projectId" INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 "formId" INTEGER NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
 "createdBy" INTEGER NOT NULL REFERENCES actors(id), metadata JSONB NOT NULL, release JSONB NOT NULL,
 published BOOLEAN NOT NULL DEFAULT FALSE, "publishedAt" TIMESTAMPTZ, "revokedAt" TIMESTAMPTZ
); CREATE TABLE field_data_public_release_audits (
 id BIGSERIAL PRIMARY KEY, "releaseId" UUID NOT NULL, "actorId" INTEGER NOT NULL REFERENCES actors(id), action TEXT NOT NULL,
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
); CREATE INDEX ON field_data_public_releases (published, "publishedAt");`);
const down = async () => {};
module.exports = { up, down };
