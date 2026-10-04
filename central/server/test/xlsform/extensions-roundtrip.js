// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
/* eslint-disable no-template-curly-in-string, no-console */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { normalizeAdvanced, buildAdvanced } = require('../../lib/util/advanced-form-builder');
const { importWorkbook } = require('../../lib/util/builder-import');
const { getFormFields } = require('../../lib/data/schema');
const main = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'extensions-roundtrip-'));
  try {
    const original = normalizeAdvanced({ schemaVersion: 2, title: 'Entity authoring', formId: 'entity_authoring', questions: [{ type: 'text', name: 'name', label: 'Name', xlsExtra: { save_to: 'full_name' } }, { type: 'integer', name: 'age', label: 'Age', xlsExtra: { save_to: 'age' } }, { type: 'calculate', name: 'lookup', calculation: "pulldata('households', 'size', 'id', ${name})" }, { type: 'select_one_from_file', name: 'household', label: 'Household', sourceFile: 'households.csv' }], extraSheets: [{ name: 'entities', rows: [['dataset', 'label', 'create_if'], ['people', '${name}', 'true()']] }] });
    const imported = await importWorkbook(await buildAdvanced(original));
    const file = path.join(directory, 'imported.xlsx'); const output = path.join(directory, 'form.xml'); fs.writeFileSync(file, await buildAdvanced(imported));
    execFileSync(process.env.PYXFORM_PYTHON || 'python3', ['-c', 'import sys; from pyxform.xls2xform import convert; open(sys.argv[2],"w").write(convert(sys.argv[1]).xform)', file, output]);
    const xml = fs.readFileSync(output, 'utf8'); const fields = await getFormFields(xml);
    assert.ok(fields.some(f => f.path === '/name' && f.propertyName === 'full_name')); assert.match(xml, /dataset="people"/); assert.match(xml, /jr:\/\/file-csv\/households.csv/); assert.match(xml, /pulldata\(/);
    console.log('Imported XLSForm → PyXForm → Central entity/external-data round trip passed.');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
};
main().catch(error => { console.error(error); process.exitCode = 1; });
