// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const ExcelJS = require('exceljs');
const crypto = require('node:crypto');
const yauzl = require('yauzl');
const { normalizeAdvanced } = require('./advanced-form-builder');
const fail = message => { throw new Error(message); };
const validateArchive = buffer => new Promise((resolve, reject) => {
  yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
    if (error) { reject(error); return; } let bytes = 0; let entries = 0;
    let expanded = 0;
    zip.on('entry', entry => {
      bytes += entry.uncompressedSize; entries += 1;
      if (bytes > 20 * 1024 * 1024 || entries > 500) { zip.close(); reject(new Error('Expanded XLSForm exceeds 20 MB or 500 archive entries.')); return; }
      zip.openReadStream(entry, (streamError, stream) => {
        if (streamError) { zip.close(); reject(streamError); return; }
        stream.on('data', chunk => { expanded += chunk.length; if (expanded > 20 * 1024 * 1024) stream.destroy(new Error('Expanded XLSForm exceeds 20 MB.')); });
        stream.on('error', e => { zip.close(); reject(e); }); stream.on('end', () => zip.readEntry());
      });
    });
    zip.on('error', reject); zip.on('end', resolve); zip.readEntry();
  });
});
const importWorkbook = async buffer => {
  if (buffer.length > 10 * 1024 * 1024) fail('XLSForm exceeds 10 MB.');
  await validateArchive(buffer);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer);
  const read = sheet => {
    if (!sheet) return [];
    const headers = sheet.getRow(1).values.slice(1).map(v => String(v || '').trim());
    if (headers.filter(Boolean).length !== new Set(headers.filter(Boolean)).size) fail('Duplicate column headers cannot be imported.');
    const rows = []; sheet.eachRow((row, index) => {
      if (index === 1) return;
      const result = {}; headers.forEach((header, i) => { const { value } = row.getCell(i + 1); if (value != null && typeof value === 'object') fail('Formula or rich-text cells must be converted to plain values before importing.'); if (header) result[header] = String(value ?? ''); });
      if (Object.values(result).some(Boolean)) rows.push(result);
    }); return rows;
  };
  const survey = read(workbook.getWorksheet('survey')); const choices = read(workbook.getWorksheet('choices')); const settingRows = read(workbook.getWorksheet('settings')); if (settingRows.length > 1) fail('The settings sheet must contain one data row.'); const settings = settingRows[0] || {};
  if (!survey.length) fail('The workbook needs a survey sheet.');
  const lists = {}; const translations = (row, prefix) => Object.fromEntries(Object.entries(row).filter(([k]) => k.startsWith(`${prefix}::`)).map(([k, v]) => [k.slice(prefix.length + 2), v]));
  const choiceKeys = new Set(['list_name', 'name', 'label']);
  choices.forEach(row => { (lists[row.list_name] ||= []).push({ name: row.name, label: row.label || Object.values(translations(row, 'label'))[0] || '', translations: translations(row, 'label'), attributes: Object.fromEntries(Object.entries(row).filter(([k]) => !choiceKeys.has(k) && !k.startsWith('label::'))) }); });
  const mapping = { constraint_message: 'constraintMessage', choice_filter: 'choiceFilter', repeat_count: 'repeatCount' };
  const known = new Set(['type', 'name', 'label', 'hint', 'required', 'relevant', 'constraint', 'calculation', 'appearance', ...Object.keys(mapping)]);
  const questions = []; const stack = [questions];
  for (const row of survey) {
    const type = row.type.replace(/ /g, '_');
    if (/^end_(group|repeat)$/.test(type)) { if (stack.length === 1 || stack[stack.length - 2].at(-1).type !== type.slice(4)) fail('Unbalanced group or repeat.'); stack.pop(); continue; }
    const [base, listName] = row.type.split(/\s+/); const q = { id: crypto.randomUUID(), type: /^begin_(group|repeat)$/.test(type) ? type.slice(6) : base, name: row.name, label: row.label || Object.values(translations(row, 'label'))[0] || '', hint: row.hint || '', translations: translations(row, 'label'), hintTranslations: translations(row, 'hint'), required: row.required === 'yes' || row.required === 'true' ? true : row.required === 'no' || row.required === 'false' ? false : row.required || false,
      xlsExtra: Object.fromEntries(Object.entries(row).filter(([k]) => !known.has(k) && !k.startsWith('label::') && !k.startsWith('hint::'))) };
    ['relevant', 'constraint', 'calculation', 'appearance'].forEach(k => { q[k] = row[k] || ''; }); Object.entries(mapping).forEach(([column, key]) => { q[key] = row[column] || ''; });
    if (base.endsWith('_from_file')) q.sourceFile = listName; else if (base.startsWith('select_')) q.listName = listName;
    stack[stack.length - 1].push(q);
    if (['group', 'repeat'].includes(q.type)) { q.children = []; stack.push(q.children); }
  }
  if (stack.length !== 1) fail('Unbalanced group or repeat.');
  const settingsExtra = Object.fromEntries(Object.entries(settings).filter(([k]) => !['form_title', 'form_id', 'version', 'default_language'].includes(k)));
  const extraSheets = workbook.worksheets.filter(w => !['survey', 'choices', 'settings'].includes(w.name)).map(w => ({ name: w.name, rows: [w.getRow(1).values.slice(1), ...read(w).map(row => w.getRow(1).values.slice(1).map(k => row[k] || ''))] }));
  return normalizeAdvanced({ schemaVersion: 2, title: settings.form_title || settings.form_id || 'Imported form', formId: settings.form_id, version: settings.version, defaultLanguage: settings.default_language, lists, questions, settingsExtra, extraSheets });
};
module.exports = { importWorkbook };
