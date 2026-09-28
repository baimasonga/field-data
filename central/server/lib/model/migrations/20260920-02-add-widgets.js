// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// A widget is a chart somebody kept. The Summary tab computes charts fresh,
// shows them once and forgets them; a widget has a title its author chose, a
// place in an order, and a parent it belongs to.
//
// A widget hangs off a form or off a filtered dataset, never both and never
// neither. The distinction matters for more than tidiness: a widget over a
// filtered dataset must only ever read that dataset's visible columns, so
// which parent it has decides what it is allowed to see. The check is a
// database constraint rather than a comment because a widget with both
// parents set would be a chart with two different answers to "what may this
// show".

const up = async (db) => {
  await db.raw(`CREATE TABLE IF NOT EXISTS field_data_widgets (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,

    "formId" INTEGER REFERENCES forms(id) ON DELETE CASCADE,
    "filteredDatasetId" INTEGER
      REFERENCES field_data_filtered_datasets(id) ON DELETE CASCADE,

    -- The field being charted, as an XML path. Validated against the parent's
    -- fields on every read and write, never trusted from storage alone.
    column_path TEXT NOT NULL,
    -- Optional second path to group by. Aggregating a number per district is
    -- the case this exists for.
    "groupBy" TEXT,
    aggregation TEXT NOT NULL,
    "viewType" TEXT NOT NULL,

    -- Contiguous from 0 within each parent, renumbered on insert and delete.
    -- Gaps would make every later reordering feature cope with them.
    "order" INTEGER NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    "createdBy" INTEGER REFERENCES actors(id),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT field_data_widgets_one_parent CHECK (
      ("formId" IS NULL) <> ("filteredDatasetId" IS NULL)),
    CONSTRAINT field_data_widgets_aggregation CHECK (
      aggregation IN ('count', 'sum', 'mean', 'median')),
    CONSTRAINT field_data_widgets_view_type CHECK (
      "viewType" IN ('bar', 'table')),
    -- Grouping a field by itself charts nothing.
    CONSTRAINT field_data_widgets_group_differs CHECK (
      "groupBy" IS NULL OR "groupBy" <> column_path)
  )`);

  await db.raw(`CREATE INDEX IF NOT EXISTS field_data_widgets_form
    ON field_data_widgets ("formId", "order")`);
  await db.raw(`CREATE INDEX IF NOT EXISTS field_data_widgets_dataset
    ON field_data_widgets ("filteredDatasetId", "order")`);
  await db.raw(`CREATE INDEX IF NOT EXISTS field_data_widgets_creator
    ON field_data_widgets ("createdBy")`);
};

const down = async (db) => {
  await db.raw('DROP TABLE IF EXISTS field_data_widgets');
};

module.exports = { up, down };
