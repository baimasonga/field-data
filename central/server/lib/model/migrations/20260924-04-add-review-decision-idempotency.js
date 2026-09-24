// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

const up = async (db) => {
  await db.raw(`ALTER TABLE field_data_idempotency_records
    DROP CONSTRAINT "field_data_idempotency_records_operationType_check",
    ADD CONSTRAINT "field_data_idempotency_records_operationType_check"
      CHECK ("operationType" IN ('evidence.link.create', 'review.case.assign',
        'review.case.decide'))`);
};

const down = async (db) => {
  await db.raw(`DELETE FROM field_data_idempotency_records
    WHERE "operationType" = 'review.case.decide'`);
  await db.raw(`ALTER TABLE field_data_idempotency_records
    DROP CONSTRAINT "field_data_idempotency_records_operationType_check",
    ADD CONSTRAINT "field_data_idempotency_records_operationType_check"
      CHECK ("operationType" IN ('evidence.link.create', 'review.case.assign'))`);
};

module.exports = { up, down };
