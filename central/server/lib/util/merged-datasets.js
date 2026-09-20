// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// Deciding which fields several forms genuinely have in common.
//
// This is the whole difficulty of a merged dataset. Two forms both having a
// field at /data/district does not make it the same field, and merging two
// fields that are not the same produces a table that is quietly wrong --
// which is worse than one that visibly fails, because it gets presented to a
// donor.
//
// So the output is deliberately two lists. What merged, and what did not and
// why. A merge that silently drops four fields is one nobody can check.
//
// What this cannot do, stated here so nobody assumes otherwise: ODK does not
// store a form's declared choice lists in any queryable table. They live in
// the secondary instances of the form XML. So "same path, same type, but 1
// means yes in one form and male in the other" is not detectable from the
// schema, and this module does not pretend to detect it. What it can offer is
// evidence after the fact, from the values submissions actually carry --
// see codingDivergence below, and note that it is evidence, not proof.

const { PATH_PATTERN } = require('./filtered-datasets');

// Reasons a field did not make it into the merge. Each one is a sentence a
// person reads, so they are named rather than numbered.
const EXCLUDED = {
  MISSING: 'missing-from-some-forms',
  TYPE: 'type-differs',
  SELECT: 'select-multiple-differs',
  BINARY: 'binary-field',
  UNSAFE: 'unsafe-path'
};

/*
Intersect the field lists of several forms.

`forms` is [{ formId, xmlFormId, fields: [{ path, name, type, binary,
selectMultiple }] }]. Returns { merged, excluded }, both ordered by path so
two calls with the forms in a different order agree.
*/
const mergeFields = (forms) => {
  if (forms.length === 0) return { merged: [], excluded: [] };

  const byPath = new Map();
  for (const form of forms) {
    for (const field of form.fields) {
      if (!byPath.has(field.path)) byPath.set(field.path, []);
      byPath.get(field.path).push({ ...field, formId: form.formId, xmlFormId: form.xmlFormId });
    }
  }

  const merged = [];
  const excluded = [];
  const add = (path, reason, detail) => excluded.push({ path, reason, detail });

  for (const [path, instances] of [...byPath.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (!PATH_PATTERN.test(path)) {
      add(path, EXCLUDED.UNSAFE, null);
      continue;
    }

    // A field one form does not have cannot be a column of the merge: every
    // row from that form would be blank, which reads as "answered nothing"
    // rather than "was never asked".
    if (instances.length !== forms.length) {
      const has = new Set(instances.map(i => i.xmlFormId));
      add(path, EXCLUDED.MISSING, {
        present: [...has].sort(),
        absent: forms.map(f => f.xmlFormId).filter(id => !has.has(id)).sort()
      });
      continue;
    }

    if (instances.some(i => i.binary === true)) {
      add(path, EXCLUDED.BINARY, null);
      continue;
    }

    // Different types mean one side's values would be coerced, and a coercion
    // that fails on one row in a thousand is exactly the silent wrongness this
    // is trying to avoid.
    const types = [...new Set(instances.map(i => i.type))];
    if (types.length > 1) {
      add(path, EXCLUDED.TYPE, Object.fromEntries(
        instances.map(i => [i.xmlFormId, i.type])
      ));
      continue;
    }

    // A field that takes several answers in one form and one in another is
    // not the same question, whatever it is called.
    const selects = [...new Set(instances.map(i => i.selectMultiple === true))];
    if (selects.length > 1) {
      add(path, EXCLUDED.SELECT, Object.fromEntries(
        instances.map(i => [i.xmlFormId, i.selectMultiple === true])
      ));
      continue;
    }

    merged.push({
      path,
      // Forms may label the same path differently; the first is as good as
      // any and the path is what actually addresses the data.
      name: instances[0].name,
      type: types[0],
      selectMultiple: selects[0]
    });
  }

  return { merged, excluded };
};

/*
Compare the values two or more forms actually submitted for the same path.

This is the closest thing available to the choice-list check that cannot be
done from the schema. Given per-form sets of observed values it reports paths
where the forms share no vocabulary at all -- district recorded as names in
one form and as codes in another, say.

It is evidence and not proof, in both directions. Forms can legitimately have
no values in common (two districts, two rounds), and forms with a genuine
coding clash can still overlap. So the result is something to show a person
before they trust the merge, never a reason to exclude a field automatically.
*/
const codingDivergence = (valuesByForm) => {
  const forms = Object.keys(valuesByForm);
  if (forms.length < 2) return null;

  const sets = forms.map(id => new Set(valuesByForm[id]));
  if (sets.some(set => set.size === 0)) return null;

  const shared = [...sets[0]].filter(value => sets.every(set => set.has(value)));
  if (shared.length > 0) return null;

  return {
    reason: 'no-shared-values',
    samples: Object.fromEntries(forms.map((id, i) => [id, [...sets[i]].slice(0, 5)]))
  };
};

module.exports = { EXCLUDED, mergeFields, codingDivergence };
