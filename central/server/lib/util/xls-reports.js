// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// A deliberately small XLSX template language. Excel remains responsible for
// layout and formulas; Field Data only replaces named cells and repeats one
// styled detail row between explicit submission markers.

const ExcelJS = require('exceljs');
const { assertBoundedArchive } = require('./zip-bounds');

const MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_TEMPLATE_BYTES = 10 * 1024 * 1024;
// What the template is allowed to become once opened, which is the number that
// costs memory. A template is a layout, not a data set: a real one inflates to
// a fraction of this, and anything that does not is carrying data it should
// not. See zip-bounds.js for why the compressed limit above is not enough.
const MAX_TEMPLATE_INFLATED_BYTES = 32 * 1024 * 1024;
const MAX_TEMPLATE_PARTS = 512;
const MAX_REPORT_ROWS = 10000;
const START = '{{#submissions}}';
const END = '{{/submissions}}';
const TOKEN = /{{\s*([^{}]+?)\s*}}/g;
const SCALARS = new Set([
  'report_name', 'source_name', 'generated_at', 'submission_count'
]);
const ROW_METADATA = new Set(['_instance_id', '_submitted_at', '_source_form']);

const invalid = (reason) => Object.assign(new Error(reason), { reason });

const cellString = cell => (typeof cell.value === 'string' ? cell.value.trim() : null);

const markerRows = (worksheet) => {
  const starts = [];
  const ends = [];
  worksheet.eachRow((row) => {
    row.eachCell((cell) => {
      const value = cellString(cell);
      if (value === START) starts.push(row.number);
      if (value === END) ends.push(row.number);
    });
  });
  if (starts.length !== ends.length || starts.length > 1)
    throw invalid(`Worksheet “${worksheet.name}” must contain at most one matched submission block.`);
  if (starts.length === 0) return null;
  if (ends[0] !== starts[0] + 2)
    throw invalid(`Worksheet “${worksheet.name}” must have exactly one detail row between ${START} and ${END}.`);
  return { start: starts[0], detail: starts[0] + 1, end: ends[0] };
};

const tokensIn = (value) => {
  if (typeof value !== 'string') return [];
  return [...value.matchAll(TOKEN)].map(match => match[1].trim());
};

const inspectWorkbook = (workbook) => {
  if (workbook.worksheets.length === 0) throw invalid('The workbook has no worksheets.');
  const placeholders = [];
  let blocks = 0;
  for (const worksheet of workbook.worksheets) {
    const block = markerRows(worksheet);
    if (block != null) blocks += 1;
    worksheet.eachRow((row) => row.eachCell((cell) => {
      for (const token of tokensIn(cell.value)) {
        if (token !== '#submissions' && token !== '/submissions') {
          placeholders.push({ token, worksheet: worksheet.name, row: row.number,
            inBlock: block != null && row.number === block.detail });
        }
      }
    }));
  }
  return { blocks, placeholders };
};

const loadWorkbook = async (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0)
    throw invalid('Choose a non-empty .xlsx template.');
  if (buffer.length > MAX_TEMPLATE_BYTES)
    throw invalid('The template is larger than 10 MB.');
  // An XLSX file is a ZIP package. Rejecting obvious impostors here produces
  // an actionable upload error instead of an opaque parser stack trace.
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b)
    throw invalid('The uploaded file is not an .xlsx workbook.');
  // Measured before ExcelJS sees it, because ExcelJS decompresses the whole
  // package into memory and a small upload can be a very large workbook.
  await assertBoundedArchive(buffer, {
    maxTotalBytes: MAX_TEMPLATE_INFLATED_BYTES, maxEntries: MAX_TEMPLATE_PARTS
  });
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch (_) {
    throw invalid('The uploaded .xlsx workbook could not be read.');
  }
  return workbook;
};

const inspectTemplate = async (buffer) => inspectWorkbook(await loadWorkbook(buffer));

const validateTemplate = (inspection, fields) => {
  const allowedFields = new Set(fields.map(field => field.path));
  for (const placeholder of inspection.placeholders) {
    const { token, inBlock } = placeholder;
    if (SCALARS.has(token)) continue;
    if (!inBlock)
      throw invalid(`Row placeholder {{${token}}} must be inside a submissions block.`);
    if (ROW_METADATA.has(token)) continue;
    if (!allowedFields.has(token))
      throw invalid(`Placeholder {{${token}}} is not a readable field in this data source.`);
  }
  return inspection;
};

const valueFor = (token, context) => {
  if (Object.hasOwn(context, token)) return context[token];
  return '';
};

const replaceCell = (cell, context) => {
  if (typeof cell.value !== 'string') return;
  const matches = [...cell.value.matchAll(TOKEN)];
  if (matches.length === 0) return;
  if (matches.length === 1 && matches[0][0] === cell.value) {
    // ExcelJS exposes a mutable cell model by design.
    // eslint-disable-next-line no-param-reassign
    cell.value = valueFor(matches[0][1].trim(), context);
    return;
  }
  // eslint-disable-next-line no-param-reassign
  cell.value = cell.value.replace(TOKEN, (_match, name) => String(valueFor(name.trim(), context)));
};

const replaceRow = (row, context) => row.eachCell({ includeEmpty: true }, cell => {
  replaceCell(cell, context);
});

const renderTemplate = async (buffer, report, rows) => {
  if (!Array.isArray(rows)) throw new TypeError('rows must be an array');
  if (rows.length > MAX_REPORT_ROWS)
    throw invalid(`This report has more than ${MAX_REPORT_ROWS.toLocaleString('en')} rows. Narrow the source before generating it.`);
  const workbook = await loadWorkbook(buffer);
  const generatedAt = report.generatedAt ?? new Date();
  const scalar = {
    report_name: report.name,
    source_name: report.sourceName,
    generated_at: generatedAt instanceof Date ? generatedAt : new Date(generatedAt),
    submission_count: rows.length
  };

  for (const worksheet of workbook.worksheets) {
    const block = markerRows(worksheet);
    // Which rows now hold somebody's answers. The scalar pass below must not
    // touch them: it would be a second substitution over data, and a
    // Submission is allowed to contain braces. An answer of "Ward {{3}}
    // clinic" came out as "Ward  clinic", because an unrecognised token
    // resolves to nothing, and an answer of "{{report_name}}" came out as the
    // report's own name. Silent either way, in the one artifact where silent
    // corruption matters most.
    let filled = null;
    if (block != null) {
      if (rows.length === 0) {
        worksheet.spliceRows(block.start, 3);
      } else {
        // Remove the markers, leaving the styled detail row at `start`.
        worksheet.spliceRows(block.end, 1);
        worksheet.spliceRows(block.start, 1);
        if (rows.length > 1) worksheet.duplicateRow(block.start, rows.length - 1, true);
        rows.forEach((record, index) => replaceRow(worksheet.getRow(block.start + index), {
          ...scalar,
          ...record.data,
          _instance_id: record.instanceId,
          _submitted_at: record.submittedAt,
          _source_form: record.sourceForm ?? ''
        }));
        filled = { from: block.start, to: block.start + rows.length - 1 };
      }
    }
    // The detail rows already had the scalars available to them in the context
    // above, so skipping them here costs nothing.
    worksheet.eachRow((row) => {
      if (filled != null && row.number >= filled.from && row.number <= filled.to) return;
      replaceRow(row, scalar);
    });
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
};

module.exports = {
  MIME_TYPE,
  MAX_TEMPLATE_BYTES,
  MAX_TEMPLATE_INFLATED_BYTES,
  MAX_TEMPLATE_PARTS,
  MAX_REPORT_ROWS,
  inspectTemplate,
  validateTemplate,
  renderTemplate,
  _tokensIn: tokensIn
};
