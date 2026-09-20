// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// A filtered dataset is a saved, read-only projection of one published form:
// selected field paths plus a deliberately small row-filter expression. The
// destination project is separate from the source form so a partner can be
// granted access to the subset without being granted access to the whole form.
//
// Paths and filter definitions are stored as JSONB because form fields are XML
// paths rather than database columns. Every value is validated against the
// current form definition again before it is used.

const up = async (db) => {
  await db.raw(`CREATE TABLE IF NOT EXISTS field_data_filtered_datasets (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    "projectId" INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    "formId" INTEGER NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
    columns JSONB NOT NULL,
    query JSONB NOT NULL DEFAULT '[]'::jsonb,
    "createdBy" INTEGER REFERENCES actors(id),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT field_data_filtered_datasets_columns_array
      CHECK (jsonb_typeof(columns) = 'array' AND jsonb_array_length(columns) > 0),
    CONSTRAINT field_data_filtered_datasets_query_array
      CHECK (jsonb_typeof(query) = 'array'),
    CONSTRAINT field_data_filtered_datasets_name_unique
      UNIQUE ("projectId", name)
  )`);

  await db.raw(`CREATE INDEX IF NOT EXISTS field_data_filtered_datasets_project
    ON field_data_filtered_datasets ("projectId")`);
  await db.raw(`CREATE INDEX IF NOT EXISTS field_data_filtered_datasets_form
    ON field_data_filtered_datasets ("formId")`);
  await db.raw(`CREATE INDEX IF NOT EXISTS field_data_filtered_datasets_creator
    ON field_data_filtered_datasets ("createdBy")`);
};

const down = async (db) => {
  await db.raw('DROP TABLE IF EXISTS field_data_filtered_datasets');
};

module.exports = { up, down };
