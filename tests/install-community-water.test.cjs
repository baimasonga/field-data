const { test } = require('node:test');
const assert = require('node:assert/strict');
const config = { base: 'https://example.test', email: 'test@example.test', password: 'test-only-password', xlsx: Buffer.from('fixture-xlsx') };
const form = { xmlFormId: 'sl_community_water_service', name: 'Sierra Leone: Community Water and Sanitation', version: '2026101401', publishedAt: '2026-10-14T00:00:00Z' };
const fixture = (name, { existing = false, ambiguous = false, uncertain = false } = {}) => {
  let present = existing; const writes = []; let loggedOut = false;
  const fetcher = async (url, options) => {
    const path = url.pathname;
    if (path === '/v1/sessions') return Response.json({ token: 'test-session' });
    assert.equal(options.headers.Authorization, 'Bearer test-session');
    if (path === '/v1/sessions/current') { loggedOut = true; return new Response(null, { status: 204 }); }
    if (path === '/v1/projects') return Response.json([{ id: 17, name }, ...(ambiguous ? [{ id: 18, name }] : [])]);
    if (options.method === 'POST') { writes.push(path); present = true; assert.equal(options.body, config.xlsx); return uncertain ? new Response(null, { status: 503 }) : Response.json(form); }
    return present ? Response.json(form) : new Response(null, { status: 404 });
  };
  return { fetcher, writes, loggedOut: () => loggedOut };
};
test('installs only in the exact user-named project, verifies publication and closes its session', async () => {
  const { installCommunityWater, requestedProject } = await import('../cloudflare/install-community-water-form.mjs'); const f = fixture(requestedProject);
  const result = await installCommunityWater({ ...config, fetcher: f.fetcher }); assert.equal(result.projectId, 17); assert.equal(result.created, true);
  assert.deepEqual(f.writes, ['/v1/projects/17/forms']); assert.equal(f.loggedOut(), true);
});
test('existing compatible forms are confirmed without another write; uncertain creation responses are read back without repeating POST', async () => {
  const { installCommunityWater, requestedProject } = await import('../cloudflare/install-community-water-form.mjs');
  const existing = fixture(requestedProject, { existing: true }); assert.equal((await installCommunityWater({ ...config, fetcher: existing.fetcher })).created, false); assert.equal(existing.writes.length, 0);
  const uncertain = fixture(requestedProject, { uncertain: true }); assert.equal((await installCommunityWater({ ...config, fetcher: uncertain.fetcher })).created, true); assert.equal(uncertain.writes.length, 1);
});
test('missing or ambiguous project names prevent all writes and never create or delete projects', async () => {
  const { installCommunityWater, requestedProject } = await import('../cloudflare/install-community-water-form.mjs');
  for (const f of [fixture('Different project'), fixture(requestedProject, { ambiguous: true })]) {
    await assert.rejects(installCommunityWater({ ...config, fetcher: f.fetcher }), /uniquely found/); assert.equal(f.writes.length, 0); assert.equal(f.loggedOut(), true);
  }
});
