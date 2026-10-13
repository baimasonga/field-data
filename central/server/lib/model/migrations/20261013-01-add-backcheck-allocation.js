// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const up = async (db) => {
  await db.raw(`CREATE TABLE IF NOT EXISTS field_data_backcheck_allocation (
    "formId" INTEGER PRIMARY KEY REFERENCES forms(id) ON DELETE CASCADE,
    "responseFormId" INTEGER REFERENCES forms(id) ON DELETE SET NULL,
    enabled BOOLEAN NOT NULL,
    settings JSONB NOT NULL,
    "configuredBy" INTEGER REFERENCES actors(id) ON DELETE SET NULL,
    "lastCaseId" UUID,
    report JSONB,
    "lastAttemptAt" TIMESTAMPTZ,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
  )`);
};
const down = async (db) => {
  await db.raw(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM field_data_backcheck_allocation) THEN DROP TABLE field_data_backcheck_allocation; END IF;
  END $$`);
};
module.exports = { up, down };
