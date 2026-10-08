/* eslint-disable no-template-curly-in-string, no-console */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { normalizeFormDefinition, buildWorkbook } = require('../../lib/util/xlsform-builder');
const main = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-browser-'));
  try {
    const definition = normalizeFormDefinition({ schemaVersion: 2, title: 'Browser acceptance', formId: 'browser_acceptance', questions: [
      { type: 'select_one', name: 'district', label: 'District', choices: [{ name: 'north', label: 'North' }, { name: 'south', label: 'South' }], required: true },
      { type: 'repeat', name: 'household', label: 'Household', repeatCount: '2', children: [
        { type: 'integer', name: 'age', label: 'Age', required: true, constraint: '. >= 0', constraintMessage: 'Age must be nonnegative.' },
        { type: 'calculate', name: 'adult', calculation: 'if(${age} >= 18, 1, 0)' },
        { type: 'text', name: 'adult_note', label: 'Adult details', relevant: '${adult} = 1', required: '${age} >= 18' }
      ] }
    ] });
    const workbook = path.join(directory, 'fixture.xlsx'); fs.writeFileSync(workbook, await buildWorkbook(definition));
    const output = process.argv[2]; if (!output) throw new Error('Supply an XML output path.');
    execFileSync(process.env.PYXFORM_PYTHON || 'python3', ['-c', 'import sys; from pyxform.xls2xform import convert; open(sys.argv[2],"w").write(convert(sys.argv[1]).xform)', workbook, output]);
    console.log('Advanced browser fixture compiled with PyXForm.');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
};
main().catch(() => { process.stderr.write('Browser fixture compilation failed.\n'); process.exitCode = 1; });
