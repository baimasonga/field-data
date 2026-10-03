// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { sql } = require('slonik');
const { Config } = require('../model/frames');
const { normalizePolicy } = require('../worker/field-data-operations');
module.exports = (service, endpoint) => {
  service.get('/field-data/operations', endpoint(async (c, { auth }, _, response) => {
    await auth.canOrReject('backup.run', Config.species); response.set('Cache-Control', 'private, no-store');
    const [checks, events, policy] = await Promise.all([c.db.any(sql`select * from field_data_operations_checks order by name`), c.db.any(sql`select * from field_data_operations_events order by id desc limit 100`), c.db.oneFirst(sql`select definition from field_data_operations_policy where id=1`)]);
    return { checks, events, policy, backupEncryptionConfigured: typeof process.env.FIELD_DATA_BACKUP_PASSPHRASE === 'string' && process.env.FIELD_DATA_BACKUP_PASSPHRASE.length >= 16, observedAt: new Date().toISOString() };
  }));
  service.put('/field-data/operations/policy', endpoint(async (c, { auth, body }) => {
    await auth.canOrReject('config.set', Config.species); const policy = normalizePolicy(body);
    await c.db.query(sql`update field_data_operations_policy set definition=${JSON.stringify(policy)} where id=1`);
    await c.db.query(sql`insert into field_data_operations_events (name, kind, detail) values ('policy', 'configuration', ${`Policy updated by actor ${auth.actor.map(a => a.id).orNull()}.`})`);
    return policy;
  }));
};
