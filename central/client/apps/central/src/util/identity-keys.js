// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
//
// Helpers for F2 identity keys: which questions a key may use, and conversion
// between the editor and the API. The server checks every key again; these
// only keep the editor from offering what it refuses.

const KEY_TYPES = new Set(['string', 'int', 'barcode']);
const SAME_TYPES = new Set(['string', 'int', 'decimal', 'date', 'barcode']);

// The server's own default, shown so a manager can see and edit it.
export const DEFAULT_IGNORE = ['none', 'n/a', 'na', 'null', 'nil', 'unknown', 'refused', 'no phone', '99', '999', '9999', '-'];

const topLevel = (fields) => {
  const repeats = fields.filter((f) => f.type === 'repeat').map((f) => f.path);
  // The form's metadata is not an answer; its instance ID is unique by construction.
  return fields.filter((f) => f.binary !== true && !f.path.startsWith('/meta/') &&
    !repeats.some((r) => f.path.startsWith(`${r}/`)));
};

export const keyQuestions = (fields) => topLevel(fields)
  .filter((f) => KEY_TYPES.has(f.type) && f.selectMultiple !== true);
export const sameQuestions = (fields) => topLevel(fields).filter((f) => SAME_TYPES.has(f.type));

const lines = (text) => text.split('\n').map((line) => line.trim()).filter((line) => line !== '');

export const blankKey = () => ({
  id: null, title: '', explanation: '', benign: '', nextStep: '',
  fields: [{ field: '', match: 'exact' }], sameFields: [], maxUses: 1, windowDays: '',
  ignore: DEFAULT_IGNORE.join('\n'), minLength: 3, alsoIn: []
});

export const toEditor = (key) => ({
  id: key.id, revision: key.revision, active: key.active, title: key.title, explanation: key.explanation,
  benign: key.benignExplanations.join('\n'), nextStep: key.nextStep,
  fields: key.fields.map((f) => ({ ...f })), sameFields: [...key.sameFields], maxUses: key.maxUses,
  windowDays: key.windowDays ?? '', ignore: key.ignoreValues.join('\n'), minLength: key.minLength,
  alsoIn: (key.alsoIn ?? []).map((entry) => ({ xmlFormId: entry.xmlFormId, fields: { ...entry.fields }, sameFields: { ...entry.sameFields } }))
});

export const fromEditor = (e) => ({
  title: e.title, explanation: e.explanation, nextStep: e.nextStep, active: e.active !== false,
  benignExplanations: lines(e.benign),
  fields: e.fields.map(({ field, match }) => ({ field, match })),
  sameFields: e.sameFields,
  maxUses: Number(e.maxUses),
  windowDays: e.windowDays === '' || e.windowDays == null ? null : Number(e.windowDays),
  ignoreValues: lines(e.ignore),
  minLength: Number(e.minLength),
  // Only mapped questions are sent; questions that should stay the same may be left unmapped.
  ...(e.alsoIn.length > 0 ? {
    alsoIn: e.alsoIn.map((entry) => ({
      xmlFormId: entry.xmlFormId,
      fields: Object.fromEntries(e.fields.map(({ field }) => [field, entry.fields[field] || null])),
      sameFields: Object.fromEntries(e.sameFields.filter((p) => entry.sameFields[p]).map((p) => [p, entry.sameFields[p]]))
    }))
  } : {})
});

// "/hh_code (digits only) appears more than once within 30 days"
export const describeKey = (key) => {
  const fields = key.fields.map((f) => (f.match === 'digits' ? `${f.field} (digits only)` : f.field)).join(' + ');
  const uses = key.maxUses === 1 ? 'more than once' : `more than ${key.maxUses} times`;
  const window = key.windowDays == null ? '' : ` within ${key.windowDays} days`;
  const same = key.sameFields.length === 0 ? '' : `, or appears again with a different ${key.sameFields.join(', ')}`;
  const elsewhere = (key.alsoIn ?? []).length === 0 ? '' : ` Also counts uses in ${key.alsoIn.map((a) => a.xmlFormId).join(', ')}.`;
  return `Flags when ${fields} appears ${uses}${window}${same}.${elsewhere}`;
};
