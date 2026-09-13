// Runs only against a fresh, disposable CI database.
const assert = require('node:assert/strict');
const knex = require('knex');
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
  } finally { await db.destroy(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
