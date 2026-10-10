require('should');
const { createHash } = require('crypto');
const { GENESIS, canonical, receiptHash, verifyRun } = require('../../../lib/util/receipts');

const base = { projectId: 1, xmlFormId: 'hh', instanceId: 'uuid:a', submitterId: 7, receivedAt: '2026-10-10T12:00:00.123456Z', contentHash: 'c'.repeat(64) };
// A chain of n receipts.
const chain = (n) => {
  const rows = [];
  let prev = GENESIS;
  for (let seq = 1; seq <= n; seq += 1) {
    const r = { ...base, seq, instanceId: `uuid:${seq}`, prevHash: prev };
    r.entryHash = receiptHash(r);
    rows.push(r);
    prev = r.entryHash;
  }
  return rows;
};

describe('(util) receipt ledger', () => {
  it('hashes a fixed, length-prefixed text', () => {
    const r = { ...base, seq: 1, prevHash: GENESIS };
    canonical(r).should.equal(`receipt@11:11:12:hh6:uuid:a1:727:2026-10-10T12:00:00.123456Z64:${'c'.repeat(64)}64:${GENESIS}`);
    receiptHash(r).should.equal(createHash('sha256').update(canonical(r)).digest('hex'));
    // Lengths are in bytes, so multi-byte text cannot be confused with other fields.
    canonical({ ...r, xmlFormId: 'é' }).should.containEql('2:é');
    // A missing submitter is written as empty, not as "null".
    canonical({ ...r, submitterId: null }).should.containEql('6:uuid:a0:27:');
    receiptHash({ ...r, xmlFormId: 'h', instanceId: 'huuid:a' }).should.not.equal(receiptHash(r));
  });

  it('verifies a chain, also in runs, and finds the first altered, unlinked or missing receipt', () => {
    const rows = chain(6);
    verifyRun(rows).should.eql({ problem: null, last: rows[5] });
    const first = verifyRun(rows.slice(0, 3));
    (verifyRun(rows.slice(3), first.last).problem === null).should.be.true();

    const altered = rows.map((r) => ({ ...r }));
    altered[2].contentHash = 'd'.repeat(64);
    verifyRun(altered).problem.should.eql({ seq: 3, reason: 'altered' });

    const rehashed = rows.map((r) => ({ ...r }));
    rehashed[2].contentHash = 'd'.repeat(64);
    rehashed[2].entryHash = receiptHash(rehashed[2]);
    verifyRun(rehashed).problem.should.eql({ seq: 4, reason: 'broken-link' });

    verifyRun([...rows.slice(0, 2), ...rows.slice(3)]).problem.should.eql({ seq: 3, reason: 'missing' });
    verifyRun(rows.slice(1)).problem.should.eql({ seq: 1, reason: 'missing' });
    verifyRun([]).should.eql({ problem: null, last: { seq: 0, entryHash: GENESIS } });
  });
});
