// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// Which of a form's answers are worth a chart, and -- on the anonymous path --
// which of them may be shown at all.
//
// Two different questions share this code, and keeping them apart is the whole
// point of the file:
//
//   Readability. A field with about as many distinct answers as submissions is
//   a name, a note or a free-text comment. It makes a chart of one-tall bars,
//   so it is left out. This is a taste judgement and nothing rests on it.
//
//   Disclosure. A bar of height one is one household's answer, whatever the
//   chart around it says. On the authenticated routes that does not matter --
//   the reader holds submission.read and could open the submission itself. On
//   a shared dashboard there is no reader at all, so a value is shown only
//   when enough submissions gave it. That is `minValueCount`, and it is a
//   security control rather than a preference.
//
// The readability rule was doing both jobs before, and it was never good at
// the second: six submissions with five distinct answers passes it, and four
// of those five bars are one person each.

// Past eight bars a chart stops being readable, so the tail becomes one
// "Other" bar. Past twenty-five distinct answers it was never a category.
const MAX_DISTINCT = 25;
const MAX_BARS = 8;
const MAX_FIELDS = 12;

/*
`rows` is one row per (path, value) with a count, already ordered by the
field's position and then by count descending.

Returns the fields worth drawing, each with at most MAX_BARS named values and
possibly one `{ value: null, other, count }` bar standing for the rest.
*/
const chartableFields = (rows, { minValueCount = 1 } = {}) => {
  const byPath = new Map();
  for (const row of rows) {
    if (!byPath.has(row.path))
      byPath.set(row.path, { path: row.path, name: row.name, type: row.type, values: [] });
    byPath.get(row.path).values.push({ value: row.value, count: row.count });
  }

  const fields = [];
  for (const field of byPath.values()) {
    const distinct = field.values.length;
    const answered = field.values.reduce((sum, v) => sum + v.count, 0);
    // Every answer different means free text, not a category.
    if (distinct > MAX_DISTINCT || distinct === answered) continue;
    if (distinct < 2) continue;

    // Values too rare to be an aggregate. Suppressed rather than shown, and
    // folded into the tail so the counts still describe what was answered.
    const shown = field.values.filter(v => v.count >= minValueCount);
    const suppressed = field.values.filter(v => v.count < minValueCount);
    // One surviving bar is not a distribution; it is a statement about
    // everybody else, so the field goes rather than the bar.
    if (shown.length < 2) continue;

    const top = shown.slice(0, MAX_BARS);
    const tail = [...shown.slice(MAX_BARS), ...suppressed];
    const tailCount = tail.reduce((sum, v) => sum + v.count, 0);
    // A single suppressed value alone in the Other bar is that value with a
    // different label on it.
    if (tail.length > 0 && tailCount >= minValueCount)
      top.push({ value: null, other: tail.length, count: tailCount });

    fields.push({ ...field, values: top, distinct, answered });
    if (fields.length === MAX_FIELDS) break;
  }

  return { fields, truncated: byPath.size > fields.length };
};

module.exports = { MAX_DISTINCT, MAX_BARS, MAX_FIELDS, chartableFields };
