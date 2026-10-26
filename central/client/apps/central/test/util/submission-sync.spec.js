import { submissionRetryAfter, submissionRetryDelay } from '../../src/util/submission-sync';

describe('encrypted offline submissions automatic retry policy', () => {
  it('uses bounded increasing jittered delays and stops after five retries', () => {
    const failure = { retryable: true };
    [0, 1, 2, 3, 4].map(attempt => submissionRetryDelay(failure, attempt, () => 0)).should.eql([5000, 15000, 60000, 120000, 300000]);
    submissionRetryDelay(failure, 0, () => 1).should.equal(6000);
    should.equal(submissionRetryDelay(failure, 5), null);
    should.equal(submissionRetryDelay(failure, -1), null);
    should.equal(submissionRetryDelay(failure, 0.5), null);
  });
  it('never retries unclassified local/storage failures, permanent responses or excessive server waits', () => {
    for (const failure of [{}, { retryable: false }, { retryable: true, retryAfterMs: null }, { retryable: true, retryAfterMs: 3600001 }])
      should.equal(submissionRetryDelay(failure, 0), null);
  });
  it('honors delta seconds and HTTP-date Retry-After without shortening a server pause', () => {
    const now = Date.parse('2026-10-26T00:00:00Z');
    submissionRetryAfter('30', now).should.equal(30000);
    submissionRetryAfter('Mon, 26 Oct 2026 00:02:00 GMT', now).should.equal(120000);
    submissionRetryAfter('Mon, 26 Oct 2026 00:02:00 GMT', now + 3600000, 'Mon, 26 Oct 2026 00:00:00 GMT').should.equal(120000);
    submissionRetryAfter('Mon, 26 Oct 2026 00:00:00 GMT', now + 1000).should.equal(0);
    submissionRetryAfter('invalid', now).should.equal(0);
    should.equal(submissionRetryAfter('3601', now), null);
    submissionRetryDelay({ retryable: true, retryAfterMs: 120000 }, 0, () => 0).should.equal(120000);
  });
});
