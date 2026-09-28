// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

const up = async (db) => {
  await db.raw(`ALTER TABLE field_data_idempotency_records
    DROP CONSTRAINT "field_data_idempotency_records_operationType_check",
    ADD CONSTRAINT "field_data_idempotency_records_operationType_check"
      CHECK ("operationType" IN ('evidence.link.create', 'review.case.assign')),
    DROP CONSTRAINT field_data_idempotency_records_check,
    ADD CONSTRAINT field_data_idempotency_records_check
      CHECK ((status = 'in-progress' AND "completedAt" IS NULL AND "resourceId" IS NULL)
        OR (status = 'succeeded' AND "completedAt" IS NOT NULL
          AND "resourceId" IS NOT NULL AND "responseStatus" IN (200, 201)))`);
};

const down = async (db) => {
  await db.raw(`DELETE FROM field_data_idempotency_records
    WHERE "operationType" = 'review.case.assign'`);
  await db.raw(`ALTER TABLE field_data_idempotency_records
    DROP CONSTRAINT "field_data_idempotency_records_operationType_check",
    ADD CONSTRAINT "field_data_idempotency_records_operationType_check"
      CHECK ("operationType" = 'evidence.link.create'),
    DROP CONSTRAINT field_data_idempotency_records_check,
    ADD CONSTRAINT field_data_idempotency_records_check
      CHECK ((status = 'in-progress' AND "completedAt" IS NULL AND "resourceId" IS NULL)
        OR (status = 'succeeded' AND "completedAt" IS NOT NULL
          AND "resourceId" IS NOT NULL AND "responseStatus" = 201))`);
};

module.exports = { up, down };
