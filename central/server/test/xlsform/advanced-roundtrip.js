// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
/* eslint-disable no-template-curly-in-string, no-console */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { normalizeFormDefinition, buildWorkbook } = require('../../lib/util/xlsform-builder');
const { getFormFields } = require('../../lib/data/schema');
const main = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'advanced-roundtrip-'));
  try {
    const definition = normalizeFormDefinition({ schemaVersion: 2, title: 'Advanced fixture', formId: 'advanced_fixture', lists: { districts: [{ name: 'north', label: 'North', translations: { French: 'Nord' } }], villages: [{ name: 'v1', label: 'Village', attributes: { district: 'north' } }] }, questions: [
      { type: 'select_one', name: 'district', label: 'District', listName: 'districts' }, { type: 'group', name: 'info', label: 'Info', children: [
        { type: 'repeat', name: 'household', label: 'Household', repeatCount: '2', children: [
          { type: 'integer', name: 'age', label: 'Age', required: true, constraint: '. >= 0', translations: { French: 'Âge' } },
          { type: 'calculate', name: 'adult', calculation: '${age} >= 18' },
          { type: 'select_one', name: 'village', label: 'Village', listName: 'villages', choiceFilter: 'district=${district}', relevant: '${age} >= 18' }
        ] }
      ] }
    ] });
    const xlsx = path.join(directory, 'form.xlsx'); const target = path.join(directory, 'form.xml');
    fs.writeFileSync(xlsx, await buildWorkbook(definition));
    execFileSync(process.env.PYXFORM_PYTHON || 'python3', ['-c', 'import sys; from pyxform.xls2xform import convert; r=convert(sys.argv[1]); open(sys.argv[2], "w").write(r.xform)', xlsx, target]);
    const xml = fs.readFileSync(target, 'utf8'); const fields = await getFormFields(xml);
    assert.ok(fields.some(f => f.path === '/info/household' && f.type === 'repeat'));
    assert.ok(fields.some(f => f.path === '/info/household/age' && f.type === 'int'));
    assert.match(xml, /<repeat nodeset="\/data\/info\/household"/); assert.match(xml, /calculate="[^"\n]*age[^"\n]*18"/);
    assert.match(xml, /itext[^]*Âge/); assert.match(xml, /district[^]*v1/); assert.match(xml, /constraint="\. &gt;= 0"/);
    console.log('Advanced XLSForm → PyXForm → Central parser round trip passed.');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
};
main().catch(error => { console.error(error); process.exitCode = 1; });
