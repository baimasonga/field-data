// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { byLoad } = require('./backcheck-allocation');
const validatePolicy = (body) => {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) return null;
  if (Object.keys(body).some(k => !['enabled', 'responseXmlFormId', 'question', 'dueDays', 'maxPending', 'collectorLimits'].includes(k))) return null;
  if (typeof body.enabled !== 'boolean' || typeof body.responseXmlFormId !== 'string' || !body.responseXmlFormId.trim()
    || body.responseXmlFormId.length > 255 || typeof body.question !== 'string' || !body.question.trim() || body.question.length > 1500
    || !Number.isInteger(body.dueDays) || body.dueDays < 1 || body.dueDays > 90
    || !Number.isInteger(body.maxPending) || body.maxPending < 0 || body.maxPending > 100) return null;
  const limits = body.collectorLimits ?? [];
  if (!Array.isArray(limits) || limits.length > 200 || limits.some(l => l == null || typeof l !== 'object' || Array.isArray(l)
    || Object.keys(l).some(k => !['actorId', 'maxPending'].includes(k))
    || !Number.isSafeInteger(l.actorId) || l.actorId < 1 || !Number.isInteger(l.maxPending) || l.maxPending < 0 || l.maxPending > 100)
    || new Set(limits.map(l => l.actorId)).size !== limits.length) return null;
  return { ...body, question: body.question.trim(), collectorLimits: limits };
};
const capacity = (candidate, settings) => settings.collectorLimits.find(l => l.actorId === candidate.id)?.maxPending ?? settings.maxPending;
const choose = (candidates, settings) => [...candidates].filter(c => !c.original && c.pending < capacity(c, settings)).sort(byLoad)[0] ?? null;
module.exports = { validatePolicy, capacity, choose };
