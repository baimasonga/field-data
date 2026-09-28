// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// The parts of a saved chart widget that are arithmetic rather than SQL:
// validating a definition against the fields its parent actually has, capping
// the number of bars, and saying how much data an answer rests on.
//
// Two things here are deliberate.
//
// A widget reports its denominator. "Mean 4.2" over a field three quarters of
// submissions left blank is not the mean anybody reading it will assume, and
// the number will be quoted in a report long after the caveat is lost. Every
// result carries how many submissions answered out of how many there are.
//
// A widget never quietly truncates. Past eight bars a chart stops being
// readable, so the tail is folded into one "Other" bar that says how many
// categories it stands for -- the same ladder the Summary tab already uses,
// so two charts of the same form do not disagree about what "Other" means.

const { PATH_PATTERN } = require('./filtered-datasets');

const AGGREGATIONS = new Set(['count', 'sum', 'mean', 'median']);
const VIEW_TYPES = new Set(['bar', 'table']);
const NUMERIC_TYPES = new Set(['int', 'decimal']);

// Past this a bar chart is a wall. The Summary tab uses the same number.
const MAX_BARS = 8;
// A field with more distinct answers than this is free text wearing a
// category's clothes, and charting it produces one-tall bars.
const MAX_DISTINCT = 50;

const invalid = (field, value, reason) => Object.assign(new Error(reason), {
  field, value, reason
});

/*
Validate a widget definition against the fields its parent has right now.

`fields` is the parent's field list: every field of the form, or only the
visible columns when the parent is a filtered dataset. Passing the restricted
list is what stops a widget charting a column the dataset was built to hide,
so the caller must pass the right one rather than this function guessing.
*/
const normalizeWidget = (body, fields) => {
  const fieldByPath = new Map(fields
    .filter(field => field.binary !== true && PATH_PATTERN.test(field.path))
    .map(field => [field.path, field]));

  const title = String(body?.title ?? '').trim().slice(0, 255);
  if (title === '') throw invalid('title', body?.title, 'give the chart a title');

  const column = String(body?.column ?? '');
  if (!fieldByPath.has(column))
    throw invalid('column', column, 'must name a field this chart is allowed to read');

  const aggregation = String(body?.aggregation ?? 'count');
  if (!AGGREGATIONS.has(aggregation))
    throw invalid('aggregation', aggregation, 'must be count, sum, mean or median');

  const viewType = String(body?.viewType ?? 'bar');
  if (!VIEW_TYPES.has(viewType))
    throw invalid('viewType', viewType, 'must be bar or table');

  const groupBy = body?.groupBy == null || body.groupBy === ''
    ? null
    : String(body.groupBy);
  if (groupBy != null) {
    if (!fieldByPath.has(groupBy))
      throw invalid('groupBy', groupBy, 'must name a field this chart is allowed to read');
    if (groupBy === column)
      throw invalid('groupBy', groupBy, 'grouping a field by itself charts nothing');
  }

  // Counting needs no second field: the answers are the categories. Summing,
  // averaging or taking a median needs both a number to work on and something
  // to work it out per, and needs the number to be a number.
  if (aggregation === 'count') {
    if (groupBy != null)
      throw invalid('groupBy', groupBy,
        'counting groups by the charted field itself, so it takes no second field');
  } else {
    if (groupBy == null)
      throw invalid('groupBy', null, `${aggregation} needs a field to group by`);
    if (!NUMERIC_TYPES.has(fieldByPath.get(column).type))
      throw invalid('column', column,
        `${aggregation} needs a number; this field is ${fieldByPath.get(column).type}`);
  }

  return {
    title,
    description: body?.description == null ? null : String(body.description).slice(0, 2000),
    column,
    groupBy,
    aggregation,
    viewType,
    columnField: fieldByPath.get(column),
    groupByField: groupBy == null ? null : fieldByPath.get(groupBy)
  };
};

/*
Fold everything past the readable limit into one "Other" row.

Returns the rows to draw plus what was left out, so the caller can say "top 8
of 47 districts" instead of showing eight bars that look like the whole
picture. `rows` must already be ordered with the most significant first.
*/
const capRows = (rows, max = MAX_BARS) => {
  if (rows.length <= max) return { rows, omitted: null };
  const kept = rows.slice(0, max);
  const tail = rows.slice(max);
  return {
    rows: kept,
    omitted: {
      groups: tail.length,
      // Only meaningful for counts; an average of averages would be a lie, so
      // the tail of an aggregated chart reports how many groups it hides and
      // nothing else.
      count: tail.every(row => typeof row.count === 'number')
        ? tail.reduce((sum, row) => sum + row.count, 0)
        : null
    }
  };
};

// Too many distinct answers means the field is free text, and a chart of it
// would be one bar per submission. Said rather than drawn.
const tooManyDistinct = (distinct) => distinct > MAX_DISTINCT;

module.exports = {
  AGGREGATIONS,
  VIEW_TYPES,
  NUMERIC_TYPES,
  MAX_BARS,
  MAX_DISTINCT,
  normalizeWidget,
  capRows,
  tooManyDistinct
};
