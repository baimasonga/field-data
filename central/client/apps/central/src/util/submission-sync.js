// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const intervals = [5000, 15000, 60000, 120000, 300000];
// null means stop automatic delivery. Retry-After is never shortened.
export const submissionRetryAfter = (value, now = Date.now(), serverDate = null) => {
  if (value == null || value === '') return 0;
  let delay;
  if (/^\d+$/.test(value)) delay = Number(value) * 1000;
  else {
    const time = Date.parse(value); const serverNow = Date.parse(serverDate);
    if (!Number.isFinite(time)) return 0;
    delay = Math.max(0, time - (Number.isFinite(serverNow) ? serverNow : now));
  }
  return Number.isFinite(delay) && delay <= 3600000 ? delay : null;
};
export const submissionRetryDelay = (failure, retry, random = Math.random) => {
  if (failure?.retryable !== true || !Number.isInteger(retry) || retry < 0 || retry >= intervals.length || failure.retryAfterMs === null) return null;
  const serverDelay = failure.retryAfterMs ?? 0;
  if (!Number.isFinite(serverDelay) || serverDelay < 0 || serverDelay > 3600000) return null;
  return Math.max(serverDelay, Math.ceil(intervals[retry] * (1 + Math.max(0, Math.min(1, random())) * 0.2)));
};
