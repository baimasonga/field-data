// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
export const conditionTargets = ['relevant', 'required', 'constraint', 'choiceFilter'];
const operators = ['=', '!=', '>', '>=', '<', '<=', 'selected', '+', '-', '*', 'div'];
const literal = text => {
  if (!text.includes("'")) return `'${text}'`;
  if (!text.includes('"')) return `"${text}"`;
  return `concat(${text.split("'").map(part => `'${part}'`).join(', "\'", ')})`;
};

export const builderCondition = ({ target, field, operator, value, numeric, mode = 'replace', existing, fields = [] }) => {
  if (![...conditionTargets, 'calculation', 'repeatCount'].includes(target) || !operators.includes(operator)) throw new Error('Choose an available expression and comparison.');
  if (field !== '.' && (!fields.includes(field) || !/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(field))) throw new Error('Choose an existing question before applying the condition.');
  if (typeof value !== 'string' || (numeric && !/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(value))) throw new Error('Enter a valid value for the condition.');
  if (!['replace', 'all', 'any'].includes(mode) || (mode !== 'replace' && !conditionTargets.includes(target))) throw new Error('Only conditions can be combined. Replace calculations and repeat counts instead.');
  const left = field === '.' ? '.' : `\${${field}}`;
  const right = numeric ? value : literal(value);
  const condition = operator === 'selected' ? `selected(${left}, ${right})` : `${left} ${operator} ${right}`;
  if (mode === 'replace' || existing == null || existing === false || existing === '') return condition;
  const previous = existing === true || (target === 'required' && existing === 'yes') ? 'true()'
    : target === 'required' && existing === 'no' ? 'false()' : String(existing).trim();
  if (!previous) return condition;
  return `(${previous}) ${mode === 'all' ? 'and' : 'or'} (${condition})`;
};
