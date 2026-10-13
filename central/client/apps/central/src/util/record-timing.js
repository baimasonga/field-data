// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
import { DateTime } from 'luxon';
import { getValue } from './submission';
// A recorded interval, not proof of time spent in the field. Only use named
// datetime metadata fields and timestamps with explicit offsets.
const recordTiming = (submission, fields) => {
  const value = name => {
    const field = fields.find(f => f.name?.toLowerCase() === name && f.type === 'dateTime');
    return field == null ? null : getValue(submission, field);
  };
  const start = value('start'); const end = value('end');
  if (typeof start !== 'string' || typeof end !== 'string' ||
    ![start, end].every(s => /(?:Z|[+-]\d{2}:?\d{2})$/.test(s))) return null;
  const a = DateTime.fromISO(start); const b = DateTime.fromISO(end);
  if (!a.isValid || !b.isValid || b < a) return null;
  return { start, end, seconds: Math.round(b.diff(a, 'seconds').seconds) };
};

export default recordTiming;
