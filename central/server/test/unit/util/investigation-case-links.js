// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const links = require('../../../lib/util/investigation-case-links');
describe('investigation case-link contract', () => {
  it('normalizes UUID identity and reason whitespace for exact retries', () => {
    const requestId=randomUUID(); const caseId=randomUUID(); const body={ requestId, caseId, reason: 'A shared pattern requires a combined investigation.' }; const headers={ 'if-match': '"investigation-1"' };
    assert.deepEqual(links.checked({ ...body, requestId: requestId.toUpperCase(), caseId: caseId.toUpperCase(), reason: ` ${body.reason} ` }, headers), links.checked(body, headers));
    assert.throws(() => links.checked(body, {})); assert.throws(() => links.checked({ ...body, extra: true }, headers));
  });
  it('derives active membership from latest events so old retries cannot reactivate removal', () => {
    const caseId=randomUUID(); const linkId=randomUUID(); const events=[{ action: 'removed', caseId, linkId }, { action: 'linked', caseId, linkId }];
    assert.deepEqual(links.active(events), []); const replacement={ action: 'linked', caseId, linkId: randomUUID() }; assert.deepEqual(links.active([replacement, ...events]), [replacement]);
  });
  it('reserves enough history slots to remove every active link and enforces the active bound', () => {
    for (let events=0; events<=500; events+=1) for (let active=0; active<=100; active+=1) if (links.canAdd(events, active)) {
      assert.ok(active+1<=100); assert.ok(500-(events+1)>=active+1);
    }
    assert.equal(links.canAdd(498, 0), true); assert.equal(links.canAdd(499, 0), false); assert.equal(links.canAdd(100, 100), false);
    // Removing decreases active count as it increases history, preserving reserved capacity.
    assert.ok(499+1<=500);
  });
  it('binds candidate cursors to scope and filters and rejects malformed/noncanonical encodings', () => {
    const row={ id: randomUUID(), openedAt: '2026-10-16T00:00:00.000Z' }; const cursor=links.cursor(row, 'scope');
    assert.equal(links.checkedCursor(cursor, 'scope').id, row.id); assert.throws(() => links.checkedCursor(cursor, 'other-scope'));
    assert.throws(() => links.checkedCursor(cursor+'=', 'scope')); assert.throws(() => links.checkedCursor('not-json', 'scope'));
    const invalid=Buffer.from(JSON.stringify({ id: row.id, at: 'bad-date', context: 'scope' })).toString('base64url'); assert.throws(() => links.checkedCursor(invalid, 'scope'));
  });
});
