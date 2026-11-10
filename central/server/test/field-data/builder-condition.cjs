// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const source = readFileSync(resolve(__dirname, '../../../client/apps/central/src/util/builder-condition.js'));
const helper = import(`data:text/javascript;base64,${source.toString('base64')}`);
const options = { target: 'relevant', field: 'age', operator: '>=', value: '18', numeric: true, fields: ['age'], existing: "${eligible} = 'yes' or ${override} = 'yes'" };

test('combines conditions with explicit grouping and preserves replacement behaviour', async () => {
  const { builderCondition } = await helper;
  assert.equal(builderCondition({ ...options, mode: 'all' }), "(${eligible} = 'yes' or ${override} = 'yes') and (${age} >= 18)");
  assert.equal(builderCondition({ ...options, mode: 'any' }), "(${eligible} = 'yes' or ${override} = 'yes') or (${age} >= 18)");
  assert.equal(builderCondition(options), '${age} >= 18');
  assert.equal(builderCondition({ ...options, mode: 'all', existing: '' }), '${age} >= 18');
  for (const target of ['relevant', 'required', 'constraint', 'choiceFilter'])
    assert.equal(builderCondition({ ...options, target, mode: 'all', existing: '. > 0' }), '(. > 0) and (${age} >= 18)');
  assert.equal(builderCondition({ ...options, target: 'required', mode: 'all', existing: false }), '${age} >= 18');
  assert.equal(builderCondition({ ...options, target: 'required', mode: 'all', existing: 'yes' }), '(true()) and (${age} >= 18)');
  assert.equal(builderCondition({ ...options, mode: 'all', target: 'required', existing: true }), '(true()) and (${age} >= 18)');
  assert.equal(builderCondition({ ...options, mode: 'any', target: 'required', existing: 'no' }), '(false()) or (${age} >= 18)');
});

test('quotes literal text and rejects stale fields or unsupported combinations', async () => {
  const { builderCondition } = await helper;
  assert.equal(builderCondition({ ...options, numeric: false, operator: 'selected', value: `He said "don't"` }), `selected(\${age}, concat('He said "don', "'", 't"'))`);
  assert.equal(builderCondition({ ...options, target: 'calculation', operator: '+', value: '1' }), '${age} + 1');
  assert.throws(() => builderCondition({ ...options, fields: [] }), /existing question/);
  assert.throws(() => builderCondition({ ...options, numeric: true, value: '1 or true()' }), /valid value/);
  assert.throws(() => builderCondition({ ...options, target: 'calculation', mode: 'all' }), /Only conditions/);
  assert.throws(() => builderCondition({ ...options, mode: 'bad' }), /Only conditions/);
});
