const up = db => db.raw(`ALTER TABLE field_data_operations_events ADD COLUMN "deliveredAt" TIMESTAMPTZ, ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0, ADD COLUMN "lastAttemptAt" TIMESTAMPTZ;`);
const down = async () => {};
module.exports = { up, down };
