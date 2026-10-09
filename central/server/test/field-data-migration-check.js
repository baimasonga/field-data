// Runs only against a fresh, disposable CI database.
const assert = require('node:assert/strict');
const knex = require('knex');
const mappingMigration = require('../lib/model/migrations/20261009-03-add-backcheck-field-mappings');
const pushMigration = require('../lib/model/migrations/20261009-02-add-app-user-backcheck-push');
const responseFormMigration = require('../lib/model/migrations/20261009-01-add-backcheck-response-form');
const cancellationMigration = require('../lib/model/migrations/20261008-01-add-backcheck-cancellation');

// Exercise Knex's migration bookkeeping as well as the retained schema. Use an
// isolated schema so this probe cannot alter the application tables or history.
const checkCancellationRollback = async (db) => {
  await db.transaction(async (tx) => {
    const schema = 'backcheck_rollback_probe';
    await tx.raw('CREATE SCHEMA ??', [schema]);
    await tx.raw('SET LOCAL search_path TO ??', [schema]);
    await tx.raw('CREATE TABLE actors (id INTEGER PRIMARY KEY)');
    await tx.raw('CREATE TABLE field_data_backchecks (status TEXT)');
    const name = '20261008-01-add-backcheck-cancellation.js';
    const options = {
      schemaName: schema,
      migrationSource: {
        getMigrations: () => Promise.resolve([name]),
        getMigrationName: (migration) => migration,
        getMigration: () => cancellationMigration
      }
    };
    await tx.migrate.latest(options);
    // Empty-history rollback removes the columns and permits a fresh upgrade.
    await tx.migrate.down(options);
    assert.equal(await tx.schema.hasColumn('field_data_backchecks', 'cancelledAt'), false);
    await tx.migrate.latest(options);
    await tx.raw('INSERT INTO actors (id) VALUES (1)');
    await tx.raw(`INSERT INTO field_data_backchecks
      (status, "cancelledAt", "cancelledBy", "cancellationRequestId", "cancellationReason")
      VALUES ('cancelled', now(), 1, '00000000-0000-4000-8000-000000000001', 'Collector unavailable')`);
    const before = (await tx.raw('SELECT * FROM field_data_backchecks')).rows;
    await tx.migrate.down(options);
    assert.deepEqual((await tx.raw('SELECT * FROM field_data_backchecks')).rows, before);
    await tx.migrate.latest(options);
    assert.deepEqual((await tx.raw('SELECT * FROM field_data_backchecks')).rows, before);
    assert.equal((await tx.migrate.list(options))[1].length, 0);
    // Retaining columns must also retain the data validation and actor FK.
    const constraints = (await tx.raw(`SELECT contype FROM pg_constraint
      WHERE conrelid = 'field_data_backchecks'::regclass`)).rows;
    assert.equal(constraints.filter(({ contype }) => contype === 'c').length, 2);
    assert.equal(constraints.filter(({ contype }) => contype === 'f').length, 1);
    await assert.rejects(tx.transaction((savepoint) => savepoint.raw(
      'UPDATE field_data_backchecks SET "cancellationReason" = \' \' '
    )), { code: '23514' });
    await assert.rejects(tx.transaction((savepoint) => savepoint.raw(
      'UPDATE field_data_backchecks SET "cancellationRequestId" = NULL'
    )), { code: '23514' });
    await assert.rejects(tx.transaction((savepoint) => savepoint.raw(
      'UPDATE field_data_backchecks SET "cancelledBy" = 999'
    )), { code: '23503' });
    await tx.raw('DROP SCHEMA ?? CASCADE', [schema]);
  });
  console.log('Back-check cancellation rollback/reapply preserves history and constraints');
};
const checkResponseFormRollback = async (db) => {
  await db.transaction(async (tx) => {
    const schema = 'backcheck_form_rollback_probe';
    await tx.raw('CREATE SCHEMA ??', [schema]);
    await tx.raw('SET LOCAL search_path TO ??', [schema]);
    await tx.raw(`CREATE TABLE forms (id INTEGER PRIMARY KEY);
      CREATE TABLE submissions (id INTEGER PRIMARY KEY, "formId" INTEGER);
      CREATE TABLE submission_defs (id INTEGER PRIMARY KEY, "submissionId" INTEGER);
      CREATE TABLE field_data_claim_versions (id INTEGER PRIMARY KEY, "submissionDefId" INTEGER);
      CREATE TABLE field_data_backchecks (id INTEGER PRIMARY KEY, "claimVersionId" INTEGER);
      INSERT INTO forms VALUES (1), (2);
      INSERT INTO submissions VALUES (1, 1);
      INSERT INTO submission_defs VALUES (1, 1);
      INSERT INTO field_data_claim_versions VALUES (1, 1);
      INSERT INTO field_data_backchecks VALUES (1, 1)`);
    const name = '20261009-01-add-backcheck-response-form.js';
    const options = { schemaName: schema, migrationSource: {
      getMigrations: () => Promise.resolve([name]),
      getMigrationName: migration => migration,
      getMigration: () => responseFormMigration
    } };
    await tx.migrate.latest(options);
    assert.equal((await tx.raw('SELECT "responseFormId" FROM field_data_backchecks')).rows[0].responseFormId, 1);
    await tx.raw('UPDATE field_data_backchecks SET "responseFormId" = 2');
    await tx.migrate.down(options);
    await tx.raw('INSERT INTO field_data_backchecks (id, "claimVersionId") VALUES (2, 1)');
    await tx.migrate.latest(options);
    const { rows } = await tx.raw('SELECT "responseFormId" FROM field_data_backchecks ORDER BY id');
    assert.deepEqual(rows.map(row => row.responseFormId), [2, 1]);
    await assert.rejects(tx.transaction(savepoint => savepoint.raw(
      'DELETE FROM forms WHERE id = 2'
    )), { code: '23503' });
    await tx.raw('DROP SCHEMA ?? CASCADE', [schema]);
  });
  console.log('Back-check response forms survive rollback/reapply and legacy backfill');
};
const checkPushRollback = async (db) => {
  await db.transaction(async (tx) => {
    const schema = 'backcheck_push_rollback_probe';
    await tx.raw('CREATE SCHEMA ??', [schema]);
    await tx.raw('SET LOCAL search_path TO ??', [schema]);
    await tx.raw(`CREATE TABLE actors (id INTEGER PRIMARY KEY);
      CREATE TABLE field_data_backchecks (id INTEGER PRIMARY KEY);
      INSERT INTO actors VALUES (1);
      INSERT INTO field_data_backchecks VALUES (1)`);
    const name = '20261009-02-add-app-user-backcheck-push.js';
    const options = { schemaName: schema, migrationSource: {
      getMigrations: () => Promise.resolve([name]), getMigrationName: migration => migration,
      getMigration: () => pushMigration
    } };
    await tx.migrate.latest(options);
    await tx.raw(`UPDATE field_data_backchecks SET "seenAt" = now();
      INSERT INTO field_data_app_user_push ("actorId", endpoint, p256dh, auth)
        VALUES (1, 'https://fcm.googleapis.com/fcm/send/fixture', 'fixture', 'fixture')`);
    const before = (await tx.raw('SELECT * FROM field_data_app_user_push')).rows;
    const seen = (await tx.raw('SELECT * FROM field_data_backchecks')).rows;
    await tx.migrate.down(options);
    await tx.migrate.latest(options);
    assert.deepEqual((await tx.raw('SELECT * FROM field_data_app_user_push')).rows, before);
    assert.deepEqual((await tx.raw('SELECT * FROM field_data_backchecks')).rows, seen);
    await tx.raw('DROP SCHEMA ?? CASCADE', [schema]);
  });
  console.log('Backcheck subscriptions and acknowledgments survive rollback/reapply');
};
const checkMappingRollback = async (db) => {
  await db.transaction(async (tx) => {
    const schema = 'backcheck_mapping_rollback_probe';
    await tx.raw('CREATE SCHEMA ??', [schema]);
    await tx.raw('SET LOCAL search_path TO ??', [schema]);
    await tx.raw(`CREATE TABLE actors (id INTEGER PRIMARY KEY);
      CREATE TABLE submission_defs (id INTEGER PRIMARY KEY);
      CREATE TABLE field_data_backchecks (id UUID PRIMARY KEY);
      INSERT INTO actors VALUES (1);
      INSERT INTO submission_defs VALUES (1), (2);
      INSERT INTO field_data_backchecks VALUES ('00000000-0000-4000-8000-000000000001')`);
    const name = '20261009-03-add-backcheck-field-mappings.js';
    const options = { schemaName: schema, migrationSource: {
      getMigrations: () => Promise.resolve([name]), getMigrationName: migration => migration,
      getMigration: () => mappingMigration
    } };
    await tx.migrate.latest(options);
    await tx.raw(`INSERT INTO field_data_backcheck_mappings
      ("backcheckId", revision, "requestId", "requestHash", "actorId", note, pairs,
        "originalSubmissionDefId", "backcheckSubmissionDefId", "originalHash", "backcheckHash")
      VALUES ('00000000-0000-4000-8000-000000000001', 1,
        '00000000-0000-4000-8000-000000000002', 'fixture', 1, 'Equivalent questions', '[]', 1, 2, 'a', 'b')`);
    const before = (await tx.raw('SELECT * FROM field_data_backcheck_mappings')).rows;
    await tx.migrate.down(options);
    await tx.migrate.latest(options);
    assert.deepEqual((await tx.raw('SELECT * FROM field_data_backcheck_mappings')).rows, before);
    await [
      ['UPDATE field_data_backcheck_mappings SET revision = 0', '23514'],
      ["UPDATE field_data_backcheck_mappings SET pairs = '{}'", '23514'],
      ['UPDATE field_data_backcheck_mappings SET "actorId" = 999', '23503'],
      ['DELETE FROM submission_defs WHERE id = 2', '23503']].reduce(async (previous, [query, code]) => {
      await previous;
      await assert.rejects(tx.transaction(savepoint => savepoint.raw(query)), { code });
    }, Promise.resolve());
    await tx.raw('DROP SCHEMA ?? CASCADE', [schema]);
  });
  console.log('Backcheck mapping evidence survives rollback/reapply with constraints');
};
(async () => {
  const schema = process.env.TEST_SCHEMA;
  assert.ok(['public', 'field_data'].includes(schema));
  const db = knex({ client: 'pg', connection: {} });
  try {
    await db.raw('create schema if not exists ??', [schema]);
    const current = await db.raw('select current_schema() as name');
    assert.equal(current.rows[0].name, schema);
    await db.migrate.latest({ directory: `${__dirname}/../lib/model/migrations` });
    const tables = await db.raw('select table_schema from information_schema.tables where table_name = ?', ['field_data_backups']);
    assert.deepEqual(tables.rows, [{ table_schema: schema }]);
    const functions = await db.raw("select n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname='hash_text'");
    assert.ok(functions.rows.some(row => row.nspname === schema));
    if (schema === 'field_data') {
      const misplaced = await db.raw("select tablename from pg_tables where schemaname='public'");
      assert.deepEqual(misplaced.rows, []);
    }
    console.log(`All migrations passed in ${schema}`);
    await checkCancellationRollback(db);
    await checkResponseFormRollback(db);
    await checkPushRollback(db);
    await checkMappingRollback(db);
  } finally { await db.destroy(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
