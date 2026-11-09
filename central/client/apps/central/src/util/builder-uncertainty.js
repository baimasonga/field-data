// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
// Explicit collector-reported uncertainty; this never infers confidence or
// changes the original answer question.
const TYPES = new Set(['text', 'integer', 'decimal', 'date', 'time', 'dateTime', 'select_one', 'select_multiple']);
const validName = name => typeof name === 'string' && /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(name);
const simpleRelevant = /^\$\{([A-Za-z_][A-Za-z0-9_.-]{0,63})\}\s*(?:=|!=)\s*'[A-Za-z0-9_.-]+'$/;

export const uncertaintyEligibility = question => {
  if (!question || !TYPES.has(question.type)) return 'Choose a supported answer question.';
  if (!validName(question.name) || !String(question.label || '').trim()) return 'Give the question a valid name and label first.';
  if (question.required != null && question.required !== false && question.required !== '') return 'Make the original question optional so a respondent can leave it unanswered.';
  if (question.constraint) return 'This question has a constraint. Add the follow-up manually after checking that unanswered responses are allowed.';
  if (question.calculation || question.readonly || Object.entries(question.xlsExtra || {}).some(([key, value]) => key.toLowerCase() === 'readonly' && value)) return 'Calculated or read-only questions are not supported.';
  const condition = question.relevant && simpleRelevant.exec(question.relevant.trim());
  if (question.relevant && (!condition || condition[1].toLowerCase() === question.name.toLowerCase())) return 'Only a simple condition on another question can be copied safely. Add this follow-up manually for other logic.';
  return null;
};

export const uncertaintyQuestions = (question, allQuestions, listNames, newId) => {
  const reason = uncertaintyEligibility(question);
  if (reason) throw new Error(reason);
  const sourceIndex = allQuestions.indexOf(question);
  if (sourceIndex < 0) throw new Error('Choose a top-level question.');
  const condition = question.relevant && simpleRelevant.exec(question.relevant.trim());
  if (condition && !allQuestions.slice(0, sourceIndex).some(q => TYPES.has(q.type) && typeof q.name === 'string' && q.name.toLowerCase() === condition[1].toLowerCase()))
    throw new Error('The condition must refer to an earlier top-level answer question.');
  const names = new Set(); let count = 0; let matchingNames = 0;
  const visit = q => { count += 1; if (typeof q.name === 'string' && q.name) { names.add(q.name.toLowerCase()); if (q.name.toLowerCase() === question.name.toLowerCase()) matchingNames += 1; } (q.children || []).forEach(visit); };
  allQuestions.forEach(visit);
  if (count > 498) throw new Error('The form has no room for two more questions.');
  if (matchingNames !== 1) throw new Error('Question names must be unique before adding a follow-up.');
  const lists = new Set(listNames.map(name => name.toLowerCase()));
  const base = `unc_${question.name.replace(/[^A-Za-z0-9_]/g, '_')}`.slice(0, 40);
  let index = 1; let statusName; let noteName;
  do {
    const suffix = index === 1 ? '' : `_${index}`;
    statusName = `${base}${suffix}`; noteName = `${base}_note${suffix}`; index += 1;
  } while ((names.has(statusName.toLowerCase()) || names.has(noteName.toLowerCase()) || lists.has(`choices_${statusName}`.toLowerCase())) && index <= 1000);
  if (index > 1000) throw new Error('Could not find unique follow-up names.');
  const status = `\${${statusName}}`; const answer = `\${${question.name}}`;
  return [
    {
      id: newId(), type: 'select_one', name: statusName, label: `How certain is the answer to: ${question.label.trim().slice(0, 400)}?`,
      hint: 'Optional. Record the respondent’s own assessment; do not guess.', required: false, relevant: question.relevant || '',
      constraint: `. = 'unsure' or . = 'declined_assessment' or (. = 'declined_answer' and string-length(normalize-space(${answer})) = 0) or ((. = 'certain' or . = 'estimate') and string-length(normalize-space(${answer})) > 0)`,
      constraintMessage: 'Certain or estimate requires an answer; a declined answer must be left blank.',
      choices: [{ name: 'certain', label: 'Certain' }, { name: 'estimate', label: 'Estimate' }, { name: 'unsure', label: 'Unsure or does not know' }, { name: 'declined_answer', label: 'Declined to answer' }, { name: 'declined_assessment', label: 'Declined to describe certainty' }]
    },
    {
      id: newId(), type: 'text', name: noteName, label: 'Optional explanation of uncertainty or missing answer',
      hint: 'Avoid unnecessary personal details.', required: false, relevant: `${status} = 'estimate' or ${status} = 'unsure' or ${status} = 'declined_answer' or ${status} = 'declined_assessment'`
    }
  ];
};
