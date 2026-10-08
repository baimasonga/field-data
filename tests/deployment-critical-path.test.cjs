const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/deploy-field-data.yml'), 'utf8');
const step = name => workflow.split(`- name: ${name}\n`)[1].split('\n      - name:')[0];
const walk = step('Walk the critical path with that session').split('        run: |\n')[1]
  .split('\n').map(line => line.startsWith('          ') ? line.slice(10) : line).join('\n');

// Execute the workflow's actual shell against disposable HTTP command doubles.
// No credentials or network traffic are used, and retry delays are skipped.
const runWalk = ({ unavailable = 0, coreFailure = false, unhealthy = false } = {}) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'field-data-deploy-check-'));
  try {
    const command = (name, content) => fs.writeFileSync(path.join(directory, name), content, { mode: 0o700 });
    command('curl', `#!${process.execPath}
const fs = require('node:fs');
const url = process.argv.at(-1);
if (process.argv.includes('--head')) { console.log('HTTP/2 200'); process.exit(0); }
if (url.endsWith('/v1/field-data/stats')) {
  const file = process.env.COUNTER;
  const count = fs.existsSync(file) ? Number(fs.readFileSync(file, 'utf8')) : 0;
  fs.writeFileSync(file, String(count + 1));
  console.log(count < Number(process.env.UNAVAILABLE)
    ? JSON.stringify({code:503.1}) + '\\n503'
    : JSON.stringify({systemStatus:{enketo:process.env.UNHEALTHY !== 'true'}}) + '\\n200');
} else console.log(url.endsWith('/v1/projects') && process.env.CORE_FAILURE === 'true' ? '{}\\n500' : '[]\\n200');
`);
    command('jq', `#!${process.execPath}
let input = ''; process.stdin.on('data', c => { input += c; });
process.stdin.on('end', () => {
  if (process.argv.includes('.systemStatus.enketo == true')) {
    try { process.exit(JSON.parse(input).systemStatus?.enketo === true ? 0 : 1); }
    catch { process.exit(1); }
  } else if (process.argv.includes('-c')) console.log('{}');
});
`);
    command('sleep', '#!/bin/sh\nexit 0\n');
    return spawnSync('bash', ['-c', walk], { encoding: 'utf8', timeout: 10000,
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, BASE: 'https://fixture.test',
        FIELD_DATA_SESSION_TOKEN: 'fixture-only', COUNTER: path.join(directory, 'counter'),
        UNAVAILABLE: String(unavailable), CORE_FAILURE: String(coreFailure), UNHEALTHY: String(unhealthy) } });
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
};

test('temporary Web Forms startup failures can recover without failing deployment', () => {
  const result = runWalk({ unavailable: 3 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Every step of the critical path answered/);
});
test('exhausted Web Forms retries fail deployment', () => {
  assert.equal(runWalk({ unavailable: 6 }).status, 1);
});
test('HTTP 200 with an unhealthy Web Forms result fails deployment', () => {
  assert.equal(runWalk({ unhealthy: true }).status, 1);
});
test('Web Forms recovery does not erase an independent API failure', () => {
  assert.equal(runWalk({ unavailable: 1, coreFailure: true }).status, 1);
});

test('account diagnostics execute aggregate queries without reporting identities', async () => {
  const diagnostic = step('Report aggregate account readiness');
  const script = diagnostic.split("field-data-db-check -e '\n")[1].split("\n            '")[0];
  const queries = []; const output = [];
  class Client {
    async connect() {}
    async end() {}
    async query(sql) {
      queries.push(sql);
      return { rows: [{ accounts: '2', withPassword: '2' }] };
    }
  }
  vm.runInNewContext(script, { require: name => { assert.equal(name, 'pg'); return { Client }; },
    console: { log: (...args) => output.push(args.join(' ')), error: (...args) => output.push(args.join(' ')) },
    process: { exitCode: 0 } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(queries.length, 2);
  assert.ok(queries.every(sql => /count\(/i.test(sql)));
  assert.ok(queries.every(sql => !/u\.email|displayName|select at, outcome, detail/i.test(sql)));
  assert.doesNotMatch(output.join('\n'), /@|displayName|hasPassword/);
});
