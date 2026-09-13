// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
const { slonikPool } = require('../external/slonik');
const { runBackups } = require('../worker/field-data-backups');
const db = slonikPool(require('config').get('default.database'));
runBackups(db)
  .catch(error => {
    process.stderr.write(`Backup runner failed: ${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => db.end());
