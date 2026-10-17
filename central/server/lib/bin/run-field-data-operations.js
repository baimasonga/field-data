// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { slonikPool } = require('../external/slonik');
const { runOperations } = require('../worker/field-data-operations');
const { generateReverification } = require('../worker/field-data-reverification');
const { runAlerts } = require('../worker/field-data-alerts');
const { runAllocations } = require('../worker/field-data-backcheck-allocation');
const { runBackcheckSchedules } = require('../worker/field-data-backcheck-schedules');
const db = slonikPool(require('config').get('default.database'));
runOperations(db)
  .then(() => (process.env.FIELD_DATA_ASSET_TASKS_ENABLED === 'true' ? generateReverification(db) : undefined))
  .then(() => runBackcheckSchedules(db))
  .then(() => runAllocations(db))
  .then(() => runAlerts(db))
  // The cause is recorded in cron_log by the calling script; only the error's
  // message is printed, never configuration.
  .catch((error) => {
    const cause = String(error?.message ?? error).split('\n')[0].slice(0, 300);
    process.stderr.write(`Operations runner failed: ${cause}. Check database connectivity and the operations runbook.\n`);
    process.exitCode = 1;
  })
  .finally(() => db.end());
