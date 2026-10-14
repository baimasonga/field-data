// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
export const codeLabel = value => ['visible', 'not-visible', 'unclear'].includes(value) && ({ visible: 'Visible', 'not-visible': 'Not visible', unclear: 'Unclear' })[value];
export const sceneLabel = value => ['supports', 'does-not-support', 'unclear'].includes(value) && ({ supports: 'Supports the claim', 'does-not-support': 'Does not support the claim', unclear: 'Unclear' })[value];
export const validRecords = rows => Array.isArray(rows) && rows.length <= 10 && rows.every((row, index) => row && typeof row.id === 'string' && /^[0-9a-f-]{36}$/i.test(row.id ?? '') &&
  Number.isInteger(row.sequence) && row.sequence > 0 && (index === 0 || row.sequence < rows[index - 1].sequence) &&
  (row.reviewerId == null || (Number.isInteger(row.reviewerId) && row.reviewerId > 0)) && typeof row.reviewerName === 'string' && row.reviewerName.length <= 2000 &&
  typeof row.note === 'string' && row.note.length <= 2000 && codeLabel(row.codeAssessment) && sceneLabel(row.sceneAssessment) &&
  row.reviewedOriginal === true && /^[0-9a-f]{64}$/.test(row.contentHash ?? '') && typeof row.reviewedAt === 'string' && Number.isFinite(Date.parse(row.reviewedAt)));
export const validHistory = data => data && validRecords(data.items) && Number.isInteger(data.omitted) && data.omitted >= 0 &&
  (data.omitted === 0 ? data.nextBefore === null : data.items.length > 0 && data.nextBefore === data.items[data.items.length - 1].sequence);
