const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { Readable } = require('node:stream');
process.env.NODE_ENV = 'test';
Object.assign(process.env, {
  FIELD_DATA_STORAGE_MODE: 'object',
  SUPABASE_S3_ENDPOINT: 'https://example.invalid/storage/v1/s3',
  SUPABASE_S3_ACCESS_KEY_ID: 'test',
  SUPABASE_S3_SECRET_ACCESS_KEY: 'test-secret',
  SUPABASE_STORAGE_BUCKET: 'test',
  SUPABASE_REGION: 'test'
});
const { storage } = require('../lib/external/field-data-storage');
const { deliver } = require('../lib/worker/webhooks');

test('stream upload propagates producer failure instead of accepting a partial backup', async () => {
  const original = global.fetch;
  global.fetch = async (_, options) => {
    for await (const chunk of options.body) void chunk;
    return new Response('', { status: 200 });
  };
  try {
    const broken = Readable.from((async function* () {
      yield Buffer.from('partial dump');
      throw new Error('pg_dump failed');
    })());
    await assert.rejects(storage.putStream('backups/test', broken), /pg_dump failed|fetch failed/);
  } finally { global.fetch = original; }
});

test('stream upload counts complete bytes and signs the path-based endpoint', async () => {
  const original = global.fetch;
  global.fetch = async (url, options) => {
    assert.equal(url.pathname, '/storage/v1/s3/test/field-data/backups/test');
    assert.match(options.headers.Authorization, /AWS4-HMAC-SHA256/);
    for await (const chunk of options.body) void chunk;
    return new Response('', { status: 200 });
  };
  try {
    assert.equal(await storage.putStream('backups/test', Readable.from([Buffer.from('abc')])), 3);
  } finally { global.fetch = original; }
});

test('upload rejection terminates the source stream', async () => {
  const original = global.fetch;
  global.fetch = async () => new Response('unavailable', { status: 503 });
  const input = new Readable({ read() { this.push(Buffer.alloc(1024)); } });
  try {
    await assert.rejects(storage.putStream('backups/test', input), /503/);
    assert.equal(input.destroyed, true);
  } finally { global.fetch = original; }
});

async function withServer(handler, callback) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await callback(`http://127.0.0.1:${server.address().port}/hook`); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test('webhook retries server errors and then succeeds', async () => {
  let count = 0;
  await withServer((req, res) => { req.resume(); res.writeHead(++count < 3 ? 503 : 204); res.end(); }, async url => {
    const outcome = await deliver(url, Buffer.from('{}'), { 'Content-Type': 'application/json' });
    assert.equal(outcome.success, true);
    assert.equal(outcome.attempts, 3);
  });
});

test('aborted webhook responses settle and retry', async () => {
  await withServer((req, res) => { req.resume(); res.writeHead(200); res.write('partial'); setImmediate(() => res.destroy()); }, async url => {
    const outcome = await deliver(url, Buffer.from('{}'), {});
    assert.equal(outcome.success, false);
    assert.equal(outcome.attempts, 3);
  });
});

test('permanent webhook errors are not retried', async () => {
  await withServer((req, res) => { req.resume(); res.writeHead(400); res.end(); }, async url => {
    const outcome = await deliver(url, Buffer.from('{}'), {});
    assert.equal(outcome.attempts, 1);
    assert.equal(outcome.success, false);
  });
});

test('global webhook and backup endpoints reject project-only managers before data access', async () => {
  const routes = [];
  const service = Object.fromEntries(['get', 'post', 'patch', 'delete'].map(method => [method, (path, ...handlers) => routes.push({ path, handler: handlers.at(-1) })]));
  require('../lib/resources/field-data')(service, handler => handler);
  for (const route of routes.filter(r => /\/field-data\/(backups|webhooks)/.test(r.path))) {
    const verb = route.path.includes('/backups') ? 'backup.run' : 'config.set';
    const auth = { canOrReject: async requested => { assert.equal(requested, verb); throw new Error('permission denied'); } };
    await assert.rejects(route.handler({}, { auth, body: {}, params: {} }), /permission denied/);
  }
});

test('managed-schema mode rejects whole-database restore', () => {
  process.env.FIELD_DATA_DB_SCHEMA = 'field_data';
  try {
    assert.throws(() => require('../lib/util/backup').restoreBackupFromRestoreStream(Readable.from([])), /whole-database restore is disabled/i);
  } finally { delete process.env.FIELD_DATA_DB_SCHEMA; }
});
