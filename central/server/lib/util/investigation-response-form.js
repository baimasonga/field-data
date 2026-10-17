// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { randomUUID } = require('node:crypto');
const instrument = require('./investigation-instrument');
const { normalizeFormDefinition } = require('./xlsform-builder');
const checked = body => {
  const keys = ['investigationRevision', 'caseRevision', 'templateVersion', 'findingIds'];
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== keys.length || !keys.every(key => Object.hasOwn(body, key)) ||
    !['investigationRevision', 'caseRevision'].every(key => Number.isInteger(body[key]) && body[key] > 0 && body[key] < 2147483647) ||
    body.templateVersion !== instrument.VERSION || !Array.isArray(body.findingIds) || body.findingIds.length < 1 || body.findingIds.length > instrument.MAX_FINDINGS ||
    body.findingIds.some(id => !Number.isSafeInteger(id) || id < 1) || new Set(body.findingIds).size !== body.findingIds.length) throw instrument.invalid();
  return { ...body, findingIds: [...body.findingIds].sort((a, b) => a - b) };
};
const generate = suggestions => {
  const prompts = [...new Set(suggestions.map(item => item.question))];
  const accepted = "${visit_consent} = 'yes'"; // eslint-disable-line no-template-curly-in-string
  const question = (name, type, label, extra = {}) => ({ name, type, label, required: false, ...extra });
  const questions = [
    question('visit_introduction', 'note', 'Independent follow-up visit. Explain the purpose, seek consent and record corrections or uncertainty without assuming wrongdoing.'),
    question('visit_consent', 'select_one', 'Does the respondent agree to take part in this follow-up?', { listName: 'yes_no', required: true }),
    question('visit_declined', 'note', 'Participation declined. Do not collect verification answers or location.', { relevant: "${visit_consent} = 'no'" }), // eslint-disable-line no-template-curly-in-string
    question('visit_date', 'date', 'Date of the follow-up visit', { relevant: accepted }),
    ...prompts.map((prompt, index) => question(`verification_${index + 1}`, 'text', prompt, { relevant: accepted, hint: 'Record an independent account. It is acceptable to decline, be uncertain or correct the earlier report.' }))
  ];
  if (suggestions.some(item => item.label === 'Visit location')) questions.push(
    question('location_permission', 'select_one', 'Does the respondent agree to recording a fresh location, and is it safe to do so?', { listName: 'yes_no', relevant: accepted }),
    question('visit_location', 'geopoint', 'Location of the follow-up visit (optional)', { relevant: `${accepted} and \${location_permission} = 'yes'`, hint: 'Skip if unsafe, inaccessible or consent is not given.' })
  );
  questions.push(question('visit_notes', 'text', 'Corrections, uncertainty, legitimate explanations or access limitations', { relevant: accepted }));
  return normalizeFormDefinition({ schemaVersion: 2, formId: `verification_${randomUUID().replace(/-/g, '')}`, title: 'Independent verification', version: '1',
    lists: { yes_no: [{ name: 'yes', label: 'Yes' }, { name: 'no', label: 'No' }] }, questions });
};
module.exports = { checked, generate };
