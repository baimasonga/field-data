// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

const up = async (db) => {
  // down() retains cancellation history. Knex still marks the migration as
  // rolled back, so an upgrade must also accept the retained columns/constraint.
  await db.raw(`ALTER TABLE field_data_backchecks
    ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS "cancelledBy" INTEGER REFERENCES actors(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS "cancellationRequestId" UUID,
    ADD COLUMN IF NOT EXISTS "cancellationReason" TEXT
      CHECK (length(btrim("cancellationReason")) BETWEEN 1 AND 2000);
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint
        WHERE conrelid = 'field_data_backchecks'::regclass
          AND conname = 'field_data_backchecks_cancellation_complete') THEN
        ALTER TABLE field_data_backchecks
          ADD CONSTRAINT field_data_backchecks_cancellation_complete CHECK (
            ("cancelledAt" IS NULL AND "cancellationRequestId" IS NULL AND "cancellationReason" IS NULL)
            OR (status = 'cancelled' AND "cancelledAt" IS NOT NULL
              AND "cancellationRequestId" IS NOT NULL AND "cancellationReason" IS NOT NULL)
          );
      END IF;
    END $$`);
};

const down = async (db) => {
  // Cancellation history must survive rollback of the application.
  await db.raw(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM field_data_backchecks WHERE "cancelledAt" IS NOT NULL) THEN
      ALTER TABLE field_data_backchecks
        DROP CONSTRAINT field_data_backchecks_cancellation_complete,
        DROP COLUMN "cancelledAt", DROP COLUMN "cancelledBy",
        DROP COLUMN "cancellationRequestId", DROP COLUMN "cancellationReason";
    END IF;
  END $$`);
};
module.exports = { up, down };
