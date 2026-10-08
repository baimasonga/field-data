const { slonikPool } = require('../external/slonik');
const { runExports } = require('../worker/field-data-exports');
const db = slonikPool(require('config').get('default.database'));
runExports(db).catch(() => { process.stderr.write('Export runner failed. Check service connectivity.\n'); process.exitCode = 1; }).finally(() => db.end());
