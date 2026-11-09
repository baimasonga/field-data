// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const ExcelJS = require('exceljs');
const { normalizeFormDefinition, buildWorkbook } = require('../../lib/util/xlsform-builder');

const source = readFileSync(resolve(__dirname, '../../../client/apps/central/src/util/builder-uncertainty.js'));
const helper = import(`data:text/javascript;base64,${source.toString('base64')}`);
const question = () => ({ id: 'age', name: 'age', type: 'integer', label: 'Age', required: false, relevant: "${eligible} = 'yes'" });
const nextId = (() => { let n = 0; return () => `q${n += 1}`; })();

test('generates optional explicit assessments and preserves the original answer', async () => {
  const { uncertaintyQuestions } = await helper;
  const original = question(); const before = structuredClone(original);
  const added = uncertaintyQuestions(original, [{ name: 'eligible', type: 'text' }, original], [], nextId);
  assert.deepEqual(original, before);
  assert.deepEqual(added.map(q => q.name), ['unc_age', 'unc_age_note']);
  assert.deepEqual(added[0].choices.map(c => c.name), ['certain', 'estimate', 'unsure', 'declined_answer', 'declined_assessment']);
  assert.equal(added[0].required, false); assert.equal(added[0].relevant, original.relevant);
  assert.match(added[0].constraint, /normalize-space\(\$\{age\}\)/);
  assert.match(added[1].relevant, /\$\{unc_age\}/);
  const definition = normalizeFormDefinition({ schemaVersion: 2, title: 'Survey', formId: 'survey', lists: {}, questions: [
    { id: 'eligible', name: 'eligible', type: 'text', label: 'Eligible' }, original, ...added
  ] });
  const book = new ExcelJS.Workbook(); await book.xlsx.load(await buildWorkbook(definition));
  const survey = book.getWorksheet('survey'); const header = survey.getRow(1).values;
  const row = survey.getRow(4).values; const typeIndex = header.indexOf('type');
  assert.equal(row[typeIndex], 'select_one choices_unc_age');
  assert.match(row[header.indexOf('constraint')], /normalize-space\(\$\{age\}\)/);
  assert.equal(row[header.indexOf('relevant')], "${eligible} = 'yes'");
});

test('refuses unsafe source questions and avoids name or choice-list collisions', async () => {
  const { uncertaintyEligibility, uncertaintyQuestions } = await helper;
  for (const changes of [{ required: true }, { constraint: '. > 0' }, { type: 'calculate' },
    { relevant: '. = 1' }, { relevant: "${age} = 'yes'" }, { relevant: "${AGE} = 'yes'" }, { xlsExtra: { readonly: 'yes' } }])
    assert.ok(uncertaintyEligibility({ ...question(), ...changes }));
  const original = question();
  const eligible = { name: 'eligible', type: 'text' };
  assert.throws(() => uncertaintyQuestions(original, [original, eligible], [], nextId), /earlier/);
  assert.throws(() => uncertaintyQuestions(original, [eligible, original, { type: 'group', children: [{ name: 'AGE' }] }], [], nextId), /unique/);
  const added = uncertaintyQuestions(original, [eligible, original, { name: 'unc_age' }], ['choices_unc_age_2'], nextId);
  assert.equal(added[0].name, 'unc_age_3'); assert.equal(added[1].name, 'unc_age_note_3');
  assert.throws(() => uncertaintyQuestions(original, [eligible, original, ...Array.from({ length: 497 }, (_, i) => ({ name: `q${i}` }))], [], nextId), /room/);
});
