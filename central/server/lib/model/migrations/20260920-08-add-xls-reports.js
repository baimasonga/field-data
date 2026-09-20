// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// XLS reports keep the uploaded template and each generated workbook in the
// configured object store. The database stores only ownership, source, status,
// and object keys. Exactly one source is required so a report cannot silently
// change meaning between requests.

const up = async (db) => {
  await db.raw(`CREATE TABLE IF NOT EXISTS field_data_xls_report_templates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    "projectId" INTEGER NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    "formId" INTEGER REFERENCES forms (id) ON DELETE CASCADE,
    "filteredDatasetId" INTEGER REFERENCES field_data_filtered_datasets (id) ON DELETE CASCADE,
    "mergedDatasetId" INTEGER REFERENCES field_data_merged_datasets (id) ON DELETE CASCADE,
    "storageKey" TEXT NOT NULL,
    filename TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    placeholders JSONB NOT NULL DEFAULT '[]',
    "createdBy" INTEGER REFERENCES actors (id) ON DELETE SET NULL,
    "createdAt" TIMESTAMP NOT NULL DEFAULT clock_timestamp(),
    "updatedAt" TIMESTAMP NOT NULL DEFAULT clock_timestamp(),
    CHECK (num_nonnulls("formId", "filteredDatasetId", "mergedDatasetId") = 1)
  )`);
  await db.raw(`CREATE INDEX IF NOT EXISTS field_data_xls_report_templates_project
    ON field_data_xls_report_templates ("projectId", "createdAt" DESC)`);

  await db.raw(`CREATE TABLE IF NOT EXISTS field_data_xls_report_runs (
    id BIGSERIAL PRIMARY KEY,
    "templateId" INTEGER NOT NULL REFERENCES field_data_xls_report_templates (id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'Pending'
      CHECK (status IN ('Pending', 'Running', 'Success', 'Failed', 'Cancelled')),
    "storageKey" TEXT,
    "sizeBytes" INTEGER,
    "rowCount" INTEGER,
    error TEXT,
    "requestedBy" INTEGER REFERENCES actors (id) ON DELETE SET NULL,
    "createdAt" TIMESTAMP NOT NULL DEFAULT clock_timestamp(),
    "startedAt" TIMESTAMP,
    "completedAt" TIMESTAMP
  )`);
  await db.raw(`CREATE UNIQUE INDEX IF NOT EXISTS field_data_xls_report_runs_active
    ON field_data_xls_report_runs ("templateId")
    WHERE status IN ('Pending', 'Running')`);
  await db.raw(`CREATE INDEX IF NOT EXISTS field_data_xls_report_runs_template
    ON field_data_xls_report_runs ("templateId", "createdAt" DESC)`);
};

const down = async (db) => {
  await db.raw('DROP TABLE IF EXISTS field_data_xls_report_runs');
  await db.raw('DROP TABLE IF EXISTS field_data_xls_report_templates');
};

module.exports = { up, down };
