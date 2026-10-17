// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { UUID_PATTERN } = require('./claim-versioning');
const Problem = require('./problem');
const VERSION = 'investigation-backcheck@1';
const MAX_FINDINGS = 20;
const invalid = () => Problem.user.investigationInvalid({ field: 'instrument', reason: 'select 1 to 20 findings, a response form, collector, question and valid revisions' });
// Fixed neutral prompts deliberately exclude recorded answers, identities and peer sources.
const templates = [
  [/^contradiction:/, 'Reported details', 'Ask the respondent to describe the reported details again in their own words. Record any correction, uncertainty or change since the original visit.'],
  [/^identity-(reused|inconsistent):/, 'Shared identity details', 'Confirm which person, household or asset this record describes. Ask whether contact or identity details are legitimately shared, and record corrections without assuming misuse.'],
  [/^near-duplicate$/, 'Similar answers', 'Collect the key survey answers independently without showing the earlier answers. Ask whether a shared visit, household or listing could explain similarities.'],
  [/^(location-accuracy|outside-project-area|repeated-location)$/, 'Visit location', 'Confirm where the visit took place and record a fresh location with its accuracy if consent and safe access permit. Describe legitimate reasons for a shared or uncertain location.'],
  [/^implausible-travel$/, 'Visit timing', 'Confirm the visit date, approximate time and travel sequence. Record clock errors, shared transport or changes to the planned itinerary that could explain the timing.']
];
const suggestion = row => {
  const match = templates.find(([pattern]) => pattern.test(row.rule));
  return match ? { findingId: row.id, ruleVersion: row.ruleVersion, label: match[1], question: match[2] } : null;
};
const checked = (body, headers) => {
  const keys = ['requestId', 'investigationRevision', 'templateVersion', 'findingIds', 'responseXmlFormId', 'assignedTo', 'question', 'dueAt'];
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== keys.length || !keys.every(k => Object.hasOwn(body, k)) ||
    !UUID_PATTERN.test(body.requestId ?? '') || !Number.isInteger(body.investigationRevision) || body.investigationRevision < 1 || body.investigationRevision >= 2147483647 ||
    body.templateVersion !== VERSION || !Array.isArray(body.findingIds) || body.findingIds.length < 1 || body.findingIds.length > MAX_FINDINGS ||
    body.findingIds.some(id => !Number.isSafeInteger(id) || id < 1) || new Set(body.findingIds).size !== body.findingIds.length ||
    typeof body.responseXmlFormId !== 'string' || !body.responseXmlFormId.length || body.responseXmlFormId.length > 255 ||
    !Number.isSafeInteger(body.assignedTo) || body.assignedTo < 1 || typeof body.question !== 'string' || !body.question.trim() || body.question.length > 2000 ||
    (body.dueAt !== null && (typeof body.dueAt !== 'string' || !Number.isFinite(Date.parse(body.dueAt))))) throw invalid();
  if (headers['if-match'] == null) throw Problem.user.reviewRevisionRequired();
  const match = /^"review-case-([1-9]\d{0,9})"$/.exec(headers['if-match']);
  if (!match || Number(match[1]) >= 2147483647) throw invalid();
  return { requestId: body.requestId.toLowerCase(), investigationRevision: body.investigationRevision, templateVersion: VERSION,
    findingIds: [...body.findingIds].sort((a, b) => a - b), responseXmlFormId: body.responseXmlFormId,
    assignedTo: body.assignedTo, question: body.question.trim(), dueAt: body.dueAt === null ? null : new Date(body.dueAt).toISOString(), revision: Number(match[1]) };
};
module.exports = { VERSION, MAX_FINDINGS, suggestion, checked, invalid };
