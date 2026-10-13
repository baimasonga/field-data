require('should');
const { validatePolicy, choose } = require('../../../lib/util/automatic-backchecks');
const valid = { enabled: true, responseXmlFormId: 'responses', question: 'Verify the visit.', dueDays: 7, maxPending: 2, collectorLimits: [] };
describe('(util) automatic backchecks', () => {
  it('validates capacity policies with bounded independent overrides', () => {
    validatePolicy(valid).question.should.equal('Verify the visit.');
    for (const change of [{ enabled: 1 }, { responseXmlFormId: '' }, { question: '' }, { question: 'x'.repeat(1501) }, { dueDays: 0 },
      { dueDays: 91 }, { maxPending: -1 }, { maxPending: 101 }, { unexpected: 1 }, { collectorLimits: [{ actorId: 1, maxPending: 2 }, { actorId: 1, maxPending: 3 }] },
      { collectorLimits: [{ actorId: 1, maxPending: 1.5 }] }, { collectorLimits: [null] }, { collectorLimits: Array(201).fill({ actorId: 1, maxPending: 1 }) }])
      (validatePolicy({ ...valid, ...change }) == null).should.be.true();
  });
  it('excludes the original collector, respects zero and other overrides, and balances pending load', () => {
    const candidates = [
      { id: 1, name: 'A', original: true, pending: 0, overdue: 0, linkedRecently: 0 },
      { id: 2, name: 'B', original: false, pending: 1, overdue: 0, linkedRecently: 0 },
      { id: 3, name: 'C', original: false, pending: 0, overdue: 0, linkedRecently: 0 }
    ];
    choose(candidates, valid).id.should.equal(3);
    choose(candidates, { ...valid, collectorLimits: [{ actorId: 3, maxPending: 0 }] }).id.should.equal(2);
    (choose(candidates, { ...valid, maxPending: 0 }) == null).should.be.true();
    choose(candidates, { ...valid, maxPending: 0, collectorLimits: [{ actorId: 2, maxPending: 2 }] }).id.should.equal(2);
  });
});
