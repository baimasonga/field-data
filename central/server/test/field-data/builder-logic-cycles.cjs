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

test('removal impact includes external references to descendants and excludes internal references', async () => {
  const { builderDependencies, builderRemovalImpact } = await helper;
  const group = { id: 'group', name: 'household', children: [
    { id: 'age', name: 'age', relevant: '${household} != 0' },
    { id: 'internal', name: 'internal', calculation: '${age} + 1' }
  ] };
  const questions = [group, { id: 'outside', name: 'outside', calculation: '${age} + ${household}', constraint: '${age} > 0' }];
  const dependencies = builderDependencies(questions);
  assert.deepEqual(builderRemovalImpact(group, dependencies).map(d => [d.id, d.field, d.reference]), [
    ['outside', 'constraint', 'age'], ['outside', 'calculation', 'age'], ['outside', 'calculation', 'household']
  ]);
  assert.equal(builderRemovalImpact(questions[1], dependencies).length, 0);
  const duplicate = { id: 'duplicate', name: 'age' };
  questions.push(duplicate);
  assert.equal(builderRemovalImpact(duplicate, builderDependencies(questions)).length, 3);
});
