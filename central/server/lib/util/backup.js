// Functions for working with the "new" (2026) DB backup format.
// See https://github.com/getodk/central/issues/1646


const { execFileSync, spawn } = require('child_process');
const { mergeRight } = require('ramda');
const { env } = require('node:process');
const peek = require('buffer-peek-stream').promise;
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { streamSequentially } = require('./stream');
const { awaitSpawnee } = require('./process');


const OPENSSL_DECRYPT_ARGV = ['enc', '-d', '-pbkdf2', '-pass', 'env:ODK_BACKUP_PASSPHRASE', '-chacha20'];


const backupSchema = () => process.env.FIELD_DATA_DB_SCHEMA
  || (process.env.SUPABASE_S3_ENDPOINT ? 'field_data' : null);

const getEncryptedPgDumpStream = async (passphrase = '', { signal } = {}) => {
  const schema = backupSchema();
  if (schema != null && !/^[a-z_][a-z0-9_]*$/.test(schema)) {
    throw new Error('Invalid FIELD_DATA_DB_SCHEMA.');
  }
  // gzip works on every supported pg_dump version. Never interpolate credentials
  // or schema names into shell commands, and never dump Supabase-managed schemas.
  const args = ['--no-password', '--format=custom', '--compress=6'];
  if (schema != null) args.push(`--schema=${schema}`, '--strict-names');
  const dump = spawn('pg_dump', args, { stdio: ['ignore', 'pipe', 'inherit'], signal });
  const encrypt = spawn('openssl', ['enc', '-chacha20', '-pbkdf2', '-pass', 'env:ODK_BACKUP_PASSPHRASE'], {
    env: mergeRight(env, { ODK_BACKUP_PASSPHRASE: passphrase }),
    stdio: ['pipe', 'pipe', 'inherit'],
    signal
  });
  // Attach exit listeners immediately: a fast failing child must not be missed.
  const completion = Promise.all([
    awaitSpawnee(dump), awaitSpawnee(encrypt), pipeline(dump.stdout, encrypt.stdin)
  ]);
  const output = Readable.from((async function* encrypted() {
    for await (const chunk of encrypt.stdout) yield chunk;
    await completion;
  })());
  completion.catch(error => output.destroy(error));
  output.once('close', () => {
    if (dump.exitCode == null) dump.kill('SIGTERM');
    if (encrypt.exitCode == null) encrypt.kill('SIGTERM');
    dump.stdout.destroy();
    encrypt.stdout.destroy();
    encrypt.stdin.destroy();
  });
  return output;
};


const checkDecrypt = async (encryptedPgDumpStream, passphrase='') => {
  // We want to bail out early if the decrypt is not successful.
  // OpenSSL (they way we use it here) doesn't tell you whether this is the case. But we
  // can check it ourselves: try on the first handful of bytes of the stream, and see if we get
  // what looks like a pg_dump custom format file.
  const PEEK_NO_BYTES = 128; // should be more than enough, the openssl header is not that large
  const expectedPgDumpMagic = 'PGDMP'; // the pgdump custom format starts with this file magic
  const [peekbuf, reconstitutedInput] = await peek(encryptedPgDumpStream, PEEK_NO_BYTES);
  const peekDecrypted = execFileSync(
    'openssl',
    OPENSSL_DECRYPT_ARGV,
    {
      input: peekbuf,
      env: mergeRight(env, { ODK_BACKUP_PASSPHRASE: passphrase }),
    }
  );
  if (peekDecrypted.subarray(0, expectedPgDumpMagic.length).toString('ascii') !== expectedPgDumpMagic) {
    const err = new Error('Incorrect passphrase supplied for decryption');
    err.exitcode = 100;
    throw err;
  }
  return reconstitutedInput;
};


const getDecryptedPgRestoreStream = async (encryptedPgDumpStream, passphrase='') => {
  const spawned = spawn(
    '/bin/bash',
    [
      '-c',
      `openssl ${OPENSSL_DECRYPT_ARGV.join(' ')} | pg_restore --exit-on-error --no-owner --no-acl --file=-`,
    ],
    {
      env: mergeRight(env, { ODK_BACKUP_PASSPHRASE: passphrase }),
      stdio: ['pipe', 'pipe', 'inherit'],
    },
  );
  pipeline(encryptedPgDumpStream, spawned.stdin);
  return spawned;
};


const restoreBackupFromRestoreStream = (dumpRestoreStream) => {
  if (backupSchema() != null) {
    dumpRestoreStream.destroy();
    throw new Error('Whole-database restore is disabled for schema-scoped deployments. Restore into an isolated empty database using cloudflare/README.md.');
  }
  const restoreProcess = spawn(
    'psql',
    [
      '--no-password',
      '--no-psqlrc',
      '--echo-all',
    ],
    {
      stdio: ['pipe', 'inherit', 'inherit'],
    },
  );

  const preamble = Readable.from(`
      -- Make a best effort to terminate other sessions that may block us dropping DB objects.
      -- We may not be DB superuser, in which case we can't drop connections from superusers.
      -- So first we try to drop all other sessions, which may fail, and then we try to terminate
      -- just our own.

      -- Might fail if we're not superuser and there are superuser sessions among those selected
      SELECT
          pg_terminate_backend(pid)
      FROM
          pg_stat_activity
      WHERE
          datname = current_database()
          AND pid != pg_backend_pid();

      -- Again, just for our user, useful in case the above failed
      SELECT
          pg_terminate_backend(pid)
      FROM
          pg_stat_activity
      WHERE
          datname = current_database()
          AND usename = CURRENT_USER
          AND pid != pg_backend_pid();

      -- Upon error, stops execution and makes psql exit with exitcode 3
      \\set ON_ERROR_STOP on

      BEGIN;

      -- Clean out the DB as much as possible.
      -- Objects (such as an extension) not owned by the connecting user (eg placed there by a DB superuser without chowning)
      -- will not be dropped, which is going to be a problem when that object is included in the dump.
      DROP OWNED BY CURRENT_USER CASCADE;

      CREATE SCHEMA IF NOT EXISTS public;
  `);
  const postamble = Readable.from(`
      COMMIT;
  `);
  const allthesql = streamSequentially(preamble, dumpRestoreStream, postamble);
  pipeline(allthesql, restoreProcess.stdin);
  return restoreProcess;
};


module.exports = { checkDecrypt, getEncryptedPgDumpStream, getDecryptedPgRestoreStream, restoreBackupFromRestoreStream };
