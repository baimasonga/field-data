/* eslint-disable no-template-curly-in-string */
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { normalizeAdvanced, buildAdvanced } = require('../../../lib/util/advanced-form-builder');
const { importWorkbook } = require('../../../lib/util/builder-import');
describe('(util) editable XLSForm import', () => {
  it('preserves repeats, cascade attributes, translations, entity mappings and extra settings', async () => {
    const original = normalizeAdvanced({ schemaVersion: 2, title: 'Import fixture', formId: 'import_fixture', version: '1', defaultLanguage: 'French', settingsExtra: { instance_name: '${name}' }, extraSheets: [{ name: 'entities', rows: [['dataset', 'label', 'create_if'], ['people', '${name}', 'true()']] }], lists: { districts: [{ name: 'north', label: 'North', translations: { French: 'Nord' }, attributes: { region: 'east' } }] }, questions: [{ name: 'name', label: 'Name', type: 'text', xlsExtra: { save_to: 'full_name' }, translations: { French: 'Nom' } }, { name: 'members', label: 'Members', type: 'repeat', repeatCount: '2', children: [{ name: 'age', label: 'Age', type: 'integer', constraint: '. >= 0' }, { name: 'district', label: 'District', type: 'select_one', listName: 'districts', choiceFilter: "region='east'" }] }] });
    const imported = await importWorkbook(await buildAdvanced(original));
    assert.equal(imported.questions[1].children[0].constraint, '. >= 0'); assert.equal(imported.questions[0].xlsExtra.save_to, 'full_name'); assert.equal(imported.settingsExtra.instance_name, '${name}'); assert.deepEqual(imported.extraSheets, original.extraSheets); assert.equal(imported.lists.districts[0].attributes.region, 'east'); assert.equal(imported.questions[0].translations.French, 'Nom');
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await buildAdvanced(imported)); assert.equal(wb.getWorksheet('entities').getRow(2).getCell(1).value, 'people');
  });
  it('refuses formulas instead of silently losing them', async () => {
    const wb = new ExcelJS.Workbook(); const sheet = wb.addWorksheet('survey'); sheet.addRow(['type', 'name', 'label']); sheet.addRow(['text', 'q', { formula: '1+1', result: 2 }]);
    await assert.rejects(importWorkbook(Buffer.from(await wb.xlsx.writeBuffer())), /plain values/);
  });
});
