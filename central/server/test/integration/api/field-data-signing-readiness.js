const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const { sql } = require('slonik');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { testService } = require('../setup');
describe('api: deployed offline signing readiness contract', () => {
  it('verifies a signed empty scope and removes its own project and App User through real routes', testService(async (service, c) => {
    const { verifyOfflineSigning } = await import(pathToFileURL(resolve(__dirname, '../../../../../cloudflare/verify-offline-signing.mjs')).href);
    const sessionToken = await service.authenticateUser('alice');
    const key = process.env.FIELD_DATA_OFFLINE_SIGNING_KEY; const origin = process.env.FIELD_DATA_OFFLINE_ORIGIN;
    process.env.FIELD_DATA_OFFLINE_SIGNING_KEY = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
    process.env.FIELD_DATA_OFFLINE_ORIGIN = 'https://field.example.test';
    const statuses = [];
    const fetcher = async (url, options = {}) => {
      const path = new URL(url).pathname;
      if (path === '/field-data-build.json') return Response.json({ deploymentId: 'release-1' });
      if (path === '/') return new Response('<script src="/assets/central/current.js"></script>');
      const request = service[(options.method ?? 'GET').toLowerCase()](path).set(options.headers ?? {});
      if (options.body != null) request.send(JSON.parse(options.body));
      const response = await request; statuses.push({ method: options.method, path, status: response.status });
      return new Response(response.text, { status: response.status, headers: { 'Content-Type': response.headers['content-type'] ?? 'application/json' } });
    };
    try {
      await verifyOfflineSigning({ base: 'https://field.example.test', workerBase: 'https://worker.example.test', audience: 'https://field.example.test', deploymentId: 'release-1', sessionToken, fetcher });
      assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM projects WHERE name LIKE 'Offline readiness check %' AND "deletedAt" IS NULL`), 0);
      assert.equal(await c.db.oneFirst(sql`SELECT count(*)::integer FROM actors WHERE "displayName" LIKE 'Offline readiness check %' AND "deletedAt" IS NULL`), 0);
    } catch (error) { throw new Error(`${error.message}; endpoint statuses: ${JSON.stringify(statuses)}`); } finally {
      if (key == null) delete process.env.FIELD_DATA_OFFLINE_SIGNING_KEY; else process.env.FIELD_DATA_OFFLINE_SIGNING_KEY = key;
      if (origin == null) delete process.env.FIELD_DATA_OFFLINE_ORIGIN; else process.env.FIELD_DATA_OFFLINE_ORIGIN = origin;
    }
  }));
});
