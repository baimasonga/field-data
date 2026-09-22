// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

const crypto = require('crypto');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');
const { buildSubmission } = require('../data/odk-reporter');

const MAX_IMPORT_ROWS = 500;
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const SAFE_PATH = /^\/(?:[A-Za-z_][A-Za-z0-9_.-]*)(?:\/[A-Za-z_][A-Za-z0-9_.-]*)*$/;

const under = (path, parent) => path === parent || path.startsWith(`${parent}/`);

const importableFields = (fields) => {
  const repeats = fields.filter(field => field.type === 'repeat').map(field => field.path);
  return fields.filter(field =>
    SAFE_PATH.test(field.path) &&
    field.binary !== true &&
    field.type !== 'repeat' &&
    field.type !== 'structure' &&
    field.path !== '/meta/instanceID' &&
    field.path !== '/meta/deprecatedID' &&
    !repeats.some(repeat => under(field.path, repeat)));
};

const templateCsv = fields => stringify([importableFields(fields).map(field => field.path)], {
  bom: true
});

const validDate = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match == null) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) &&
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() + 1 === Number(match[2]) &&
    date.getUTCDate() === Number(match[3]);
};

const valueProblem = (field, value) => {
  if (value === '') return null;
  switch (field.type) {
    case 'int': return /^-?\d+$/.test(value) ? null : 'must be a whole number';
    case 'decimal':
      return /^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) ? null : 'must be a number';
    case 'date': return validDate(value) ? null : 'must be a date in YYYY-MM-DD format';
    case 'dateTime':
      return !Number.isNaN(Date.parse(value)) && /T/.test(value)
        ? null : 'must be an ISO date and time';
    case 'time':
      return /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-][0-2]\d:[0-5]\d)?$/.test(value)
        ? null : 'must be a time';
    case 'geopoint': {
      const parts = value.trim().split(/\s+/).map(Number);
      return parts.length >= 2 && parts.length <= 4 && parts.every(Number.isFinite) &&
        parts[0] >= -90 && parts[0] <= 90 && parts[1] >= -180 && parts[1] <= 180
        ? null : 'must contain latitude and longitude';
    }
    case 'boolean': return /^(?:true|false|1|0)$/.test(value) ? null : 'must be true or false';
    default: return null;
  }
};

const rowObject = (headers, row) => {
  const root = {};
  for (let i = 0; i < headers.length; i += 1) {
    const parts = headers[i].slice(1).split('/');
    let target = root;
    for (const part of parts.slice(0, -1)) {
      if (target[part] == null) target[part] = {};
      target = target[part];
    }
    target[parts.at(-1)] = row[i] ?? '';
  }
  return root;
};

const validationHash = (buffer, formDefId) => crypto.createHash('sha256')
  .update(buffer).update('\0').update(String(formDefId))
  .digest('hex');

const inspectCsv = (buffer, fields, formDefId) => {
  let records;
  try {
    records = parse(buffer, { bom: true, skip_empty_lines: true, relax_column_count: false });
  } catch (error) {
    return { hash: validationHash(buffer, formDefId), rows: 0, validRows: 0,
      errors: [{ row: null, field: null, message: error.message }], submissions: [] };
  }

  if (records.length === 0) {
    return { hash: validationHash(buffer, formDefId), rows: 0, validRows: 0,
      errors: [{ row: 1, field: null, message: 'The CSV has no header row.' }], submissions: [] };
  }

  const headers = records[0].map(value => String(value).trim());
  const allowed = new Map(importableFields(fields).map(field => [field.path, field]));
  const errors = [];
  if (headers.length === 0 || headers.every(header => header === ''))
    errors.push({ row: 1, field: null, message: 'The CSV has no field paths.' });
  const seen = new Set();
  for (const header of headers) {
    if (header === '') errors.push({ row: 1, field: null, message: 'A header is blank.' });
    else if (seen.has(header)) errors.push({ row: 1, field: header, message: 'The header is duplicated.' });
    else if (!allowed.has(header)) errors.push({ row: 1, field: header,
      message: 'This field cannot be imported or is not in the published Form.' });
    seen.add(header);
  }

  const rows = records.slice(1);
  if (rows.length > MAX_IMPORT_ROWS)
    errors.push({ row: null, field: null, message: `An import may contain at most ${MAX_IMPORT_ROWS} rows.` });
  if (rows.length === 0)
    errors.push({ row: null, field: null, message: 'The CSV has no data rows.' });

  if (errors.some(error => error.row === 1 || error.row == null)) {
    return { hash: validationHash(buffer, formDefId), rows: rows.length, validRows: 0,
      errors, submissions: [] };
  }

  const submissions = [];
  rows.forEach((row, index) => {
    let rowValid = true;
    headers.forEach((header, column) => {
      const problem = valueProblem(allowed.get(header), String(row[column] ?? ''));
      if (problem != null) {
        rowValid = false;
        errors.push({ row: index + 2, field: header, message: problem });
      }
    });
    if (rowValid) submissions.push(rowObject(headers, row));
  });

  return { hash: validationHash(buffer, formDefId), rows: rows.length,
    validRows: submissions.length, errors, submissions };
};

const submissionXml = (form, data) => buildSubmission(form.xmlFormId, form.def.version, data);

module.exports = {
  MAX_IMPORT_ROWS, MAX_IMPORT_BYTES, importableFields, templateCsv, validationHash,
  inspectCsv, submissionXml
};
