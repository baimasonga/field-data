// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { sql } = require('slonik');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const archiver = require('archiver');
const { storage } = require('../external/field-data-storage');
const { write } = require('../util/analysis-export');
const runExports = (db, dependencies = {}) => db.connect(async c => {
  const store = dependencies.storage || storage; const writer = dependencies.write || write;
  if (!await c.oneFirst(sql`select pg_try_advisory_lock(74136, hashtext(current_schema()))`)) return;
  try {
    const interrupted = await c.any(sql`update field_data_export_jobs set status='Failed', error='Export interrupted. Remove it and queue a new snapshot.' where status='Running' returning "storageKey"`);
    for (const j of interrupted) if (j.storageKey) await store.delete(j.storageKey); // eslint-disable-line no-await-in-loop
    const expired = await c.any(sql`select id, "storageKey" from field_data_export_jobs where "expiresAt"<=clock_timestamp()`);
    for (const j of expired) {
      if (j.storageKey) await store.delete(j.storageKey); // eslint-disable-line no-await-in-loop
      await c.query(sql`delete from field_data_export_jobs where id=${j.id}`); // eslint-disable-line no-await-in-loop
    }
    const job = await c.maybeOne(sql`select * from field_data_export_jobs where status='Pending' order by "createdAt" limit 1`);
    if (!job) return;
    const key = `exports/${job.id}.zip`;
    await c.query(sql`update field_data_export_jobs set status='Running', "storageKey"=${key} where id=${job.id}`);
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'field-data-export-'));
    const archive = archiver('zip', { zlib: { level: 6 } });
    const abort = new AbortController(); const timer = setTimeout(() => abort.abort(), 30 * 60 * 1000);
    let bytes = 0;
    try {
      let cursor = 0; let completed = 0; const parts = [];
      do {
        // Frozen rows are immutable, so keyset pagination cannot skip edited submissions.
        const records = await c.any(sql`select id, row from (select id, row, sum(octet_length(row::text)) over (order by id) as bytes from (select id, row from field_data_export_rows where "jobId"=${job.id} and id>${cursor} order by id limit 1000) batch) bounded where bytes <= 15 * 1024 * 1024 order by id`); // eslint-disable-line no-await-in-loop
        if (!records.length && parts.length) break;
        if (!records.length && completed < job.total) throw new Error('A single record exceeds the part limit.');
        if (abort.signal.aborted) throw new Error('Timeout.');
        const file = await writer({ ...job.payload, rows: records.map(r => r.row) }); // eslint-disable-line no-await-in-loop
        bytes += file.buffer.length; if (bytes > 1024 * 1024 * 1024) throw new Error('Output exceeds 1 GB. Add filters.');
        const ext = file.type === 'application/zip' ? 'zip' : job.request.format;
        const name = `part-${String(parts.length + 1).padStart(4, '0')}.${ext}`;
        const target = path.join(directory, name); await fs.writeFile(target, file.buffer); // eslint-disable-line no-await-in-loop
        parts.push({ file: name, parents: records.length }); archive.file(target, { name });
        completed += records.length; cursor = records.at(-1)?.id || cursor;
        const updated = await c.query(sql`update field_data_export_jobs set completed=${completed} where id=${job.id} and status='Running'`); // eslint-disable-line no-await-in-loop
        if (updated.rowCount === 0) throw new Error('Export removed.');
        if (completed >= job.total) break;
      } while (completed < job.total);
      if (completed !== job.total) throw new Error('Snapshot incomplete.');
      archive.append(JSON.stringify({ version: 1, source: job.request.source, definition: job.payload.definition, parents: completed, parts, joinKeys: 'source_form + instance_id and record_id; repeat parent_id joins its immediate parent', expiresAt: job.expiresAt }, null, 2), { name: 'manifest.json' });
      const upload = store.putStream(key, archive, { 'Content-Type': 'application/zip' }, { signal: abort.signal });
      await Promise.all([archive.finalize(), upload]);
      const exists = await c.maybeOne(sql`update field_data_export_jobs set status='Success', error=null where id=${job.id} and status='Running' returning id`);
      if (!exists) await store.delete(key);
    } catch {
      archive.abort();
      await c.query(sql`update field_data_export_jobs set status='Failed', error='Export failed or exceeded its resource limits. Remove it, add filters and retry.' where id=${job.id}`);
      await store.delete(key);
    } finally { clearTimeout(timer); abort.abort(); await fs.rm(directory, { recursive: true, force: true }); }
  } finally { await c.query(sql`select pg_advisory_unlock(74136, hashtext(current_schema()))`); }
});
module.exports = { runExports };
