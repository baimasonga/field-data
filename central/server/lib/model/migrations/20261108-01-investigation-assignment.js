// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const up = async db => db.raw(`ALTER TABLE field_data_investigations
  ADD COLUMN IF NOT EXISTS "assignedTo" INTEGER REFERENCES actors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "dueDate" DATE;`);
const down = async db => db.raw(`DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM field_data_investigations WHERE "assignedTo" IS NOT NULL OR "dueDate" IS NOT NULL) THEN
    RAISE EXCEPTION 'Investigation assignments must be retained';
  END IF;
  ALTER TABLE field_data_investigations DROP COLUMN IF EXISTS "dueDate", DROP COLUMN IF EXISTS "assignedTo";
END $$;`);
module.exports = { up, down };
