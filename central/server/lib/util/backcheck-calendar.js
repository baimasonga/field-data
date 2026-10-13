// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { byLoad } = require('./backcheck-allocation');
const { capacity } = require('./automatic-backchecks');
const DAY = 86400000;
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const clockMinutes = value => (typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : null);
const validShift = shift => shift === null || (shift != null && typeof shift === 'object' && !Array.isArray(shift)
  && Object.keys(shift).every(k => ['start', 'end'].includes(k)) && clockMinutes(shift.start) != null && clockMinutes(shift.end) != null
  && clockMinutes(shift.end) > clockMinutes(shift.start));
const validateCalendar = body => {
  if (body == null || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(k => !['weeklyCapacity', 'exceptions', 'weeklyShifts', 'visitMinutes'].includes(k))) return null;
  const quota = n => Number.isInteger(n) && n >= 0 && n <= 100;
  if (!Array.isArray(body.weeklyCapacity) || body.weeklyCapacity.length !== 7 || !body.weeklyCapacity.every(quota)) return null;
  if (body.weeklyShifts !== undefined && (!Array.isArray(body.weeklyShifts) || body.weeklyShifts.length !== 7 || !body.weeklyShifts.every(validShift))) return null;
  if (body.visitMinutes !== undefined && (!Number.isInteger(body.visitMinutes) || body.visitMinutes < 1 || body.visitMinutes > 480)) return null;
  const exceptions = body.exceptions ?? [];
  if (!Array.isArray(exceptions) || exceptions.length > 366 || exceptions.some(e => e == null || typeof e !== 'object'
    || Object.keys(e).some(k => !['date', 'maxVisits', 'shift'].includes(k)) || !validDate(e.date) || !quota(e.maxVisits) || (e.shift !== undefined && (body.weeklyShifts === undefined || !validShift(e.shift))))
    || new Set(exceptions.map(e => e.date)).size !== exceptions.length) return null;
  return { ...(body.weeklyShifts === undefined ? {} : { weeklyShifts: body.weeklyShifts }),
    ...(body.visitMinutes === undefined ? {} : { visitMinutes: body.visitMinutes }), weeklyCapacity: body.weeklyCapacity, exceptions: [...exceptions].sort((a, b) => a.date.localeCompare(b.date)) };
};
const quotaOn = (calendar, date) => (calendar == null ? null
  : calendar.exceptions.find(e => e.date === date)?.maxVisits ?? calendar.weeklyCapacity[new Date(`${date}T00:00:00Z`).getUTCDay()]);
const shiftOn = (calendar, date) => {
  if (calendar == null) return undefined;
  const exception = calendar.exceptions.find(e => e.date === date);
  const shift = exception?.shift !== undefined ? exception.shift : calendar.weeklyShifts?.[new Date(`${date}T00:00:00Z`).getUTCDay()];
  if (shift == null) return shift;
  const midnight = Date.parse(`${date}T00:00:00Z`);
  return { ...shift, startAt: new Date(midnight + clockMinutes(shift.start) * 60000).toISOString(),
    endAt: new Date(midnight + clockMinutes(shift.end) * 60000).toISOString(), minutes: clockMinutes(shift.end) - clockMinutes(shift.start) };
};
const slotFor = (actorId, calendar, used, now, dueAt) => {
  if (calendar == null) return null;
  const from = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const until = Date.parse(`${dueAt.toISOString().slice(0, 10)}T00:00:00Z`);
  for (let at = from; at <= until && at < from + 91 * DAY; at += DAY) {
    const date = new Date(at).toISOString().slice(0, 10);
    const reserved = used.get(`${actorId}|${date}`) ?? 0;
    if (reserved >= quotaOn(calendar, date)) continue; // eslint-disable-line no-continue
    const shift = shiftOn(calendar, date);
    if (shift === null) continue; // eslint-disable-line no-continue
    if (shift !== undefined) {
      const remaining = (Math.min(Date.parse(shift.endAt), dueAt.getTime()) - Math.max(Date.parse(shift.startAt), now.getTime())) / 60000;
      // Conservative lower bound: all reserved/completed visits consume the
      // day's minimum visit-time budget. Travel remains a separate review.
      if (remaining < (reserved + 1) * (calendar.visitMinutes ?? 30)) continue; // eslint-disable-line no-continue
    }
    return date;
  }
  return null;
};
const chooseDated = (candidates, settings, calendars, used, now, dueAt) => candidates
  .filter(c => !c.original && c.pending < capacity(c, settings))
  .map(c => ({ ...c, plannedVisitDate: slotFor(c.id, calendars.get(c.id), used, now, dueAt) }))
  .filter(c => c.plannedVisitDate != null)
  .sort((a, b) => a.plannedVisitDate.localeCompare(b.plannedVisitDate) || byLoad(a, b))[0] ?? null;
module.exports = { clockMinutes, shiftOn, validDate, validateCalendar, quotaOn, slotFor, chooseDated };
