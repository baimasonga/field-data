// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { slonikPool } = require('../external/slonik');
const { runOperations } = require('../worker/field-data-operations');
const { generateReverification } = require('../worker/field-data-reverification');
const { runAlerts } = require('../worker/field-data-alerts');
const db = slonikPool(require('config').get('default.database'));
runOperations(db).then(() => (process.env.FIELD_DATA_ASSET_TASKS_ENABLED === 'true' ? generateReverification(db) : undefined)).then(() => runAlerts(db)).catch(() => { process.stderr.write('Operations runner failed. Check database connectivity and the operations runbook.\n'); process.exitCode = 1; })
  .finally(() => db.end());
