// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// Raw exports for a filtered dataset. Both formats receive the same resolved
// rows and columns so CSV and Excel cannot disagree about what the saved
// dataset exposes.

const ExcelJS = require('exceljs');
const { stringify } = require('csv-stringify/sync');
const { MAX_REPORT_ROWS } = require('./xls-reports');

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const CSV_MIME = 'text/csv; charset=utf-8';
const METADATA = [
  { key: '_instance_id', label: '_instance_id' },
  { key: '_submitted_at', label: '_submitted_at' }
];

const columnsFor = source => [
  ...METADATA,
  ...source.fields.map(field => ({ key: field.path, label: field.path }))
];

const valueFor = (row, key) => {
  if (key === '_instance_id') return row.instanceId ?? '';
  if (key === '_submitted_at') return row.submittedAt ?? '';
  return row.data?.[key] ?? '';
};

// CSV files are commonly opened in spreadsheet software. Prefix values that
// would otherwise be interpreted as formulas; collected text must never turn
// into an executable spreadsheet expression merely because it was exported.
const csvSafe = (value) => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(value)) return `'${value}`;
  return value;
};

const assertBounded = (rows) => {
  if (rows.length > MAX_REPORT_ROWS)
    throw new Error(`This dataset has more than ${MAX_REPORT_ROWS.toLocaleString('en')} rows. Add filters before exporting it.`);
};

const csvExport = (source, rows) => {
  assertBounded(rows);
  const columns = columnsFor(source);
  const records = rows.map(row => Object.fromEntries(columns.map(column =>
    [column.key, csvSafe(valueFor(row, column.key))])));
  // A UTF-8 BOM keeps Excel from guessing the wrong encoding for names and
  // answers outside ASCII.
  return Buffer.from(`\uFEFF${stringify(records, {
    header: true,
    columns: columns.map(column => ({ key: column.key, header: column.label })),
    record_delimiter: 'windows'
  })}`, 'utf8');
};

const xlsxExport = async (source, rows) => {
  assertBounded(rows);
  const columns = columnsFor(source);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Field Data';
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet('Filtered data');
  worksheet.columns = columns.map(column => ({
    header: column.label,
    key: column.key,
    width: Math.min(Math.max(column.label.length + 2, 14), 48)
  }));
  for (const record of rows) {
    worksheet.addRow(Object.fromEntries(columns.map(column =>
      [column.key, valueFor(record, column.key)])));
  }
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  const header = worksheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF24543D' } };
  return Buffer.from(await workbook.xlsx.writeBuffer());
};

module.exports = {
  CSV_MIME, XLSX_MIME, columnsFor, csvExport, xlsxExport,
  _csvSafe: csvSafe, _assertBounded: assertBounded
};
