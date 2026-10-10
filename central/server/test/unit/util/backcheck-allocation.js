require('should');
const { suggest } = require('../../../lib/util/backcheck-allocation');

const user = (id, name, pending = 0, overdue = 0, linkedRecently = 0) => ({ id, name, pending, overdue, linkedRecently });

describe('(util) backcheck workload suggestion', () => {
  it('suggests the least loaded collector, never the original one', () => {
    const list = [user(1, 'Aminata', 0), user(2, 'Bockarie', 3), user(3, 'Christiana', 1)];
    const result = suggest(list, 1);
    result.map((a) => [a.id, a.original, a.suggested]).should.eql([[1, true, false], [2, false, false], [3, false, true]]);
    // Order is kept for display.
    result.map((a) => a.name).should.eql(['Aminata', 'Bockarie', 'Christiana']);
  });

  it('breaks ties by overdue, recent links, then name and id', () => {
    suggest([user(1, 'B', 1, 1), user(2, 'A', 1, 0)], null).find((a) => a.suggested).id.should.equal(2);
    suggest([user(1, 'B', 1, 0, 5), user(2, 'C', 1, 0, 2)], null).find((a) => a.suggested).id.should.equal(2);
    suggest([user(5, 'Same'), user(4, 'Same')], null).find((a) => a.suggested).id.should.equal(4);
    suggest([user(7, 'Zainab'), user(8, 'Abu')], null).find((a) => a.suggested).id.should.equal(8);
  });

  it('suggests nobody when the original collector is the only one', () => {
    suggest([user(1, 'Only')], 1).should.eql([{ ...user(1, 'Only'), original: true, suggested: false }]);
    suggest([], 1).should.eql([]);
  });
});
