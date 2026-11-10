// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const source = readFileSync(resolve(__dirname, '../../../client/apps/central/src/util/builder-diagnostics.js'));
const helper = import(`data:text/javascript;base64,${source.toString('base64')}`);

test('finds self and multi-question visibility and calculation cycles', async () => {
  const { builderLogicCycles } = await helper;
  const cycles = builderLogicCycles([
    { name: 'a', relevant: "${b} = 'yes'" },
    { name: 'b', calculation: '${a} + 1' },
    { name: 'self', relevant: '${self} = 1' },
    { name: 'safe', calculation: '${a} + 1' }
  ]);
  assert.deepEqual(cycles.map(group => group.map(q => q.path)), [['/a', '/b'], ['/self']]);
});

test('avoids false cycles from constraints, missing or ambiguous names', async () => {
  const { builderLogicCycles } = await helper;
  assert.deepEqual(builderLogicCycles([
    { name: 'a', constraint: '${a} > 0', relevant: '${missing} = 1' },
    { name: 'group', children: [{ name: 'dup', relevant: '${other} = 1' }] },
    { name: 'dup', relevant: '${other} = 1' },
    { name: 'other', relevant: '${dup} = 1' }
  ]), []);
});

test('dependency diagnostics distinguish missing, unique and ambiguous nested targets', async () => {
  const { builderDependencies } = await helper;
  const questions = [
    { id: 'one', name: 'age' },
    { name: 'household', children: [{ id: 'two', name: 'age' }] },
    { id: 'result', name: 'result', calculation: '${age} + ${missing}', required: '${household} != 0' }
  ];
  const dependencies = builderDependencies(questions);
  assert.equal(dependencies.find(d => d.reference === 'age').ambiguous, true);
  assert.deepEqual(dependencies.find(d => d.reference === 'age').targets, [{ id: 'one', path: '/age' }, { id: 'two', path: '/household/age' }]);
  assert.equal(dependencies.find(d => d.reference === 'missing').missing, true);
  assert.equal(dependencies.find(d => d.reference === 'household').ambiguous, false);
  questions[1].children[0].name = 'other_age';
  assert.equal(builderDependencies(questions).find(d => d.reference === 'age').ambiguous, false);
});
