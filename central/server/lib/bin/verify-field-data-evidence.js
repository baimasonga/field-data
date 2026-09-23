// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

const config = require('config');
const { slonikPool } = require('../external/slonik');
const { withDefaults } = require('../model/container');
const { init } = require('../external/s3');
const { verifyEvidenceBatch } = require('../worker/field-data-evidence-verifications');
const { deriveImageMetadataBatch } = require('../worker/field-data-image-metadata');
const { sql } = require('slonik');

const db = slonikPool(config.get('default.database'));
const s3 = init(config.get('default.external.s3blobStore'));
const batchSize = Number(process.env.FIELD_DATA_EVIDENCE_BATCH_SIZE || 25);
db.connect(async (connection) => {
  const locked = await connection.oneFirst(sql`
    SELECT pg_try_advisory_lock(74122, hashtext(current_schema()))`);
  if (!locked) return { skipped: 'another evidence batch is running' };
  try {
    const container = withDefaults({ db: connection, s3 });
    const verification = s3.enabled
      ? await verifyEvidenceBatch(container, batchSize)
      : { skipped: 'object storage disabled' };
    const derivations = await deriveImageMetadataBatch(container, batchSize);
    return { verification, derivations };
  } finally {
    await connection.query(sql`SELECT pg_advisory_unlock(74122, hashtext(current_schema()))`);
  }
})
  .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
  .catch((error) => {
    process.stderr.write(`Evidence verification failed: ${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => db.end());
