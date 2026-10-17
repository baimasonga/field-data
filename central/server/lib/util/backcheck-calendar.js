// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { byLoad } = require('./backcheck-allocation');
const { capacity } = require('./automatic-backchecks');
const DAY = 86400000;
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const clockMinutes = value => (typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : null);
const validShift = shift => shift === null || (shift != null && typeof shift === 'object' && !Array.isArray(shift)
  && Object.keys(shift).every(k => ['start', 'end', 'endNextDay'].includes(k)) && (shift.endNextDay === undefined || typeof shift.endNextDay === 'boolean') && clockMinutes(shift.start) != null && clockMinutes(shift.end) != null
  && (shift.endNextDay === true ? clockMinutes(shift.end) < clockMinutes(shift.start) : clockMinutes(shift.end) > clockMinutes(shift.start)));
const quotaOn = (calendar, date) => (calendar == null ? null
  : calendar.exceptions.find(e => e.date === date)?.maxVisits ?? calendar.weeklyCapacity[new Date(`${date}T00:00:00Z`).getUTCDay()]);
const shiftOn = (calendar, date) => {
  if (calendar == null) return undefined;
  const exception = calendar.exceptions.find(e => e.date === date);
  const shift = exception?.shift !== undefined ? exception.shift : calendar.weeklyShifts?.[new Date(`${date}T00:00:00Z`).getUTCDay()];
  if (shift == null) return shift;
  const midnight = Date.parse(`${date}T00:00:00Z`);
  return { ...shift, startAt: new Date(midnight + clockMinutes(shift.start) * 60000).toISOString(),
    endAt: new Date(midnight + (clockMinutes(shift.end) + (shift.endNextDay === true ? 1440 : 0)) * 60000).toISOString(),
    minutes: clockMinutes(shift.end) + (shift.endNextDay === true ? 1440 : 0) - clockMinutes(shift.start) };
};
const adjacentDate = (date, offset) => new Date(Date.parse(`${date}T00:00:00Z`) + offset * DAY).toISOString().slice(0, 10);
const overlapping = calendar => {
  const collides = (previous, next) => previous?.endNextDay === true && next != null && clockMinutes(previous.end) > clockMinutes(next.start);
  if (calendar.weeklyShifts?.some((shift, i, shifts) => collides(shift, shifts[(i + 1) % 7]))) return true;
  return calendar.exceptions.some(e => [-1, 0].some(offset => {
    const date = adjacentDate(e.date, offset); if (!validDate(date)) return false;
    const next = adjacentDate(date, 1); if (!validDate(next)) return false;
    const first = shiftOn(calendar, date); const second = shiftOn(calendar, next);
    return first != null && second != null && Date.parse(first.endAt) > Date.parse(second.startAt);
  }));
};
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
  const calendar = { ...(body.weeklyShifts === undefined ? {} : { weeklyShifts: body.weeklyShifts }),
    ...(body.visitMinutes === undefined ? {} : { visitMinutes: body.visitMinutes }), weeklyCapacity: body.weeklyCapacity, exceptions: [...exceptions].sort((a, b) => a.date.localeCompare(b.date)) };
  return overlapping(calendar) ? null : calendar;
};
// Reservations and quota belong to the date the shift starts, including its after-midnight tail.
const slotOnDate = (actorId, calendar, used, date, now, dueAt) => {
  if (calendar == null || !validDate(date) || !Number.isFinite(now.getTime()) || !Number.isFinite(dueAt.getTime()) || dueAt <= now) return null;
  const today = now.toISOString().slice(0, 10);
  if (date < adjacentDate(today, -1) || date > adjacentDate(today, 90) || date > dueAt.toISOString().slice(0, 10)) return null;
  const shift = shiftOn(calendar, date);
  if (shift === null || (date < today && shift?.endNextDay !== true)) return null;
  const reserved = used.get(`${actorId}|${date}`) ?? 0;
  if (reserved >= quotaOn(calendar, date)) return null;
  if (shift !== undefined) {
    const remaining = (Math.min(Date.parse(shift.endAt), dueAt.getTime()) - Math.max(Date.parse(shift.startAt), now.getTime())) / 60000;
    // Charge all reserved/completed visits against the remaining minimum visit-time budget.
    if (remaining < (reserved + 1) * (calendar.visitMinutes ?? 30)) return null;
  }
  return date;
};
const slotFor = (actorId, calendar, used, now, dueAt) => {
  if (calendar == null) return null;
  const from = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const until = Date.parse(`${dueAt.toISOString().slice(0, 10)}T00:00:00Z`);
  for (let at = from - DAY; at <= until && at < from + 91 * DAY; at += DAY) {
    const date = new Date(at).toISOString().slice(0, 10);
    if (slotOnDate(actorId, calendar, used, date, now, dueAt) != null) return date;
  }
  return null;
};
const chooseDated = (candidates, settings, calendars, used, now, dueAt) => candidates
  .filter(c => !c.original && c.pending < capacity(c, settings))
  .map(c => ({ ...c, plannedVisitDate: slotFor(c.id, calendars.get(c.id), used, now, dueAt) }))
  .filter(c => c.plannedVisitDate != null)
  .sort((a, b) => a.plannedVisitDate.localeCompare(b.plannedVisitDate) || byLoad(a, b))[0] ?? null;
module.exports = { clockMinutes, shiftOn, validDate, validateCalendar, quotaOn, slotOnDate, slotFor, chooseDated };
