// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// A merged dataset exposes the fields several forms genuinely have in common
// as one read-only table. A programme that ran the same questionnaire in
// three rounds, or handed it to four partners, has several forms and one
// question about all of them.
//
// Two things are deliberately absent.
//
// There is no stored field list. Which fields are shared depends on the
// forms' current published definitions, and forms get republished. A cached
// list that does not know this does not go missing; it goes stale and starts
// lying, which is worse. The intersection is computed on every read.
//
// There is nothing here that could make the merge writable. A row belongs to
// one of the source forms, and editing it "through" the merge would mean
// deciding whose validation applies and what the audit log should say. Both
// the routes and the absence of any submission column here say the same
// thing: this is a way to read, and only to read.

const up = async (db) => {
  await db.raw(`CREATE TABLE IF NOT EXISTS field_data_merged_datasets (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    "projectId" INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    "createdBy" INTEGER REFERENCES actors(id),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT field_data_merged_datasets_name_unique UNIQUE ("projectId", name)
  )`);

  await db.raw(`CREATE TABLE IF NOT EXISTS field_data_merged_dataset_forms (
    "mergedDatasetId" INTEGER NOT NULL
      REFERENCES field_data_merged_datasets(id) ON DELETE CASCADE,
    "formId" INTEGER NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
    PRIMARY KEY ("mergedDatasetId", "formId")
  )`);

  await db.raw(`CREATE INDEX IF NOT EXISTS field_data_merged_dataset_forms_form
    ON field_data_merged_dataset_forms ("formId")`);
  await db.raw(`CREATE INDEX IF NOT EXISTS field_data_merged_datasets_project
    ON field_data_merged_datasets ("projectId")`);
  await db.raw(`CREATE INDEX IF NOT EXISTS field_data_merged_datasets_creator
    ON field_data_merged_datasets ("createdBy")`);
};

const down = async (db) => {
  await db.raw('DROP TABLE IF EXISTS field_data_merged_dataset_forms');
  await db.raw('DROP TABLE IF EXISTS field_data_merged_datasets');
};

module.exports = { up, down };
