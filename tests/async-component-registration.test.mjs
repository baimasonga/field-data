import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sourceRoot = fileURLToPath(new URL('../central/client/apps/central/src/', import.meta.url));
const loaders = readFileSync(join(sourceRoot, 'util/load-async.js'), 'utf8');
const registered = new Set([...loaders.matchAll(/\.set\('([^']+)'/g)].map(match => match[1]));

const components = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const path = join(directory, entry.name);
  if (entry.isDirectory()) return components(path);
  return entry.name.endsWith('.vue') ? [path] : [];
});

test('every named async component used by a Vue component has a registered loader', () => {
  let checked = 0;
  for (const file of components(join(sourceRoot, 'components'))) {
    for (const [, name] of readFileSync(file, 'utf8').matchAll(/loadAsync\('([^']+)'\)/g)) {
      checked += 1;
      assert.ok(registered.has(name), `${file}: missing loader for ${name}`);
    }
  }
  assert.ok(checked > 0, 'no async component references were checked');
});
