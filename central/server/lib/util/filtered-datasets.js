// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// Validation and SQL compilation for saved filtered datasets. User-provided
// operators are mapped through fixed tokens and values remain Slonik
// parameters. XML paths are accepted only after they have been matched to a
// field in the current form definition.

const { sql } = require('slonik');

const PATH_PATTERN = /^\/(?:[A-Za-z_][A-Za-z0-9_.-]*\/)*[A-Za-z_][A-Za-z0-9_.-]*$/;
const OPERATORS = new Set(['=', '<>', '>', '<', '>=', '<=']);
const CONDITIONS = new Set(['AND', 'OR']);
const NUMERIC_TYPES = new Set(['int', 'decimal']);
const NUMERIC_PATTERN = '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$';

const invalid = (field, value, reason) => Object.assign(new Error(reason), {
  field, value, reason
});

const normalizeDefinition = (definition, fields) => {
  const fieldByPath = new Map(fields
    .filter(field => field.binary !== true && PATH_PATTERN.test(field.path))
    .map(field => [field.path, field]));

  if (!Array.isArray(definition?.columns) || definition.columns.length === 0)
    throw invalid('columns', definition?.columns, 'choose at least one field');
  if (definition.columns.length > 100)
    throw invalid('columns', definition.columns.length, 'choose no more than 100 fields');

  const columns = [...new Set(definition.columns.map(path => String(path)))];
  if (columns.length !== definition.columns.length)
    throw invalid('columns', definition.columns, 'must not contain duplicate fields');
  for (const path of columns) {
    if (!fieldByPath.has(path))
      throw invalid('columns', path, 'must name a readable field in the current form definition');
  }

  const givenQuery = definition.query == null ? [] : definition.query;
  if (!Array.isArray(givenQuery))
    throw invalid('query', givenQuery, 'must be an array of filters');
  if (givenQuery.length > 20)
    throw invalid('query', givenQuery.length, 'use no more than 20 filters');

  const query = givenQuery.map((filter, index) => {
    const column = String(filter?.column ?? '');
    const operator = String(filter?.filter ?? '');
    const condition = index === 0 ? 'AND' : String(filter?.condition ?? 'AND').toUpperCase();
    if (!fieldByPath.has(column))
      throw invalid(`query[${index}].column`, column,
        'must name a readable field in the current form definition');
    if (!OPERATORS.has(operator))
      throw invalid(`query[${index}].filter`, operator,
        'must be one of =, <>, >, <, >=, or <=');
    if (!CONDITIONS.has(condition))
      throw invalid(`query[${index}].condition`, condition, 'must be AND or OR');
    if (filter.value == null || typeof filter.value === 'object')
      throw invalid(`query[${index}].value`, filter.value, 'must be a single value');
    return { column, filter: operator, value: String(filter.value), condition };
  });

  return { columns, query, fieldByPath };
};

const textValue = path => sql`extracted ->> ${path}`;

const comparison = (filter, field) => {
  const raw = textValue(filter.column);
  const left = NUMERIC_TYPES.has(field.type)
    ? sql`case when ${raw} ~ ${NUMERIC_PATTERN} then (${raw})::numeric end`
    : raw;
  const right = NUMERIC_TYPES.has(field.type)
    ? sql`case when ${filter.value} ~ ${NUMERIC_PATTERN} then (${filter.value})::numeric end`
    : sql`${filter.value}`;

  switch (filter.filter) {
    case '=': return sql`${left} = ${right}`;
    case '<>': return sql`${left} <> ${right}`;
    case '>': return sql`${left} > ${right}`;
    case '<': return sql`${left} < ${right}`;
    case '>=': return sql`${left} >= ${right}`;
    case '<=': return sql`${left} <= ${right}`;
    default: throw new Error('Unsupported filtered dataset operator.');
  }
};

// Conditions are deliberately evaluated from left to right. The language has
// no grouping or precedence rules; adding those would require a real parser.
const compileFilter = (query, fieldByPath) => {
  if (query.length === 0) return sql`true`;
  let result = comparison(query[0], fieldByPath.get(query[0].column));
  for (let i = 1; i < query.length; i += 1) {
    const next = comparison(query[i], fieldByPath.get(query[i].column));
    result = query[i].condition === 'OR' ? sql`(${result} or ${next})` : sql`(${result} and ${next})`;
  }
  return result;
};

// jsonb_build_object is variadic "any", so Postgres cannot infer the type of a
// bare parameter passed as a key and refuses the whole statement with "could
// not determine data type of parameter". Every parameter reaching it is cast
// explicitly. The xpath argument needs the same treatment for the same reason.
// This only shows up against a real database; it cannot be reproduced against
// a fixture server, which is how it survived three features.
const extractObject = (paths) => sql`jsonb_build_object(${sql.join(paths.flatMap(path => [
  sql`${path}::text`,
  sql`btrim((xpath(${`/*${path}/text()`}::text, sd.xml::xml))[1]::text)`
]), sql`,`)})`;

const projectObject = (columns) => sql`jsonb_build_object(${sql.join(columns.flatMap(path => [
  sql`${path}::text`,
  sql`extracted ->> ${path}::text`
]), sql`,`)})`;

/*
Resolve a stored definition against the form as it is now, without throwing.

Forms get republished, and a republished form can rename or drop a field a
saved dataset refers to. On the editor's paths that is an error worth raising;
on the reader's path it must not be, because the reader cannot fix it and a
validation message written for an editor tells them nothing.

The two kinds of loss are not equally serious, and this is the whole point:

  A missing column is cosmetic. The dataset shows one fewer field.

  A missing filter is a security boundary. The filter is what kept this
  reader's rows narrowed to their district, so dropping it and carrying on
  would widen the result to rows the dataset was built to hide. That fails
  closed instead: `usable` is false and the caller serves nothing.
*/
const resolveStoredDefinition = (definition, fields) => {
  const fieldByPath = new Map(fields
    .filter(field => field.binary !== true && PATH_PATTERN.test(field.path))
    .map(field => [field.path, field]));

  const stored = Array.isArray(definition?.columns) ? definition.columns.map(String) : [];
  const columns = stored.filter(path => fieldByPath.has(path));
  const missingColumns = stored.filter(path => !fieldByPath.has(path));

  const storedQuery = Array.isArray(definition?.query) ? definition.query : [];
  const missingFilters = [...new Set(storedQuery
    .map(filter => String(filter?.column ?? ''))
    .filter(path => !fieldByPath.has(path)))];

  return {
    columns,
    query: storedQuery,
    fieldByPath,
    missingColumns,
    missingFilters,
    // Nothing left to show is as unusable as a filter we cannot honour.
    usable: missingFilters.length === 0 && columns.length > 0
  };
};

module.exports = {
  PATH_PATTERN,
  normalizeDefinition,
  resolveStoredDefinition,
  compileFilter,
  extractObject,
  projectObject
};
