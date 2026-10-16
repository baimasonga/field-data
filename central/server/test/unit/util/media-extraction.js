// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const assert = require('node:assert/strict');
const { extract, validBytes, MAX_BYTES } = require('../../../lib/util/media-extraction');
const target = { bytes: Buffer.from([255, 216, 255]), contentType: 'image/jpeg', kind: 'photo', model: 'fixture' };
const answer = (text, status = 'completed') => Response.json({ status, output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
describe('media extraction provider limits', () => {
  it('accepts supported byte signatures with strict type/size checks', () => {
    assert.equal(validBytes(target.bytes, 'image/jpeg'), true);
    assert.equal(validBytes(target.bytes, 'image/png'), false);
    assert.equal(validBytes(Buffer.alloc(MAX_BYTES + 1), 'image/png'), false);
    assert.equal(validBytes(Buffer.from('ID3abc'), 'audio/mpeg'), true);
    assert.equal(validBytes(Buffer.from('RIFFnot-wave'), 'audio/wav'), false);
    assert.equal(validBytes(Buffer.alloc(0), 'image/png'), false);
  });
  it('uses fixed destinations, no storage, no redirects and bounded photo output', async () => {
    const result = await extract(target, { fetchImpl: async (url, init) => {
      assert.equal(url, 'https://api.openai.com/v1/responses'); assert.equal(init.redirect, 'error'); const body = JSON.parse(init.body);
      assert.equal(body.store, false); assert.equal(body.max_output_tokens, 4096); assert.equal(body.model, 'fixture'); return answer(' Visible label ');
    } }); assert.deepEqual(result, { ok: true, text: 'Visible label' });
  });
  it('rejects incomplete, empty, oversized, malformed and refusal output', async () => {
    for (const response of [answer('Partial', 'incomplete'), answer(' '), answer('x'.repeat(12001)), new Response('bad-json'),
      Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No' }] }] })]) {
      // eslint-disable-next-line no-await-in-loop
      assert.equal((await extract(target, { fetchImpl: async () => response })).ok, false);
    }
  });
  it('stops oversized provider streams and masks provider errors', async () => {
    assert.deepEqual(await extract(target, { fetchImpl: async () => new Response('x'.repeat(262145)) }), { ok: false, reason: 'output-too-large' });
    assert.deepEqual(await extract(target, { fetchImpl: async () => new Response('secret body', { status: 500 }) }), { ok: false, reason: 'provider-error' });
  });
  it('applies one timeout including streaming and never retries failed calls', async () => {
    let calls = 0;
    const result = await extract(target, { timeoutMs: 10, fetchImpl: async (_, init) => {
      calls += 1; return new Response(new ReadableStream({ start(controller) { init.signal.addEventListener('abort', () => controller.error(new Error('aborted'))); } }));
    } });
    assert.deepEqual(result, { ok: false, reason: 'timeout' }); assert.equal(calls, 1);
  });
});
