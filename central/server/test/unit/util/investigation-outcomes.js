const should = require('should');
const { outcomes, lastMonths, median, MAX_COLLECTORS } = require('../../../lib/util/investigation-outcomes');

const now = new Date('2026-10-11T12:00:00Z');
const at = (s) => new Date(s);
const inv = (id, extra) => ({ id, status: 'closed', disposition: 'benign-pattern', openedAt: at('2026-10-01T00:00:00Z'),
  closedAt: at('2026-10-04T06:00:00Z'), reopened: false, ...extra });
const finding = (findingId, investigationId, extra) => ({ findingId, investigationId, family: 'similarity', readable: true, collectors: [1], ...extra });

describe('(util) investigation outcomes', () => {
  it('lists the 12 months up to the current one and takes medians', () => {
    lastMonths(now).should.eql(['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04',
      '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    lastMonths(at('2026-01-31T23:59:59Z'))[0].should.equal('2025-02');
    should.not.exist(median([]));
    median([5, 1, 3]).should.equal(3);
    median([4, 1, 3, 2]).should.equal(2.5);
  });

  it('counts status, dispositions, time to close and months', () => {
    const result = outcomes({ now, names: new Map(), findings: [], investigations: [
      inv('a', { status: 'open', disposition: null, closedAt: null, reopened: true }),
      inv('b', { disposition: 'confirmed-issue' }),
      inv('c', { openedAt: at('2026-08-01T00:00:00Z'), closedAt: at('2026-09-10T00:00:00Z'), reopened: true }),
      inv('d', { openedAt: at('2024-01-01T00:00:00Z'), closedAt: at('2024-02-01T00:00:00Z') })
    ] });
    result.status.should.eql({ open: 1, closed: 3, reopened: 2 });
    result.dispositions.should.eql({ 'confirmed-issue': 1, 'data-error': 0, 'benign-pattern': 2,
      'insufficient-evidence': 0, 'policy-exception': 0, duplicate: 0 });
    result.timeToClose.should.eql({ median: 31, longest: 40 });
    result.months.length.should.equal(12);
    result.months.find((m) => m.month === '2026-10').should.containEql({ 'confirmed-issue': 1, 'benign-pattern': 0 });
    result.months.find((m) => m.month === '2026-09')['benign-pattern'].should.equal(1);
    // A closure before the 12 months is in the totals, not the months.
    result.months.reduce((n, m) => n + m['benign-pattern'] + m['confirmed-issue'], 0).should.equal(2);
    result.generatedAt.should.equal(now.toISOString());
  });

  it('has no time to close or tables when nothing is closed', () => {
    const result = outcomes({ now, names: new Map(), findings: [finding(1, 'a')], investigations: [inv('a', { status: 'open', disposition: null, closedAt: null })] });
    should.not.exist(result.timeToClose);
    result.families.should.eql([]);
    result.collectors.should.eql([]);
    result.hiddenFindings.should.equal(0);
  });

  it('counts a finding once, under the investigation closed most recently', () => {
    const result = outcomes({ now, names: new Map([[1, 'Ada']]), investigations: [
      inv('a', { disposition: 'confirmed-issue', closedAt: at('2026-10-02T00:00:00Z') }),
      inv('b', { disposition: 'data-error', closedAt: at('2026-10-05T00:00:00Z') })
    ], findings: [finding(7, 'b'), finding(7, 'a'), finding(8, 'a', { family: 'contradiction' }), finding(9, 'a', { family: 'nonsense' })] });
    result.families.should.eql([
      { family: 'contradiction', 'confirmed-issue': 1, 'data-error': 0, 'benign-pattern': 0, 'insufficient-evidence': 0, 'policy-exception': 0, duplicate: 0, total: 1 },
      { family: 'similarity', 'confirmed-issue': 0, 'data-error': 1, 'benign-pattern': 0, 'insufficient-evidence': 0, 'policy-exception': 0, duplicate: 0, total: 1 },
      { family: 'other', 'confirmed-issue': 1, 'data-error': 0, 'benign-pattern': 0, 'insufficient-evidence': 0, 'policy-exception': 0, duplicate: 0, total: 1 }
    ]);
    // Ada's submissions are in two distinct closed investigations.
    result.collectors.should.eql([{ actorId: 1, displayName: 'Ada', 'confirmed-issue': 1, 'data-error': 1, 'benign-pattern': 0,
      'insufficient-evidence': 0, 'policy-exception': 0, duplicate: 0, total: 2 }]);
  });

  it('counts both collectors of a pair, unknown submitters, and hides unreadable findings', () => {
    const result = outcomes({ now, names: new Map([[1, 'Ada'], [2, 'Ben']]), investigations: [inv('a'), inv('b', { disposition: 'duplicate' })],
      findings: [
        finding(1, 'a', { collectors: [1, 2] }), finding(2, 'a', { collectors: [1, 1] }),
        finding(3, 'b', { collectors: [null] }), finding(4, 'b', { readable: false, collectors: [] }),
        finding(5, 'open-one', { collectors: [2] })
      ] });
    result.hiddenFindings.should.equal(1);
    result.families[0].total.should.equal(3);
    result.collectors.map((c) => [c.actorId, c.displayName, c.total]).should.eql([[1, 'Ada', 1], [2, 'Ben', 1], [null, null, 1]]);
    result.collectors[2].duplicate.should.equal(1);
  });

  it('keeps at most 200 collectors and says how many were left out', () => {
    const findings = Array.from({ length: MAX_COLLECTORS + 3 }, (_, i) => finding(i + 1, 'a', { collectors: [i + 1] }));
    const result = outcomes({ now, names: new Map(), investigations: [inv('a')], findings });
    result.collectors.length.should.equal(MAX_COLLECTORS);
    result.collectorsOmitted.should.equal(3);
  });
});
