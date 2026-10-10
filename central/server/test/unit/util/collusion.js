require('should');
const { LIMITS, familyOf, buildGroups } = require('../../../lib/util/collusion');

let next = 0;
const link = (a, b, rule = 'near-duplicate', extra = {}) => {
  next += 1;
  return { findingId: next, a, b, rule, xmlFormId: 'hh', formName: 'Households', instanceId: `i${next}`, relatedInstanceId: `r${next}`, ...extra };
};
const times = (n, f) => Array.from({ length: n }, f);

describe('(util) collusion groups', () => {
  it('counts pair findings by rule family, ignoring other rules', () => {
    familyOf('near-duplicate').should.equal('near-duplicate');
    familyOf('repeated-location').should.equal('repeated-location');
    familyOf('identity-reused:abc').should.equal('identity');
    (familyOf('identity-inconsistent:abc') === null).should.be.true();
    (familyOf('implausible-travel') === null).should.be.true();
  });

  it('connects collectors with enough links between them, never one collector with themselves', () => {
    const links = [
      ...times(2, () => link(1, 2)), link(2, 1, 'identity-reused:k1'),
      ...times(2, () => link(3, 4)), // below the threshold
      ...times(5, () => link(5, 5)), // the same collector: not a link
      link(6, null), link(null, 7),
      link(1, 2, 'implausible-travel')
    ];
    const { links: counted, groups } = buildGroups(links, 3, new Map([[1, 'Aminata'], [2, 'Bockarie']]));
    counted.should.equal(5);
    groups.length.should.equal(1);
    groups[0].members.should.eql([{ actorId: 1, displayName: 'Aminata', links: 3 }, { actorId: 2, displayName: 'Bockarie', links: 3 }]);
    groups[0].connections.should.eql([{ a: 1, b: 2, links: 3, byRule: { 'near-duplicate': 2, identity: 1 } }]);
    buildGroups(links, 2).groups.length.should.equal(2);
  });

  it('groups collectors connected through each other, and orders groups by links', () => {
    const links = [
      ...times(3, () => link(10, 11)), ...times(4, () => link(11, 12, 'repeated-location', { xmlFormId: 'farm', formName: 'Farms' })),
      ...times(9, () => link(20, 21)),
      ...times(2, () => link(10, 12)) // weak: does not by itself connect, but 10 and 12 are already grouped through 11
    ];
    const { groups } = buildGroups(links, 3);
    groups.map((g) => g.members.map((m) => m.actorId).sort()).should.eql([[20, 21], [10, 11, 12]]);
    const chain = groups[1];
    chain.findingsTotal.should.equal(7);
    chain.connections.map((c) => [c.a, c.b, c.links]).should.eql([[11, 12, 4], [10, 11, 3]]);
    chain.forms.should.eql([{ xmlFormId: 'farm', formName: 'Farms' }, { xmlFormId: 'hh', formName: 'Households' }]);
    chain.members[0].should.containEql({ actorId: 11, links: 7 });
  });

  it('names forms on both sides, and lists a bounded number of findings', () => {
    const links = times(LIMITS.findingsPerGroup + 10, () => link(1, 2, 'identity-reused:k', { relatedXmlFormId: 'register', relatedFormName: 'Register' }));
    const [group] = buildGroups(links, 3).groups;
    group.findingsTotal.should.equal(60);
    group.findingsShown.should.equal(50);
    group.findings.length.should.equal(50);
    group.findings[0].should.containEql({ xmlFormId: 'hh', relatedXmlFormId: 'register' });
    group.forms.map((f) => f.xmlFormId).should.eql(['hh', 'register']);
    buildGroups([], 3).should.eql({ links: 0, groups: [] });
  });
});
