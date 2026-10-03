// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { slonikPool } = require('../external/slonik');
const { runOperations } = require('../worker/field-data-operations');
const db = slonikPool(require('config').get('default.database'));
runOperations(db).catch(() => { process.stderr.write('Operations runner failed. Check database connectivity and the operations runbook.\n'); process.exitCode = 1; }).finally(() => db.end());
