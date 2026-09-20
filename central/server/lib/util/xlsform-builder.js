// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// A form built in the browser, written out as an XLSForm workbook.
//
// The builder emits a spreadsheet rather than XForm XML on purpose. XLSForm is
// the authoring format, and pyxform -- which already runs in this container on
// 127.0.0.1:5001 -- is what turns it into an XForm. Generating XML here would
// mean reimplementing pyxform's instance, bind and body generation, which is
// exactly where the subtlety lives, and then diverging from it at every
// upstream release.
//
// So what comes out of here goes to POST /projects/:id/forms, the same
// endpoint a person uploading a spreadsheet uses. Validation, publishing,
// versioning and the OpenRosa download ODK Collect uses are all inherited
// rather than rebuilt, and the spreadsheet is a real artifact somebody can
// download and finish in Excel when the builder runs out of road.

const ExcelJS = require('exceljs');

// Names become XML node names, so they take the same shape the rest of this
// codebase requires of a field path segment.
const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

/*
What a question can be, and what XLSForm calls it.

`list` marks the two that need a choice list. Everything else is the same word
in both vocabularies, which is why this table looks redundant: it is the
allowlist, and being explicit is the point. A type absent from here cannot be
smuggled into the `type` column.
*/
const QUESTION_TYPES = {
  text: { xlsform: 'text' },
  integer: { xlsform: 'integer' },
  decimal: { xlsform: 'decimal' },
  date: { xlsform: 'date' },
  time: { xlsform: 'time' },
  dateTime: { xlsform: 'dateTime' },
  select_one: { xlsform: 'select_one', list: true },
  select_multiple: { xlsform: 'select_multiple', list: true },
  note: { xlsform: 'note' },
  geopoint: { xlsform: 'geopoint' },
  image: { xlsform: 'image' }
};

// Names ODK gives meaning to. A question called `instanceID` does not fail
// loudly; it produces a form that behaves strangely once submissions arrive.
const RESERVED_NAMES = new Set([
  'meta', 'instanceid', 'instancename', 'deprecatedid', 'start', 'end', 'today',
  'deviceid', 'subscriberid', 'simserial', 'phonenumber', 'username', 'email',
  'audit', 'data'
]);

const invalid = (field, value, reason) => Object.assign(new Error(reason), {
  field, value, reason
});

const text = (value, limit = 255) => String(value ?? '').trim().slice(0, limit);

const requireName = (field, value, seen) => {
  const name = text(value, 64);
  if (name === '') throw invalid(field, value, 'give it a name');
  if (!NAME_PATTERN.test(name))
    throw invalid(field, name,
      'must start with a letter or underscore and use only letters, digits, underscores, dots and hyphens');
  if (RESERVED_NAMES.has(name.toLowerCase()))
    throw invalid(field, name, 'is a name ODK reserves; choose another');
  if (seen.has(name.toLowerCase()))
    throw invalid(field, name, 'is used twice; every name in a Form must be unique');
  seen.add(name.toLowerCase());
  return name;
};

const normalizeChoices = (question, index) => {
  const given = Array.isArray(question.choices) ? question.choices : [];
  if (given.length === 0)
    throw invalid(`questions[${index}].choices`, given, 'a choice question needs at least one choice');
  if (given.length > 500)
    throw invalid(`questions[${index}].choices`, given.length, 'use no more than 500 choices');

  const seen = new Set();
  return given.map((choice, at) => {
    const name = requireName(`questions[${index}].choices[${at}].name`, choice?.name, seen);
    const label = text(choice?.label);
    if (label === '')
      throw invalid(`questions[${index}].choices[${at}].label`, choice?.label,
        'give the choice a label; it is what somebody reads on the phone');
    return { name, label };
  });
};

const normalizeQuestion = (question, index, seen) => {
  const spec = QUESTION_TYPES[String(question?.type ?? '')];
  if (spec == null)
    throw invalid(`questions[${index}].type`, question?.type,
      `must be one of: ${Object.keys(QUESTION_TYPES).join(', ')}`);

  const name = requireName(`questions[${index}].name`, question?.name, seen);
  const label = text(question?.label, 1000);
  if (label === '')
    throw invalid(`questions[${index}].label`, question?.label,
      'give the question a label; it is what somebody reads on the phone');

  return {
    type: spec.xlsform,
    needsList: spec.list === true,
    name,
    label,
    hint: text(question?.hint, 1000),
    // A note asks nothing, so requiring an answer to it is a form nobody can
    // submit. Refused here rather than at the far end of pyxform.
    required: spec.xlsform !== 'note' && question?.required === true,
    relevant: text(question?.relevant, 500),
    constraint: spec.xlsform === 'note' ? '' : text(question?.constraint, 500),
    constraintMessage: text(question?.constraintMessage, 500),
    appearance: text(question?.appearance, 100),
    choices: spec.list === true ? normalizeChoices(question, index) : null
  };
};

/*
Validate a builder definition, or say exactly what is wrong with it.

Everything here is refused before a workbook is written, because pyxform's
errors are about a spreadsheet somebody never saw and cannot act on.
*/
const normalizeFormDefinition = (body) => {
  const title = text(body?.title);
  if (title === '') throw invalid('title', body?.title, 'give the Form a title');

  const seenTop = new Set();
  // Derived from the title when not given, with the separators trimmed off
  // the ends: this id is what appears in URLs, in the OpenRosa form list and
  // on the QR code a phone is configured from, so "housing_survey_2026_" is a
  // small ugliness in a very visible place.
  const derived = title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const formId = requireName('formId', body?.formId || derived, seenTop);
  // The upload endpoint refuses these, and the message there is about a
  // filename rather than about anything the builder shows.
  if (/\.(xlsx?|xml)$/i.test(formId))
    throw invalid('formId', formId, 'cannot end in .xls, .xlsx or .xml');

  const given = Array.isArray(body?.questions) ? body.questions : [];
  if (given.length === 0)
    throw invalid('questions', given, 'a Form needs at least one question');
  if (given.length > 500)
    throw invalid('questions', given.length, 'use no more than 500 questions');

  const seen = new Set();
  const questions = given.map((question, index) => normalizeQuestion(question, index, seen));

  return {
    formId,
    title,
    // A version that sorts and is obvious in the Form's history.
    version: text(body?.version, 32) || new Date().toISOString().replace(/\D/g, '').slice(0, 14),
    questions
  };
};

const SURVEY_COLUMNS = ['type', 'name', 'label', 'hint', 'required', 'relevant',
  'constraint', 'constraint_message', 'appearance'];

/*
The workbook itself: three sheets, exactly as XLSForm defines them.

Each choice question carries its own list, named after the question. A builder
that made people invent and match list names would be recreating the mistake
it exists to remove; the cost is that two questions offering the same choices
write the list twice, which pyxform does not mind.
*/
const buildWorkbook = async (definition) => {
  const workbook = new ExcelJS.Workbook();

  const survey = workbook.addWorksheet('survey');
  survey.addRow(SURVEY_COLUMNS);
  for (const question of definition.questions) {
    survey.addRow([
      question.needsList ? `${question.type} ${question.name}` : question.type,
      question.name,
      question.label,
      question.hint,
      question.required ? 'yes' : '',
      question.relevant,
      question.constraint,
      question.constraintMessage,
      question.appearance
    ]);
  }

  const choices = workbook.addWorksheet('choices');
  choices.addRow(['list_name', 'name', 'label']);
  for (const question of definition.questions) {
    if (question.choices == null) continue;
    for (const choice of question.choices)
      choices.addRow([question.name, choice.name, choice.label]);
  }

  const settings = workbook.addWorksheet('settings');
  settings.addRow(['form_title', 'form_id', 'version']);
  settings.addRow([definition.title, definition.formId, definition.version]);

  return Buffer.from(await workbook.xlsx.writeBuffer());
};

module.exports = {
  NAME_PATTERN, QUESTION_TYPES, RESERVED_NAMES,
  normalizeFormDefinition, buildWorkbook
};
