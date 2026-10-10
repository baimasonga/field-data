// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
//
// Helpers for F1 answer-contradiction rules: which questions and operators a
// rule may use, conversion between the editor's rows and the API's
// conditions, and a plain-words description of a condition. The server checks
// every rule again; these only keep the editor from offering what it refuses.

const NUMERIC = new Set(['int', 'decimal']);
const NOT_ANSWERS = new Set(['structure', 'repeat']);

export const OPERATOR_LABELS = {
  '=': 'is', '<>': 'is not', '>': 'is more than', '<': 'is less than', '>=': 'is at least', '<=': 'is at most',
  selected: 'includes', notSelected: 'does not include', empty: 'is blank', notEmpty: 'is answered'
};

const insideRepeat = (path, repeats) => repeats.filter((r) => path.startsWith(`${r}/`)).at(-1) ?? null;

// The form's questions, split by where a rule may use them.
export const formShape = (fields) => {
  const repeats = fields.filter((f) => f.type === 'repeat').map((f) => f.path);
  const answers = fields.filter((f) => f.binary !== true && !NOT_ANSWERS.has(f.type))
    .map((f) => ({ path: f.path, type: f.type, selectMultiple: f.selectMultiple === true, scope: insideRepeat(f.path, repeats) }));
  return {
    top: answers.filter((f) => f.scope == null),
    // Only repeats at the top level can be counted.
    repeats: repeats.filter((r) => insideRepeat(r, repeats) == null),
    inRepeat: (repeat) => answers.filter((f) => f.scope === repeat)
  };
};

export const operatorsFor = (field) => {
  if (field == null) return [];
  if (field.selectMultiple) return ['selected', 'notSelected', 'empty', 'notEmpty'];
  if (NUMERIC.has(field.type)) return ['=', '<>', '>', '<', '>=', '<=', 'empty', 'notEmpty'];
  return ['=', '<>', 'empty', 'notEmpty'];
};
export const COUNT_OPERATORS = ['=', '<>', '>', '<', '>=', '<='];
export const takesValue = (op) => op !== 'empty' && op !== 'notEmpty';
export const canCompareWithQuestion = (op) => takesValue(op) && op !== 'selected' && op !== 'notSelected';

// Questions of the same kind in the same place, for "compare with another question".
export const comparableWith = (field, candidates) => (field == null ? [] : candidates.filter((c) => c.path !== field.path &&
  !c.selectMultiple && NUMERIC.has(c.type) === NUMERIC.has(field.type)));

const blankRow = () => ({ field: '', op: '=', mode: 'value', value: '', otherField: '' });
export const blankCondition = () => ({ kind: 'field', ...blankRow(), repeat: '', where: [] });
export const blankWhere = blankRow;

const rowFrom = (c) => ({
  field: c.field ?? '', op: c.op, mode: c.otherField != null ? 'other' : 'value',
  value: c.value ?? '', otherField: c.otherField ?? ''
});
export const toEditor = (conditions) => conditions.map((c) => (c.count != null
  ? { kind: 'count', ...rowFrom(c), field: '', repeat: c.count.repeat, where: c.count.where.map(rowFrom) }
  : { kind: 'field', ...rowFrom(c), repeat: '', where: [] }));

const target = (row) => {
  if (!takesValue(row.op)) return {};
  return row.mode === 'other' ? { otherField: row.otherField } : { value: row.value };
};
const fromRow = (row) => ({ field: row.field, op: row.op, ...target(row) });
export const fromEditor = (rows) => rows.map((row) => (row.kind === 'count'
  ? { count: { repeat: row.repeat, where: row.where.map(fromRow) }, op: row.op, ...target(row) }
  : fromRow(row)));

// "electricity is none", "member entries where age is at least 18 is not adult_count".
const name = (path) => path?.split('/').filter(Boolean).at(-1) ?? '';
const right = (c) => {
  if (!takesValue(c.op)) return '';
  return ` ${c.otherField != null ? name(c.otherField) : `"${c.value}"`}`;
};
export const describeCondition = (c) => {
  if (c.count != null) {
    const where = c.count.where.length === 0 ? '' : ` where ${c.count.where.map(describeCondition).join(' and ')}`;
    return `number of ${name(c.count.repeat)} entries${where} ${OPERATOR_LABELS[c.op]}${right(c)}`;
  }
  return `${name(c.field)} ${OPERATOR_LABELS[c.op]}${right(c)}`;
};
