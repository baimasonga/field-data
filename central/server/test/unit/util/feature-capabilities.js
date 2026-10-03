// XLSForm expressions are intentionally literal, never JavaScript interpolation.
/* eslint-disable no-template-curly-in-string */
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { normalizeLayer } = require('../../../lib/util/map-layers');
const { normalizePublication, suppressRelease } = require('../../../lib/util/public-release');
const { normalizeFormDefinition, buildWorkbook } = require('../../../lib/util/xlsform-builder');
const { nextState, normalizePolicy } = require('../../../lib/worker/field-data-operations');
const geo = coordinates => ({ title: 'District', data: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates }, properties: { name: '<img onerror=bad>' } }] } });
describe('(util) new feature boundaries', () => {
  it('validates coordinates, CRS, property limits and fixed bins', () => {
    assert.equal(normalizeLayer(geo([-13.2, 8.4])).data.features[0].properties.name, '<img onerror=bad>');
    assert.throws(() => normalizeLayer(geo([8.4, 190])));
    assert.throws(() => normalizeLayer({ ...geo([1, 1]), data: { ...geo([1, 1]).data, crs: {} } }));
    assert.throws(() => normalizeLayer({ ...geo([1, 1]), style: { mode: 'numeric', property: 'name', bins: [{ max: 10, color: '#112233' }, { max: 5, color: '#112233' }] } }));
  });
  it('withholds the whole public distribution when a cell is rare', () => {
    const c = normalizePublication({ title: 'Public', attribution: 'Test', license: 'CC-BY-4.0', categories: ['A', 'B'], label: 'Choice' });
    assert.deepEqual(suppressRelease([{ value: 'A', count: 20 }, { value: 'B', count: 1 }], c).values, []);
    assert.equal(suppressRelease([{ value: 'A', count: 5 }, { value: 'B', count: 5 }], c).values.length, 2);
    assert.throws(() => suppressRelease([{ value: 'private name', count: 20 }], c));
  });
  it('writes balanced repeat/group rows and multilingual cascading lists', async () => {
    const definition = normalizeFormDefinition({ schemaVersion: 2, title: 'Advanced', formId: 'advanced', lists: { villages: [{ name: 'v1', label: 'Village', attributes: { district: 'north' }, translations: { French: 'Village FR' } }] }, questions: [
      { type: 'text', name: 'district', label: 'District' }, { type: 'repeat', name: 'household', label: 'Household', repeatCount: '2', children: [
        { type: 'integer', name: 'age', label: 'Age', required: '${district} != ""', constraint: '. >= 0', translations: { French: 'Âge' } },
        { type: 'calculate', name: 'adult', calculation: '${age} >= 18' }, { type: 'select_one', name: 'village', label: 'Village', listName: 'villages', choiceFilter: 'district=${district}' }] }] });
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await buildWorkbook(definition));
    const survey = wb.getWorksheet('survey'); assert.ok(survey.getRow(1).values.includes('label::French'));
    assert.equal(survey.getRow(3).getCell(1).value, 'begin_repeat'); assert.equal(survey.getRow(7).getCell(1).value, 'end_repeat');
    assert.ok(wb.getWorksheet('choices').getRow(1).values.includes('district'));
    assert.deepEqual(normalizeFormDefinition(definition), definition);
    assert.throws(() => normalizeFormDefinition({ ...definition, questions: [{ type: 'calculate', name: 'bad', calculation: '${missing}+1' }] }));
  });
  it('deduplicates alerts and emits recovery only after success', () => {
    const failed = { status: 'failed' }; const state = nextState({ failures: 2, alert: false }, failed, 3);
    assert.equal(state.event, 'alert'); assert.equal(nextState(state, failed, 3).event, null);
    assert.equal(nextState(state, { status: 'healthy' }, 3).event, 'recovery');
    assert.throws(() => normalizePolicy({ backupHour: 24 }));
  });
});
