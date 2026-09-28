// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
const { slonikPool } = require('../external/slonik');
const { runXlsReports } = require('../worker/field-data-xls-reports');
const db = slonikPool(require('config').get('default.database'));
runXlsReports(db)
  .catch(error => {
    process.stderr.write(`XLS report runner failed: ${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => db.end());
