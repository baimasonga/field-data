// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// A shared dashboard is a read-only link to one form's summary that works
// without an account. The token is the credential, so it is stored hashed:
// somebody who reads this table cannot use what they find there, and the only
// copy of the usable token is the one handed to whoever created the link.
//
// Only counts are ever served through a share. Nothing here reaches an
// individual submission, an attachment or a submitter's name.

const up = async (db) => {
  await db.raw(`CREATE TABLE IF NOT EXISTS field_data_dashboards (
    id SERIAL PRIMARY KEY,
    "tokenSha" TEXT NOT NULL UNIQUE,
    "tokenHint" VARCHAR(12) NOT NULL,
    name VARCHAR(255) NOT NULL,
    "projectId" INTEGER NOT NULL REFERENCES projects(id),
    "formId" INTEGER NOT NULL REFERENCES forms(id),
    "createdBy" INTEGER REFERENCES actors(id),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    "expiresAt" TIMESTAMPTZ,
    "revokedAt" TIMESTAMPTZ,
    "lastViewedAt" TIMESTAMPTZ,
    views INTEGER NOT NULL DEFAULT 0
  )`);

  await db.raw(`CREATE INDEX IF NOT EXISTS field_data_dashboards_form
    ON field_data_dashboards ("formId")`);
};

const down = async (db) => {
  await db.raw('DROP TABLE IF EXISTS field_data_dashboards');
};

module.exports = { up, down };
