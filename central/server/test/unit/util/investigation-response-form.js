// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const responseForm = require('../../../lib/util/investigation-response-form');
const instrument = require('../../../lib/util/investigation-instrument');
const { buildWorkbook } = require('../../../lib/util/xlsform-builder');
const selected = rules => rules.map((rule, index) => instrument.suggestion({ id: index + 100, rule, ruleVersion: 1, evidence: { answer: 'SECRET', title: 'Private household' } }));
describe('investigation response-form drafts', () => {
  it('requires consent and keeps verification fields optional without identifiers or old answers', () => {
    const form = responseForm.generate(selected(['contradiction:a', 'identity-reused:b']));
    const consent = form.questions.find(q => q.name === 'visit_consent'); assert.equal(consent.required, true); assert.equal(consent.type, 'select_one');
    assert.deepEqual(form.lists.yes_no.map(c => c.name), ['yes', 'no']);
    for (const question of form.questions.filter(q => ['text', 'date'].includes(q.type))) { assert.equal(question.required, false); assert.equal(question.relevant, "${visit_consent} = 'yes'"); } // eslint-disable-line no-template-curly-in-string
    assert.equal(form.questions.some(q => q.type === 'geopoint'), false);
    const json = JSON.stringify(form); for (const value of ['SECRET', 'Private household', 'findingId', 'ruleVersion', 'contradiction:a']) assert.equal(json.includes(value), false);
  });
  it('deduplicates template questions and gates optional location capture behind separate consent', () => {
    const form = responseForm.generate(selected(['repeated-location', 'outside-project-area', 'near-duplicate']));
    assert.equal(form.questions.filter(q => q.name.startsWith('verification_')).length, 2);
    const location = form.questions.find(q => q.name === 'visit_location'); assert.equal(location.required, false);
    assert.equal(location.relevant, "${visit_consent} = 'yes' and ${location_permission} = 'yes'"); // eslint-disable-line no-template-curly-in-string
    assert.ok(form.questions.length <= 12); assert.notEqual(form.formId, responseForm.generate(selected(['near-duplicate'])).formId);
    assert.equal(form.questions.some(q => ['start-geopoint', 'deviceid', 'image', 'audio'].includes(q.type)), false);
  });
  it('writes a real editable workbook with consent, relevance and safe settings', async () => {
    const form = responseForm.generate(selected(['location-accuracy'])); const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await buildWorkbook(form));
    const rows = workbook.getWorksheet('survey').getSheetValues().slice(2).map(row => row.slice(1));
    assert.ok(rows.some(row => row[1] === 'visit_location' && row[0] === 'geopoint'));
    assert.ok(rows.some(row => row[1] === 'visit_consent' && row.includes('yes')));
    assert.ok(rows.filter(row => String(row[1]).startsWith('verification_')).every(row => row.includes("${visit_consent} = 'yes'"))); // eslint-disable-line no-template-curly-in-string
    assert.ok(workbook.getWorksheet('settings')); assert.ok(workbook.getWorksheet('choices'));
  });
  it('rejects stale-format, duplicate and oversized selection bodies', () => {
    const body = { investigationRevision: 3, caseRevision: 4, templateVersion: instrument.VERSION, findingIds: [2, 1] };
    assert.deepEqual(responseForm.checked(body).findingIds, [1, 2]);
    for (const patch of [{ extra: true }, { caseRevision: 0 }, { investigationRevision: '3' }, { templateVersion: 'other' }, { findingIds: [] }, { findingIds: [1, 1] }, { findingIds: Array.from({ length: 21 }, (_, n) => n + 1) }]) assert.throws(() => responseForm.checked({ ...body, ...patch }));
  });
});
