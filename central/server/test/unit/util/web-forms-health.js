const assert = require('node:assert/strict');
const http = require('node:http');
const { webFormsHealth } = require('../../../lib/util/web-forms-health');
describe('(util) native Web Forms health', () => {
  let server; let origin; let page; let assetStatus; let assetType;
  beforeEach(async () => {
    page = '<title>ODK Web Forms</title><script src="/apps/forms/src/init.js"></script><script type="module" src="/assets/forms/forms-fixture.js"></script>';
    assetStatus = 200; assetType = 'application/javascript';
    server = http.createServer((req, res) => {
      if (req.url === '/apps/forms/index.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(page); } else { res.writeHead(assetStatus, { 'Content-Type': assetType }); res.end('fixture script'); }
    });
    await new Promise(resolve => { server.listen(0, '127.0.0.1', resolve); }); origin = `http://127.0.0.1:${server.address().port}`;
  });
  afterEach(() => new Promise(resolve => { server.close(resolve); }));
  it('checks the native app and both bootstrap and built JavaScript assets', async () => { assert.equal(await webFormsHealth(origin), true); });
  it('fails when an asset is missing or the SPA fallback returns HTML', async () => {
    assetStatus = 404; assert.equal(await webFormsHealth(origin), false);
    assetStatus = 200; assetType = 'text/html'; assert.equal(await webFormsHealth(origin), false);
  });
  it('rejects the management app, redirects and external scripts', async () => {
    page = '<title>Field Data</title><script src="/assets/app.js"></script>'; assert.equal(await webFormsHealth(origin), false);
    page = '<title>ODK Web Forms</title><script src="/assets/forms/forms-fixture.js"></script><script src="https://example.com/script.js"></script>'; assert.equal(await webFormsHealth(origin), false);
    assetStatus = 302; page = '<title>ODK Web Forms</title><script src="/assets/forms/forms-fixture.js"></script>'; assert.equal(await webFormsHealth(origin), false);
  });
  it('fails when the frontend server is unavailable', async () => {
    await new Promise(resolve => { server.close(resolve); }); assert.equal(await webFormsHealth(origin), false);
  });
});
