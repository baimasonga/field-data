// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// What the browser form builder knew, kept so a Form can be reopened.
//
// The builder writes an XLSForm and hands it to the ordinary upload path, so
// the Form itself needs nothing here. But an XLSForm cannot be read back into
// the builder without guessing -- a spreadsheet says `select_one district`,
// not "this was question three, and these were its choices in this order" --
// and a builder that can only ever create is a builder somebody uses once.
//
// One row per Form, holding the latest definition. Editing and republishing
// replaces it, which matches how ODK versions a Form: the definition describes
// what the builder would show you now, not every version there has ever been.

const up = (db) => db.raw(`CREATE TABLE IF NOT EXISTS field_data_form_definitions (
  "formId" INTEGER PRIMARY KEY REFERENCES forms (id) ON DELETE CASCADE,
  -- The builder's own shape: title, formId, version, questions.
  definition JSONB NOT NULL,
  "updatedBy" INTEGER REFERENCES actors (id) ON DELETE SET NULL,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
)`);

const down = (db) => db.raw('DROP TABLE IF EXISTS field_data_form_definitions');

module.exports = { up, down };
