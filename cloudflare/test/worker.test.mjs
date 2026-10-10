// Run with: node --import ./cloudflare/test/register.mjs --test cloudflare/test/worker.test.mjs
//
// The Worker must never let an exception escape: Cloudflare turns one into an
// "error code: 1101" page that no client can read. While the container is
// unavailable, every path answers 503 "starting up" instead.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

globalThis.__env = { CONTAINER_BUILD_ID: '' };
globalThis.scheduler = { wait: (ms) => new Promise((resolve) => { setTimeout(resolve, Math.min(ms, 30)); }) };
const ok = () => new Response('from the container', { status: 200 });
beforeEach(() => {
  globalThis.__env.CONTAINER_BUILD_ID = '';
  globalThis.__containerStub = { running: true, start: async () => {}, destroy: async () => {}, proxy: async () => ok() };
});

const { default: worker, FieldDataContainer } = await import('../worker.js');
const api = () => new Request('https://example.test/v1/projects', { headers: { accept: 'application/json' } });
const page = () => new Request('https://example.test/projects/1', { headers: { accept: 'text/html' } });
const startingUp = async (response) => {
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('retry-after'), '15');
  return response;
};

test('a request reaches the container when it is up', async () => {
  const response = await new FieldDataContainer().fetch(api());
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'from the container');
});

test('a container object reset by a deploy answers starting up, not a crash', async () => {
  const env = { FIELD_DATA_CONTAINER: { getByName: () => ({ fetch: () => Promise.reject(new Error('Durable Object reset because its code was updated.')) }) } };
  const response = await startingUp(await worker.fetch(api(), env));
  assert.deepEqual(await response.json(), { message: 'The server is starting up. Try again in a moment.', code: 503.1 });
  const html = await startingUp(await worker.fetch(page(), env));
  assert.match(html.headers.get('content-type'), /text\/html/);
});

test('a boot that fails answers starting up, and the next request boots again', async () => {
  let starts = 0;
  globalThis.__containerStub.start = async () => { starts += 1; throw new Error('the container did not start'); };
  const container = new FieldDataContainer();
  await startingUp(await container.fetch(api()));
  globalThis.__containerStub.start = async () => { starts += 1; };
  assert.equal((await container.fetch(api())).status, 200);
  assert.equal(starts, 2);
});

test('retiring an outdated container that fails answers starting up', async () => {
  globalThis.__env.CONTAINER_BUILD_ID = 'new-build';
  globalThis.__containerStub.destroy = async () => { throw new Error('destroy failed'); };
  await startingUp(await new FieldDataContainer().fetch(api()));
});

test('a slow boot answers starting up instead of hanging', async () => {
  globalThis.__containerStub.start = () => new Promise(() => {});
  await startingUp(await new FieldDataContainer().fetch(api()));
});

test('a proxy failure and a bad gateway answer starting up; an application 500 passes through', async () => {
  globalThis.__containerStub.proxy = async () => { throw new Error('Container suddenly disconnected'); };
  await startingUp(await new FieldDataContainer().fetch(api()));
  globalThis.__containerStub.proxy = async () => new Response('bad gateway', { status: 502 });
  await startingUp(await new FieldDataContainer().fetch(api()));
  globalThis.__containerStub.proxy = async () => new Response('{"code":500.1}', { status: 500 });
  const response = await new FieldDataContainer().fetch(api());
  assert.equal(response.status, 500);
  assert.equal(await response.text(), '{"code":500.1}');
});
