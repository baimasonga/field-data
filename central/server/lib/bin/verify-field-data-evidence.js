// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

const config = require('config');
const { slonikPool } = require('../external/slonik');
const { withDefaults } = require('../model/container');
const { init } = require('../external/s3');
const { verifyEvidenceBatch } = require('../worker/field-data-evidence-verifications');

const db = slonikPool(config.get('default.database'));
const s3 = init(config.get('default.external.s3blobStore'));
const batchSize = Number(process.env.FIELD_DATA_EVIDENCE_BATCH_SIZE || 25);
verifyEvidenceBatch(withDefaults({ db, s3 }), batchSize)
  .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
  .catch((error) => {
    process.stderr.write(`Evidence verification failed: ${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => db.end());
