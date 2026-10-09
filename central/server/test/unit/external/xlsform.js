// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { strict: assert } = require('assert');
const http = require('http');
const { Readable } = require('stream');
const xlsform = require('../../../lib/external/xlsform');

// A stand-in for the form compiler that answers with whatever the test chooses.
const compiler = (reply) => new Promise((resolve) => {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.statusCode = reply.status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(reply.body));
    });
  });
  server.listen(0, '127.0.0.1', () => resolve(server));
});

const convertWith = async (reply) => {
  const server = await compiler(reply);
  try {
    const convert = xlsform.init({ host: '127.0.0.1', port: server.address().port });
    return await convert(Readable.from([Buffer.from('xlsx')]), 'fallback');
  } finally { server.close(); }
};

describe('xlsform compiler client', () => {
  it('returns the XForm, itemsets and warnings of a successful conversion', async () => {
    const result = await convertWith({ status: 200, body: { result: '<h:html/>', itemsets: 'a,b', warnings: ['note'] } });
    assert.deepEqual(result, { xml: '<h:html/>', itemsets: 'a,b', warnings: ['note'] });
  });

  it('reports a wrong spreadsheet as invalid and says what kind of invalid', async () => {
    await assert.rejects(convertWith({ status: 400, body: { error: 'Could not find the name x', warnings: [], errorCode: 'invalid-xlsform' } }),
      (error) => {
        assert.equal(error.problemCode, 400.15);
        assert.equal(error.problemDetails.kind, 'invalid-xlsform');
        assert.equal(error.problemDetails.error, 'Could not find the name x');
        return true;
      });
  });

  it('reports a rejected generated XForm as a compile failure, not a spreadsheet error', async () => {
    await assert.rejects(convertWith({ status: 400, body: { error: 'ODK Validate Errors: bad bind', errorCode: 'compile-failed' } }),
      (error) => error.problemCode === 400.15 && error.problemDetails.kind === 'compile-failed');
  });

  it('still reads the older compiler contract that carries no error code', async () => {
    await assert.rejects(convertWith({ status: 400, body: { error: 'old style' } }),
      (error) => error.problemCode === 400.15 && error.problemDetails.kind === undefined
        && error.problemDetails.error === 'old style');
  });

  it('reports a validator that cannot run as an infrastructure fault, never as an invalid form', async () => {
    await assert.rejects(convertWith({ status: 503, body: { error: 'Java is not installed', errorCode: 'validator-unavailable' } }),
      (error) => {
        assert.equal(error.problemCode, 502.4);
        assert.notEqual(error.problemCode, 400.15);
        assert.match(error.message, /Java/);
        assert.match(error.message, /not rejected/);
        return true;
      });
  });

  it('reports an unreachable compiler distinctly from both', async () => {
    const server = await compiler({ status: 200, body: {} });
    const { port } = server.address();
    await new Promise((resolve) => { server.close(resolve); });
    await assert.rejects(xlsform.init({ host: '127.0.0.1', port })(Readable.from([Buffer.from('x')])),
      (error) => error.problemCode === 502.2);
  });

  it('refuses XLSForm uploads when no compiler is configured', async () => {
    await assert.rejects(xlsform.init(null)(Readable.from([Buffer.from('x')])), (error) => error.problemCode === 501.3);
  });
});
