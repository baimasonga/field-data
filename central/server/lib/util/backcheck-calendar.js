// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { byLoad } = require('./backcheck-allocation');
const { capacity } = require('./automatic-backchecks');
const DAY = 86400000;
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const validateCalendar = body => {
  if (body == null || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(k => !['weeklyCapacity', 'exceptions'].includes(k))) return null;
  const quota = n => Number.isInteger(n) && n >= 0 && n <= 100;
  if (!Array.isArray(body.weeklyCapacity) || body.weeklyCapacity.length !== 7 || !body.weeklyCapacity.every(quota)) return null;
  const exceptions = body.exceptions ?? [];
  if (!Array.isArray(exceptions) || exceptions.length > 366 || exceptions.some(e => e == null || typeof e !== 'object'
    || Object.keys(e).some(k => !['date', 'maxVisits'].includes(k)) || !validDate(e.date) || !quota(e.maxVisits))
    || new Set(exceptions.map(e => e.date)).size !== exceptions.length) return null;
  return { weeklyCapacity: body.weeklyCapacity, exceptions: [...exceptions].sort((a, b) => a.date.localeCompare(b.date)) };
};
const quotaOn = (calendar, date) => (calendar == null ? null
  : calendar.exceptions.find(e => e.date === date)?.maxVisits ?? calendar.weeklyCapacity[new Date(`${date}T00:00:00Z`).getUTCDay()]);
const slotFor = (actorId, calendar, used, now, dueAt) => {
  if (calendar == null) return null;
  const from = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const until = Date.parse(`${dueAt.toISOString().slice(0, 10)}T00:00:00Z`);
  for (let at = from; at <= until && at < from + 91 * DAY; at += DAY) {
    const date = new Date(at).toISOString().slice(0, 10);
    if ((used.get(`${actorId}|${date}`) ?? 0) < quotaOn(calendar, date)) return date;
  }
  return null;
};
const chooseDated = (candidates, settings, calendars, used, now, dueAt) => candidates
  .filter(c => !c.original && c.pending < capacity(c, settings))
  .map(c => ({ ...c, plannedVisitDate: slotFor(c.id, calendars.get(c.id), used, now, dueAt) }))
  .filter(c => c.plannedVisitDate != null)
  .sort((a, b) => a.plannedVisitDate.localeCompare(b.plannedVisitDate) || byLoad(a, b))[0] ?? null;
module.exports = { validDate, validateCalendar, quotaOn, slotFor, chooseDated };
