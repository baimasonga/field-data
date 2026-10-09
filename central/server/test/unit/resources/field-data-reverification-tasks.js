// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { strict: assert } = require('assert');
const { proofFailure } = require('../../../lib/resources/field-data-reverification-tasks');

describe('re-verification closure proof', () => {
  const task = { predicate: 'condition', observationSequence: 1, formId: 7, assigneeId: 42,
    dispatchedAt: '2026-10-09T10:00:00.000Z' };
  const good = { predicate: 'condition', sequence: 2, state: 'known', subDeleted: null, sourceFormId: 7,
    verified: true, origin: 'collected', submitterId: 42, receivedAt: '2026-10-09T10:00:00.001Z' };

  it('accepts evidence that satisfies every condition', () => {
    assert.equal(proofFailure(task, good, false), null);
    assert.equal(proofFailure(task, { ...good, state: 'not-applicable' }, false), null);
  });

  it('names the first failing condition', () => {
    const cases = [
      [null, 'observation-not-on-this-asset'],
      [{ ...good, predicate: 'other' }, 'different-fact'],
      [{ ...good, sequence: 1 }, 'not-newer-than-the-expired-observation'],
      [{ ...good, state: 'unknown' }, 'state-is-not-visit-evidence'],
      [{ ...good, state: 'not-observed' }, 'state-is-not-visit-evidence'],
      [{ ...good, subDeleted: new Date() }, 'source-unavailable'],
      [{ ...good, sourceFormId: 8 }, 'source-unavailable'],
      [{ ...good, verified: false }, 'integrity-unverified'],
      [{ ...good, verified: null }, 'integrity-unverified'],
      [{ ...good, origin: 'imported' }, 'not-collected-in-the-field'],
      [{ ...good, origin: 'api' }, 'not-collected-in-the-field'],
      [{ ...good, origin: null }, 'not-collected-in-the-field'],
      [{ ...good, submitterId: 43 }, 'not-submitted-by-the-assignee'],
      [{ ...good, receivedAt: '2026-10-09T10:00:00.000Z' }, 'received-before-dispatch'],
      [{ ...good, receivedAt: '2026-10-09T09:59:59.999Z' }, 'received-before-dispatch']
    ];
    for (const [evidence, reason] of cases) assert.equal(proofFailure(task, evidence, false), reason);
  });

  it('refuses an observation that already closed another task', () => {
    assert.equal(proofFailure(task, good, true), 'already-closes-another-task');
  });
});
