// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const ExcelJS = require('exceljs');
const TYPES = new Set(['text', 'integer', 'decimal', 'date', 'time', 'dateTime', 'select_one', 'select_multiple', 'note', 'geopoint', 'image', 'calculate', 'group', 'repeat']);
const fail = (field, reason) => { throw Object.assign(new Error(reason), { field, reason }); };
const txt = (v, limit = 1000) => { const s = String(v ?? ''); if (s.length > limit) fail('text', `Text exceeds ${limit} characters.`); return s; };
const normalizeAdvanced = (body) => {
  if (body.schemaVersion !== 2) fail('schemaVersion', 'Unsupported builder version.');
  const names = new Set(); let count = 0;
  const name = (v) => { const n = txt(v, 64); if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(n) || /^(meta|instanceid|data|start|end|today|deviceid|audit)$/i.test(n)) fail('name', 'Use a valid, nonreserved name.'); if (names.has(n.toLowerCase())) fail('name', 'Question names must be unique.'); names.add(n.toLowerCase()); return n; };
  const translations = (v) => {
    if (v == null) return {};
    if (typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length > 10) fail('translations', 'Use at most 10 named languages.');
    return Object.fromEntries(Object.entries(v).map(([language, label]) => { if (!/^[A-Za-z][A-Za-z0-9 ()_-]{0,40}$/.test(language)) fail('language', 'Invalid language name.'); return [language, txt(label)]; }));
  };
  const choices = (values) => {
    if (!Array.isArray(values) || !values.length || values.length > 500) fail('choices', 'Use 1–500 choices.');
    const seen = new Set();
    return values.map(c => {
      if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(c.name) || seen.has(c.name)) fail('choices', 'Choice names must be valid and unique.'); seen.add(c.name);
      if (!txt(c.label).trim()) fail('choices.label', 'A choice needs a label.');
      const attributes = {};
      for (const [k, v] of Object.entries(c.attributes || {})) { if (!/^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(k) || ['list_name', 'name', 'label', '__proto__', 'constructor', 'prototype'].includes(k)) fail('choice.attributes', 'Invalid filter attribute.'); attributes[k] = txt(v, 255); }
      return { name: c.name, label: txt(c.label), translations: translations(c.translations), attributes };
    });
  };
  const lists = {};
  if (Object.keys(body.lists || {}).length > 50) fail('lists', 'Use at most 50 reusable lists.');
  for (const [key, values] of Object.entries(body.lists || {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) fail('lists', 'Invalid list name.');
    lists[key] = choices(values);
  }
  const walk = (q, depth) => {
    count += 1;
    if (count > 500 || depth > 8) fail('questions', 'Use at most 500 nodes and eight nesting levels.');
    if (!TYPES.has(q.type)) fail('type', 'Unsupported question type.');
    const n = name(q.name); const label = txt(q.label);
    if (q.type !== 'calculate' && !label.trim()) fail(n, 'Give this question a label.');
    const expression = k => { const value = txt(q[k], 2000); if ([...value].some(c => c.charCodeAt(0) < 9)) fail(k, 'Invalid expression characters.'); return value; };
    const required = q.type === 'note' || q.type === 'calculate' || q.type === 'group' ? false : typeof q.required === 'string' ? txt(q.required, 2000) : q.required === true;
    const result = { id: txt(q.id || n, 128), type: q.type, name: n, label, hint: txt(q.hint), translations: translations(q.translations), hintTranslations: translations(q.hintTranslations), required,
      relevant: expression('relevant'), constraint: expression('constraint'), constraintMessage: txt(q.constraintMessage), calculation: expression('calculation'), choiceFilter: expression('choiceFilter'), appearance: txt(q.appearance, 100), repeatCount: expression('repeatCount') };
    if (q.type === 'calculate' && !result.calculation) fail(n, 'A calculation needs an expression.');
    if (q.type === 'group' || q.type === 'repeat') {
      if (!Array.isArray(q.children) || !q.children.length) fail(n, 'Groups and repeats need child questions.');
      result.children = q.children.map(child => walk(child, depth + 1));
    } else if (q.type.startsWith('select_')) {
      if (q.listName) { if (!lists[q.listName]) fail(n, 'Reusable choice list is missing.'); result.listName = q.listName; } else { result.choices = choices(q.choices); result.listName = `choices_${n}`; if (lists[result.listName]) fail(n, 'Generated choice list conflicts with reusable list.'); }
    }
    return result;
  };
  if (!Array.isArray(body.questions) || !body.questions.length) fail('questions', 'A form needs questions.');
  const questions = body.questions.map(q => walk(q, 1));
  const inspect = q => {
    for (const k of ['relevant', 'constraint', 'calculation', 'choiceFilter', 'repeatCount', 'required'])
      for (const ref of String(q[k]).matchAll(/\$\{([^}]+)\}/g)) if (!names.has(ref[1].toLowerCase())) fail(q.name, `Unknown field reference: ${ref[1]}. Repair references after renaming or deleting questions.`);
    q.children?.forEach(inspect);
  };
  questions.forEach(inspect);
  const formId = txt(body.formId || String(body.title).toLowerCase().replace(/[^a-z0-9]+/g, '_'), 64);
  if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(formId) || /\.(xlsx?|xml)$/i.test(formId)) fail('formId', 'Invalid form ID.');
  const title = txt(body.title, 255); if (!title.trim()) fail('title', 'Give the form a title.');
  return { schemaVersion: 2, title, formId, version: txt(body.version || new Date().toISOString().replace(/\D/g, '').slice(0, 14), 32), defaultLanguage: txt(body.defaultLanguage || '', 40), lists, questions };
};
const buildAdvanced = async (d) => {
  const languages = new Set(); const all = [];
  const walk = q => { all.push(q); Object.keys(q.translations).forEach(l => languages.add(l)); Object.keys(q.hintTranslations).forEach(l => languages.add(l)); q.choices?.forEach(c => Object.keys(c.translations).forEach(l => languages.add(l))); q.children?.forEach(walk); };
  d.questions.forEach(walk); Object.values(d.lists).flat().forEach(c => Object.keys(c.translations).forEach(l => languages.add(l)));
  if (d.defaultLanguage && !languages.has(d.defaultLanguage)) fail('defaultLanguage', 'The default language needs translated labels.');
  const langs = [...languages].sort();
  const workbook = new ExcelJS.Workbook(); const survey = workbook.addWorksheet('survey');
  const columns = ['type', 'name', 'label', 'hint', 'required', 'relevant', 'constraint', 'constraint_message', 'calculation', 'choice_filter', 'appearance', 'repeat_count', ...langs.flatMap(l => [`label::${l}`, `hint::${l}`])];
  survey.addRow(columns);
  const row = q => {
    const container = q.type === 'group' || q.type === 'repeat';
    const type = container ? `begin_${q.type}` : q.type.startsWith('select_') ? `${q.type} ${q.listName}` : q.type;
    survey.addRow([type, q.name, q.label, q.hint, q.required === true ? 'yes' : q.required || '', q.relevant, q.constraint, q.constraintMessage, q.calculation, q.choiceFilter, q.appearance, q.repeatCount, ...langs.flatMap(l => [q.translations[l] || q.label, q.hintTranslations[l] || q.hint])]);
    if (container) { q.children.forEach(row); survey.addRow([`end_${q.type}`]); }
  };
  d.questions.forEach(row);
  const lists = { ...d.lists }; all.filter(q => q.choices).forEach(q => { lists[q.listName] = q.choices; });
  const attributes = [...new Set(Object.values(lists).flat().flatMap(c => Object.keys(c.attributes)))].sort();
  const choices = workbook.addWorksheet('choices'); choices.addRow(['list_name', 'name', 'label', ...attributes, ...langs.map(l => `label::${l}`)]);
  for (const [list, values] of Object.entries(lists)) for (const c of values) choices.addRow([list, c.name, c.label, ...attributes.map(k => c.attributes[k] || ''), ...langs.map(l => c.translations[l] || c.label)]);
  const settings = workbook.addWorksheet('settings'); settings.addRow(['form_title', 'form_id', 'version', ...(d.defaultLanguage ? ['default_language'] : [])]); settings.addRow([d.title, d.formId, d.version, ...(d.defaultLanguage ? [d.defaultLanguage] : [])]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
};
module.exports = { normalizeAdvanced, buildAdvanced, TYPES };
