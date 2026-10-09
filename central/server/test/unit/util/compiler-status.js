// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { strict: assert } = require('assert');
const http = require('http');
const { compilerValidates } = require('../../../lib/util/compiler-status');

const serve = (reply) => new Promise((resolve) => {
  const server = http.createServer((req, res) => {
    res.statusCode = reply.status;
    res.setHeader('Content-Type', 'application/json');
    if (reply.hang) return; // never answer
    res.end(reply.raw ?? JSON.stringify(reply.body));
  });
  server.listen(0, '127.0.0.1', () => resolve(server));
});
const probe = async (reply, timeout) => {
  const server = await serve(reply);
  try { return await compilerValidates(`http://127.0.0.1:${server.address().port}/readyz`, timeout); } finally {
    server.closeAllConnections?.();
    server.close();
  }
};

describe('compiler validation probe', () => {
  it('is healthy only when the compiler says it is validating', async () => {
    assert.equal(await probe({ status: 200, body: { status: 'ok', validated: true } }), true);
  });

  it('is not healthy when validation is skipped, even though the compiler answers 200', async () => {
    assert.equal(await probe({ status: 200, body: { status: 'ok-unvalidated', validated: false } }), false);
  });

  it('is not healthy when Java is missing (503)', async () => {
    assert.equal(await probe({ status: 503, body: { status: 'unavailable', validated: false } }), false);
  });

  it('is not healthy on a 200 that does not state validated: true', async () => {
    assert.equal(await probe({ status: 200, body: { status: 'ok' } }), false);
    assert.equal(await probe({ status: 200, raw: 'not json' }), false);
  });

  it('treats a compiler that predates /readyz as reachable', async () => {
    assert.equal(await probe({ status: 404, body: {} }), true);
  });

  it('is not healthy when the compiler is unreachable or does not answer in time', async () => {
    const server = await serve({ status: 200, body: {} });
    const { port } = server.address();
    await new Promise((resolve) => { server.close(resolve); });
    assert.equal(await compilerValidates(`http://127.0.0.1:${port}/readyz`), false);
    assert.equal(await probe({ status: 200, hang: true }, 100), false);
  });
});
