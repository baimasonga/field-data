// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

const { sql } = require('slonik');
const { storage, formatBytes } = require('../external/field-data-storage');
const { getEncryptedPgDumpStream } = require('../util/backup');

// A session lock spans the upload, but each status update commits independently.
// Supavisor session mode is required. A killed runner releases its lock; the next
// invocation records its interrupted job as Failed instead of leaving it Running.
const runBackups = (db, dependencies = {}) => db.connect(async connection => {
  const store = dependencies.storage || storage;
  const dump = dependencies.dump || getEncryptedPgDumpStream;
  const locked = await connection.oneFirst(sql`
    select pg_try_advisory_lock(74121, hashtext(current_schema()))`);
  if (!locked) return;
  try {
    const interrupted = await connection.any(sql`
      update field_data_backups set status='Failed', "statusColor"='danger',
        error='Backup worker was interrupted; request a new backup.', "completedAt"=clock_timestamp()
      where status='Running' returning "storageKey"`);
    for (const record of interrupted) {
      if (record.storageKey) {
        // eslint-disable-next-line no-await-in-loop
        await store.delete(record.storageKey);
      }
    }
    const record = await connection.maybeOne(sql`
      select * from field_data_backups where status='Pending' order by id limit 1`);
    if (record == null) return;
    const key = `backups/manual-backup-${record.id}.pgdump.enc.bin`;
    await connection.query(sql`
      update field_data_backups set status='Running', "storageKey"=${key} where id=${record.id}`);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(new Error('Backup exceeded its time limit.')),
      dependencies.timeoutMs || 30 * 60 * 1000);
    let input;
    try {
      const passphrase = process.env.FIELD_DATA_BACKUP_PASSPHRASE;
      if (typeof passphrase !== 'string' || passphrase.length < 16) {
        throw new Error('A backup passphrase of at least 16 characters is required.');
      }
      input = await dump(passphrase, { signal: abort.signal });
      const bytes = await store.putStream(key, input,
        { 'Content-Type': 'application/octet-stream' }, { signal: abort.signal });
      await connection.query(sql`
        update field_data_backups set status='Success', "statusColor"='success',
          size=${formatBytes(bytes)}, "sizeBytes"=${bytes}, error=null, "completedAt"=clock_timestamp()
        where id=${record.id}`);
    } catch (error) {
      // Persist failure before cleanup, which can itself fail during an outage.
      await connection.query(sql`
        update field_data_backups set status='Failed', "statusColor"='danger',
          error='Backup failed. Check the server logs and retry.', "completedAt"=clock_timestamp()
        where id=${record.id}`);
      process.stderr.write(`Field Data backup ${record.id} failed: ${error.message}\n`);
      await store.delete(key);
    } finally {
      clearTimeout(timer);
      abort.abort();
      if (input) input.destroy();
    }
  } finally {
    await connection.query(sql`select pg_advisory_unlock(74121, hashtext(current_schema()))`);
  }
});

module.exports = { runBackups };
