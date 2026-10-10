// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
//
// Backcheck agreement (O5): the existing backcheck comparisons of a form added
// up by collector and by question. Counts, not estimates.
//
// Contract: docs/field-intelligence/O5-backcheck-agreement.md

const { readForm } = require('./survey-doctor');

const MAX_BACKCHECKS = 500;

// An answer path as the comparison writes it (/group[1]/name[2], perhaps with
// {namespace} prefixes) as the question it answers (/group/name).
const questionOf = (path) => path.replace(/\{[^{}]*\}/g, '').replace(/\[\d+\]/g, '');

// The questions a form version asks, by path below the root, with a label.
const askedQuestions = (xml) => {
  const form = readForm(xml);
  const language = form.languages[0];
  const asked = new Map();
  for (const node of form.nodes.values()) {
    if (node.kind !== 'question') continue; // eslint-disable-line no-continue
    const { text, itextId } = node.label ?? {};
    const translated = itextId == null ? null : form.texts.get(itextId)?.get(language)?.label;
    const label = (text || translated || '').trim() || node.name;
    asked.set(node.path.slice(form.root.length), label);
  }
  return asked;
};

const STATUS = { same: 'agree', changed: 'differ', missingOriginal: 'missing', missingBackcheck: 'missing' };

// One backcheck's compared fields: { question, label, result } where result
// is agree, differ or missing. Unmapped answers and questions the form does
// not ask are left out.
const fieldsOf = (comparison, { mapped, asked }) => comparison.rows.flatMap((row) => {
  const result = STATUS[row.status];
  if (result == null) return [];
  if (mapped) {
    const question = questionOf(row.originalPath);
    const label = row.label?.trim() || asked?.get(question) || question;
    return [{ question: `mapped:${label}`, label, result }];
  }
  const question = questionOf(row.path);
  if (asked == null || !asked.has(question)) return [];
  return [{ question, label: asked.get(question), result }];
});

const share = (part, whole) => (whole === 0 ? 0 : part / whole);
const byName = (a, b) => (a.displayName ?? '').localeCompare(b.displayName ?? '') || a.actorId - b.actorId;

// items: { actorId, displayName, fields } for each compared backcheck.
const aggregate = (items) => {
  const collectors = new Map();
  const questions = new Map();
  for (const { actorId, displayName, fields } of items) {
    const key = actorId ?? 0;
    if (!collectors.has(key)) collectors.set(key, { actorId, displayName, backchecks: 0, withDifferences: 0, fields: 0, different: 0, missing: 0 });
    const collector = collectors.get(key);
    collector.backchecks += 1;
    let differed = false;
    for (const { question, label, result } of fields) {
      if (!questions.has(question)) questions.set(question, { question, label, fields: 0, different: 0, missing: 0 });
      const q = questions.get(question);
      if (result === 'missing') { collector.missing += 1; q.missing += 1; continue; } // eslint-disable-line no-continue
      collector.fields += 1; q.fields += 1;
      if (result === 'differ') { collector.different += 1; q.different += 1; differed = true; }
    }
    if (differed) collector.withDifferences += 1;
  }
  return {
    collectors: [...collectors.values()].sort((a, b) =>
      share(b.withDifferences, b.backchecks) - share(a.withDifferences, a.backchecks) || byName(a, b)),
    questions: [...questions.values()].sort((a, b) =>
      share(b.different, b.fields) - share(a.different, a.fields) || b.fields - a.fields || a.question.localeCompare(b.question))
  };
};

module.exports = { MAX_BACKCHECKS, questionOf, askedQuestions, fieldsOf, aggregate };
