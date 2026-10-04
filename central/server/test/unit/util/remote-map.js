const assert = require('node:assert/strict');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { normalizeRemote, remoteTile } = require('../../../lib/util/remote-map');
describe('(util) remote maps', () => {
  let previous;
  beforeEach(() => { previous = process.env.FIELD_DATA_WEBHOOK_ENCRYPTION_KEY; process.env.FIELD_DATA_WEBHOOK_ENCRYPTION_KEY = '33'.repeat(32); });
  afterEach(() => { if (previous == null) delete process.env.FIELD_DATA_WEBHOOK_ENCRYPTION_KEY; else process.env.FIELD_DATA_WEBHOOK_ENCRYPTION_KEY = previous; });
  const config = { title: 'Synthetic WMS', sourceType: 'wms', url: 'https://8.8.8.8/wms', layers: 'boundaries', attribution: 'Fixture provider', authorization: 'Bearer fixture-token' };
  it('blocks private networks, embedded credentials, insecure protocols and query-string secrets', async () => {
    for (const url of ['https://127.0.0.1/wms', 'https://[::1]/wms', 'https://user:password@8.8.8.8/wms', 'http://8.8.8.8/wms', 'https://8.8.8.8/wms?token=secret']) {
      // eslint-disable-next-line no-await-in-loop
      await assert.rejects(normalizeRemote({ ...config, url }));
    }
  });
  it('pins public DNS, sends encrypted credentials server-side and builds bounded WMS requests', async () => {
    const layer = await normalizeRemote(config); const original = https.get; let sent;
    https.get = (url, options, callback) => {
      sent = { url, options }; const request = new EventEmitter(); request.destroy = error => request.emit('error', error);
      const response = new EventEmitter(); response.statusCode = 200; response.headers = { 'content-type': 'image/png' }; response.destroy = error => response.emit('error', error);
      queueMicrotask(() => { callback(response); response.emit('data', Buffer.from('synthetic raster')); response.emit('end'); request.emit('close'); }); return request;
    };
    try {
      const result = await remoteTile(layer, { z: '0', x: '0', y: '0' }); assert.equal(result.type, 'image/png'); assert.equal(result.buffer.toString(), 'synthetic raster');
      assert.equal(sent.url.searchParams.get('REQUEST'), 'GetMap'); assert.equal(sent.url.searchParams.get('SRS'), 'EPSG:3857'); assert.equal(sent.url.searchParams.get('LAYERS'), 'boundaries'); assert.equal(sent.options.headers.Authorization, 'Bearer fixture-token');
      sent.options.lookup('8.8.8.8', {}, (_, address, family) => { assert.equal(address, '8.8.8.8'); assert.equal(family, 4); });
    } finally { https.get = original; }
  });
  it('does not follow redirects or expose provider bodies as images', async () => {
    const layer = await normalizeRemote(config); const original = https.get;
    https.get = (_, options, callback) => {
      const request = new EventEmitter(); const response = new EventEmitter(); response.statusCode = 302; response.headers = { 'content-type': 'text/html' }; response.destroy = () => {};
      queueMicrotask(() => { callback(response); request.emit('close'); }); return request;
    };
    try { await assert.rejects(remoteTile(layer, { z: 1, x: 0, y: 0 }), /supported image/); } finally { https.get = original; }
  });
});
