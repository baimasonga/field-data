import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('cron receives database, worker, storage, and CA settings but excludes unrelated variables', () => {
  const directory = mkdtempSync(join(tmpdir(), 'field-data-cron-'));
  const block = join(directory, 'environment');
  const expected = {
    PGHOST: 'database.test',
    FIELD_DATA_BACKUP_PASSPHRASE: 'fixture-only-passphrase',
    SUPABASE_STORAGE_BUCKET: 'fixture-bucket',
    NODE_EXTRA_CA_CERTS: '/fixture/public-ca.crt'
  };
  try {
    writeFileSync(block, [...Object.entries(expected), ['UNRELATED_VARIABLE', 'excluded']]
      .map(([name, value]) => `${name}=${value}\0`).join(''), { mode: 0o600 });
    const helper = fileURLToPath(new URL('../central/files/service/with-pgenvblock.pl', import.meta.url));
    const result = spawnSync('perl', [helper, block, process.execPath, '-e',
      `const names=${JSON.stringify([...Object.keys(expected), 'UNRELATED_VARIABLE'])}; console.log(JSON.stringify(Object.fromEntries(names.filter(name=>process.env[name]!=null).map(name=>[name,process.env[name]]))));`],
    { encoding: 'utf8', env: {} });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), expected);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
