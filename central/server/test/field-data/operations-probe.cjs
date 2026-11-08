// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
process.env.FIELD_DATA_STORAGE_DIR = require('node:os').tmpdir();
const { probeStorage } = require('../../lib/worker/field-data-operations');

test('storage probe reads an available object and closes it', async () => {
  const stream = Readable.from(['data']);
  await probeStorage({ getStream: async () => stream }, 'key', 1000);
  assert.equal(stream.destroyed, true);
});

test('storage probe aborts an open that never returns', async () => {
  let signal;
  await assert.rejects(probeStorage({ getStream: (_, options) => { signal = options.signal; return new Promise(() => {}); } }, 'key', 20), /timeout/i);
  assert.equal(signal.aborted, true);
});

test('storage probe closes a stream that arrives after its open timed out', async () => {
  let finish;
  const opening = new Promise(resolve => { finish = resolve; });
  await assert.rejects(probeStorage({ getStream: () => opening }, 'key', 20), /timeout/i);
  const stream = new Readable({ read() {} });
  finish(stream);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stream.destroyed, true);
});

test('storage probe times out when a response body stalls', async () => {
  const stream = new Readable({ read() {} });
  await assert.rejects(probeStorage({ getStream: async () => stream }, 'key', 20), /timeout/i);
  assert.equal(stream.destroyed, true);
});
