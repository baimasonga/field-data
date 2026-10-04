const fs = require('node:fs/promises');
const { createWriteStream } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { Transform, Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const archiver = require('archiver');
const { sql } = require('slonik');
const { getEncryptedPgDumpStream } = require('./backup');
const { storage } = require('../external/field-data-storage');
const config = require('config');
const coreStore = () => require('../external/s3').init(config.get('default.external.s3blobStore'));
const getRecoveryBundle = async (connection, passphrase, { signal, storage: store = storage, dump = getEncryptedPgDumpStream, s3 } = {}) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'field-data-recovery-'));
  const manifest = { version: 1, createdAt: new Date().toISOString(), files: [], tables: {}, configuration: { secretValues: 'Recover separately from secure escrow', requiredNames: ['FIELD_DATA_BACKUP_PASSPHRASE', 'PGHOST', 'PGUSER', 'PGDATABASE', 'PGPASSWORD', 'FIELD_DATA_WEBHOOK_ENCRYPTION_KEY'], schema: process.env.FIELD_DATA_DB_SCHEMA || 'public' } };
  let total = 0; let sequence = 0; let core;
  const save = async (input, descriptor) => {
    const name = `files/${sequence}.bin`; sequence += 1; const target = path.join(directory, name);
    const hash = crypto.createHash('sha256'); let bytes = 0;
    const counter = new Transform({ transform(chunk, encoding, cb) {
      bytes += chunk.length; total += chunk.length; hash.update(chunk);
      cb(total > 8 * 1024 * 1024 * 1024 ? new Error('Recovery bundle exceeds 8 GB.') : null, chunk);
    } });
    await fs.mkdir(path.dirname(target), { recursive: true });
    await pipeline(input, counter, createWriteStream(target, { mode: 0o600 }), { signal });
    manifest.files.push({ ...descriptor, file: name, bytes, sha256: hash.digest('hex') });
  };
  try {
    await connection.transaction(async c => {
      await c.query(sql`set transaction isolation level repeatable read, read only`);
      const snapshot = await c.oneFirst(sql`select pg_export_snapshot()`);
      const schema = await c.oneFirst(sql`select current_schema()`); manifest.configuration.schema = schema;
      const tables = await c.any(sql`select tablename from pg_tables where schemaname=${schema} order by tablename`);
      for (const table of tables) {
        // Order-independent digest sums avoid materializing an entire table as text.
        manifest.tables[table.tablename] = await c.one(sql`select count(*)::int as rows, coalesce(sum(('x'||substr(md5(row_to_json(t)::text),1,15))::bit(60)::bigint),0)::text as "digestA", coalesce(sum(('x'||substr(md5(row_to_json(t)::text),18,15))::bit(60)::bigint),0)::text as "digestB" from ${sql.identifier([schema, table.tablename])} t`); // eslint-disable-line no-await-in-loop
      }
      await save(await dump(passphrase, { signal, snapshot }), { kind: 'database' });
      const refs = await c.any(sql`select table_name from information_schema.columns where table_schema=${schema} and column_name='storageKey' and table_name not in ('field_data_backups','field_data_export_jobs') order by table_name`);
      const keys = new Set();
      for (const table of refs) {
        const rows = await c.any(sql`select "storageKey" from ${sql.identifier([schema, table.table_name])} where "storageKey" is not null`); // eslint-disable-line no-await-in-loop
        rows.forEach(r => keys.add(r.storageKey));
      }
      if (keys.size > 25000) throw new Error('Recovery bundle exceeds 25,000 objects.');
      for (const key of keys) await save(await store.getStream(key), { kind: 'object', key }); // eslint-disable-line no-await-in-loop
      const blobs = await c.any(sql`select id, sha, "contentType" from blobs where s3_status='uploaded' and content is null order by id`);
      if (blobs.length + keys.size > 25000) throw new Error('Recovery bundle exceeds 25,000 objects.');
      core = s3 || coreStore();
      if (blobs.length && !core.enabled) throw new Error('External attachment storage is unavailable.');
      for (const blob of blobs) {
        const partial = await core.pipeContent(blob); // eslint-disable-line no-await-in-loop
        await save(partial.streams[0], { kind: 'blob', id: blob.id, sha: blob.sha, contentType: blob.contentType }); // eslint-disable-line no-await-in-loop
      }
    });
    const archive = archiver('zip', { zlib: { level: 6 } });
    for (const f of manifest.files) archive.file(path.join(directory, f.file), { name: f.file });
    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
    const encrypt = spawn('openssl', ['enc', '-chacha20', '-pbkdf2', '-pass', 'env:ODK_BACKUP_PASSPHRASE'], { env: { ...process.env, ODK_BACKUP_PASSPHRASE: passphrase }, stdio: ['pipe', 'pipe', 'ignore'], signal });
    const completion = new Promise((resolve, reject) => { encrypt.once('error', reject); encrypt.once('exit', code => (code === 0 ? resolve() : reject(new Error('Recovery encryption failed.')))); });
    const streaming = Promise.all([pipeline(archive, encrypt.stdin, { signal }), archive.finalize(), completion]);
    const output = Readable.from((async function* chunks() { for await (const chunk of encrypt.stdout) yield chunk; await streaming; })());
    streaming.catch(e => output.destroy(e));
    output.once('close', () => { archive.abort(); if (encrypt.exitCode == null) encrypt.kill(); fs.rm(directory, { recursive: true, force: true }).catch(() => {}); });
    return output;
  } catch (e) { await fs.rm(directory, { recursive: true, force: true }); throw e; } finally { if (core && !s3) await core.destroy?.(); }
};
module.exports = { getRecoveryBundle };
