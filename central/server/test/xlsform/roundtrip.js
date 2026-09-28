// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// Does a Form built in the browser survive the whole way to a phone?
//
// The unit tests assert the workbook's columns, which is a claim about a
// spreadsheet nobody reads. This runs the actual pipeline: builder definition
// -> XLSForm -> pyxform -> XForm -> ODK's own parser, and checks the fields
// that come out the far end are the questions that went in. Those fields are
// what ODK Collect renders, what the OpenRosa form list serves, and what every
// Field Data summary, chart and filtered dataset reads.
//
// pyxform is Python, so this is not in the Node suites. It needs the same
// version the container runs -- see cloudflare/form-compiler/requirements.txt:
//
//   python3 -m venv /tmp/pyxenv && /tmp/pyxenv/bin/pip install pyxform==4.5.0
//   NODE_PATH=node_modules node test/xlsform/roundtrip.js
//
// Run 2026-09-20 against pyxform 4.5.0: nine questions in, nine fields out
// with the right types, plus ODK's own meta/instanceID.

const fs = require('fs');
const { execFileSync } = require('child_process');
const assert = require('assert/strict');
const { normalizeFormDefinition, buildWorkbook } = require('../../lib/util/xlsform-builder');
const { getFormFields } = require('../../lib/data/schema');

const PYTHON = process.env.PYXFORM_PYTHON ?? '/tmp/pyxenv/bin/python';
const XLSX = '/tmp/roundtrip.xlsx';
const XML = '/tmp/roundtrip.xml';

// One of everything the builder offers, plus the features that decide whether
// a Form is usable: a required answer, a constraint, and a relevance
// expression referring to an earlier question.
const DEFINITION = {
  title: 'Housing Survey 2026',
  formId: 'housing_survey_2026',
  version: '2026092001',
  questions: [
    { type: 'text', name: 'respondent', label: 'Respondent name', required: true },
    { type: 'select_one', name: 'district', label: 'District', required: true,
      choices: [{ name: 'bombali', label: 'Bombali' }, { name: 'kambia', label: 'Kambia' }] },
    { type: 'integer', name: 'hh_size', label: 'How many people live here?', required: true,
      constraint: '. > 0', constraintMessage: 'Must be more than zero' },
    { type: 'select_multiple', name: 'water', label: 'Water sources used',
      choices: [{ name: 'well', label: 'Well' }, { name: 'tap', label: 'Piped tap' }] },
    { type: 'integer', name: 'rooms', label: 'How many rooms?', relevant: '${hh_size} > 1' },
    { type: 'decimal', name: 'plot_ha', label: 'Plot size in hectares' },
    { type: 'date', name: 'visited', label: 'Date of visit' },
    { type: 'geopoint', name: 'location', label: 'Location of the house' },
    { type: 'image', name: 'photo', label: 'Photo of the house' },
    { type: 'note', name: 'thanks', label: 'Thank you for your time.' }
  ]
};

const EXPECTED = [
  ['/respondent', 'string'], ['/district', 'string'], ['/hh_size', 'int'],
  ['/water', 'string'], ['/rooms', 'int'], ['/plot_ha', 'decimal'],
  ['/visited', 'date'], ['/location', 'geopoint'], ['/photo', 'binary'],
  ['/thanks', 'string']
];

const main = async () => {
  const definition = normalizeFormDefinition(DEFINITION);
  fs.writeFileSync(XLSX, await buildWorkbook(definition));

  // The real converter, at the version the container pins.
  execFileSync(PYTHON, ['-c', `
from pyxform.xls2xform import convert
result = convert(${JSON.stringify(XLSX)})
open(${JSON.stringify(XML)}, 'w').write(result.xform)
for w in result.warnings: print('pyxform warning:', w[:120])
`], { stdio: 'inherit' });

  const xml = fs.readFileSync(XML, 'utf8');
  const fields = await getFormFields(xml);
  const answers = fields.filter(field => field.type !== 'structure' && !field.path.startsWith('/meta'));

  assert.deepEqual(answers.map(f => [f.path, f.type]), EXPECTED);
  assert.equal(answers.find(f => f.path === '/water').selectMultiple, true,
    'a select_multiple must be flagged, or every reader treats it as one answer');
  assert.equal(answers.find(f => f.path === '/photo').binary, true,
    'an image must be binary, or the summary tries to chart a file');

  // ODK adds these itself. A Form without them cannot be submitted twice.
  assert.ok(fields.some(f => f.path === '/meta/instanceID'), 'no instanceID');

  // The things a Form is unusable without.
  assert.equal((xml.match(/required="true\(\)"/g) ?? []).length, 3, 'required answers');
  assert.match(xml, /constraint="\. &gt; 0"/);
  assert.match(xml, /jr:constraintMsg="Must be more than zero"/);
  assert.match(xml, /relevant="[^"]*hh_size[^"]*&gt; 1"/);
  assert.match(xml, new RegExp(`<data id="${definition.formId}" version="${definition.version}">`));

  console.log(`round trip ok: ${answers.length} questions in, ${answers.length} fields out`);
  for (const field of answers) console.log(`  ${field.path.padEnd(14)} ${field.type}`);
};

main().catch((error) => { console.error('ROUND TRIP FAILED:', error.message); process.exit(1); });
