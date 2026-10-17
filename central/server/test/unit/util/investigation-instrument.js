// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const instrument = require('../../../lib/util/investigation-instrument');
describe('targeted investigation instruments', () => {
  const body = () => ({ requestId: randomUUID(), investigationRevision: 3, templateVersion: instrument.VERSION, findingIds: [2, 1],
    responseXmlFormId: 'verification', assignedTo: 42, question: 'Record an independent account.', dueAt: null });
  const headers = { 'if-match': '"review-case-4"' };
  it('uses neutral templates for supported checks and never echoes finding evidence', () => {
    const rules = ['contradiction:key', 'identity-reused:key', 'identity-inconsistent:key', 'near-duplicate', 'location-accuracy', 'outside-project-area', 'repeated-location', 'implausible-travel'];
    const items = rules.map((rule, id) => instrument.suggestion({ id: id + 1, rule, ruleVersion: 2, evidence: { title: '<private>', answer: 'SECRET' } }));
    assert.ok(items.every(Boolean)); assert.equal(JSON.stringify(items).includes('SECRET'), false); assert.equal(JSON.stringify(items).includes('<private>'), false);
    assert.ok([...new Set(items.map(item => item.question))].join('\n\n').length + 100 < 2000);
    assert.equal(instrument.suggestion({ id: 1, rule: 'unknown' }), null);
  });
  it('normalizes finding order, UUIDs, question whitespace and due instants for exact retries', () => {
    const value = body(); const canonical = instrument.checked(value, headers);
    assert.deepEqual(instrument.checked({ ...value, findingIds: [1, 2], requestId: value.requestId.toUpperCase(), question: ` ${value.question} ` }, headers), canonical);
    assert.deepEqual(canonical.findingIds, [1, 2]);
    assert.equal(instrument.checked({ ...value, dueAt: '2026-10-20T23:59:59Z' }, headers).dueAt, '2026-10-20T23:59:59.000Z');
  });
  it('requires bounded distinct selections, explicit form and template version, and both revisions', () => {
    for (const patch of [{ findingIds: [] }, { findingIds: [1, 1] }, { findingIds: ['1'] }, { findingIds: Array.from({ length: 21 }, (_, i) => i + 1) }, { templateVersion: 'other' }, { responseXmlFormId: '' }, { investigationRevision: 0 }, { question: ' '.repeat(10) }, { dueAt: 'invalid' }, { extra: true }]) assert.throws(() => instrument.checked({ ...body(), ...patch }, headers));
    assert.throws(() => instrument.checked(body(), {})); assert.throws(() => instrument.checked(body(), { 'if-match': '"review-case-0"' }));
  });
});
