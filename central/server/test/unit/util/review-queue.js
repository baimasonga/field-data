const { strict: assert } = require('assert');
const { encodeCursor, decodeCursor } = require('../../../lib/util/review-queue');

describe('review queue cursor', () => {
  it('round trips a stable queue position', () => {
    const position = { rank: 2, openedAt: '2026-09-24T10:20:30.000Z',
      id: 'baf4fd24-fc64-422d-91de-35eaf7ad0337' };
    assert.deepEqual(decodeCursor(encodeCursor(position)), position);
  });

  it('rejects malformed and noncanonical cursors', () => {
    for (const value of ['', 'bad', Buffer.from('{}').toString('base64url'),
      encodeCursor({ rank: 2, openedAt: '2026-09-24T10:20:30.000Z',
        id: 'baf4fd24-fc64-422d-91de-35eaf7ad0337' }) + 'x'])
      assert.throws(() => decodeCursor(value), /Invalid review cursor/);
  });
});
