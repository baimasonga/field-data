// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
const { slonikPool } = require('../external/slonik');
const { runGoogleSheetSyncs } = require('../worker/field-data-google-sheets');
const db = slonikPool(require('config').get('default.database'));
runGoogleSheetSyncs(db)
  .catch(error => {
    process.stderr.write(`Google Sheets sync runner failed: ${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => db.end());
