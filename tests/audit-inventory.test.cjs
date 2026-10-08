const { test } = require('node:test');
const assert = require('node:assert/strict');
const { scan, collisions } = require('../tools/audit-inventory.cjs');
test('inventory reads route syntax and ignores commented or quoted fake declarations', () => {
  const result = scan(`// service.get('/fake', endpoint());
const note = "service.get('/also-fake')";
service.get('/projects/:projectId/forms', endpoint());
service.post(dynamicRoute, endpoint());
service.delete(\`/constant\`, endpoint());`, 'central/server/lib/resources/fixture.js');
  assert.deepEqual(result.endpoints.map(e => [e.method, e.path]), [['GET', '/projects/:projectId/forms'], ['POST', null], ['DELETE', '/constant']]);
  assert.equal(result.endpoints[1].expression, 'dynamicRoute');
});
test('duplicate detection treats parameter aliases equally without conflating HTTP methods', () => {
  const entries = scan(`service.get('/rows/:id', a); service.get('/rows/:rowId', b);
service.post('/rows/:id', c);`, 'fixture.js').endpoints;
  assert.equal(collisions(entries).length, 1);
  assert.equal(collisions(entries)[0].route, 'GET /rows/:param');
});
test('inventory collects environment names without retaining credential values', () => {
  const result = scan("const key = process.env.SYNTHETIC_SECRET || 'fixture';", 'fixture.js');
  assert.deepEqual(result.environmentNames, [{ name: 'SYNTHETIC_SECRET', file: 'fixture.js', line: 1 }]);
  assert.ok(!JSON.stringify(result).includes('fixture\"'));
});
test('invalid JavaScript is rejected instead of silently producing an empty inventory', () => {
  assert.throws(() => scan('service.get(', 'fixture.js'));
});
