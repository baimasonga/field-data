// Read-only source inventory. Install the existing client workspace dependencies
// first; its Babel parser is already pinned by central/client/package-lock.json.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const { parse } = createRequire(path.join(root, 'central/client/package.json'))('@babel/parser');
const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'all']);
const walk = (node, visit) => {
  if (node == null || typeof node !== 'object') return;
  if (node.type) visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(child => walk(child, visit));
    else if (value && typeof value === 'object') walk(value, visit);
  }
};
const literal = node => node?.type === 'StringLiteral' ? node.value
  : node?.type === 'TemplateLiteral' && node.expressions.length === 0 ? node.quasis[0].value.cooked : null;
const scan = (source, file) => {
  const result = { endpoints: [], clientPaths: [], environmentNames: [], resourceRegistrations: [] };
  walk(parse(source, { sourceType: 'unambiguous', plugins: ['importAttributes'] }), node => {
    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression'
      && node.callee.object.name === 'service' && methods.has(node.callee.property.name)) {
      const route = literal(node.arguments[0]);
      result.endpoints.push({ method: node.callee.property.name.toUpperCase(), path: route,
        expression: route == null ? source.slice(node.arguments[0].start, node.arguments[0].end) : null,
        file, line: node.loc.start.line });
    }
    if (node.type === 'ObjectProperty' && node.key.name === 'path' && file.endsWith('/routes.js')) {
      const route = literal(node.value);
      result.clientPaths.push({ path: route, expression: route == null ? source.slice(node.value.start, node.value.end) : null,
        file, line: node.loc.start.line });
    }
    if (node.type === 'MemberExpression' && !node.computed && node.object.type === 'MemberExpression'
      && ((node.object.object.name === 'process' && node.object.property.name === 'env')))
      result.environmentNames.push({ name: node.property.name, file, line: node.loc.start.line });
    if (node.type === 'CallExpression' && node.callee.name === 'require'
      && literal(node.arguments[0])?.startsWith('../resources/'))
      result.resourceRegistrations.push({ module: literal(node.arguments[0]), file, line: node.loc.start.line });
  });
  return result;
};
const collisions = endpoints => {
  const groups = new Map();
  for (const endpoint of endpoints) {
    if (endpoint.path == null) continue;
    const key = `${endpoint.method} ${endpoint.path.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, ':param')}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(endpoint);
  }
  return [...groups].filter(([, entries]) => entries.length > 1).map(([route, entries]) => ({ route, entries }));
};
const inventory = () => {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean).sort();
  const result = { schemaVersion: 1, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    limitations: ['Static declarations are not proof of runtime reachability or acceptance.',
      'Client paths are local declarations; compose nested parents and resolve redirects at runtime.',
      'Dynamic route expressions remain unresolved; overlapping wildcard routes need runtime review.',
      'Environment names are configuration dependencies, not necessarily Boolean feature flags. No values are collected.'],
    modules: files.filter(f => /^central\/server\/lib\/.*\.js$|^central\/client\/(apps|packages)\/.*\/src\/.*\.(js|ts|vue)$/.test(f)),
    migrations: files.filter(f => f.startsWith('central/server/lib/model/migrations/')),
    tests: files.filter(f => /(^tests\/|\/test\/|\/e2e-tests\/tests\/|cloudflare\/form-compiler\/test_)/.test(f)),
    workflows: files.filter(f => f.startsWith('.github/workflows/')),
    endpoints: [], clientPaths: [], environmentNames: [], resourceRegistrations: [], parseErrors: [] };
  for (const file of files.filter(f => /^central\/server\/lib\/.*\.js$/.test(f)
    || f === 'central/client/apps/central/src/routes.js' || f === 'cloudflare/worker.js')) {
    try {
      const scanned = scan(fs.readFileSync(path.join(root, file), 'utf8'), file);
      for (const key of Object.keys(scanned)) result[key].push(...scanned[key]);
    } catch (error) { result.parseErrors.push({ file, error: error.message }); }
  }
  result.endpointCollisions = collisions(result.endpoints.filter(e => e.file.includes('/resources/')));
  return result;
};
if (require.main === module) {
  const result = inventory();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.parseErrors.length) process.exitCode = 1;
}
module.exports = { scan, collisions, inventory };
