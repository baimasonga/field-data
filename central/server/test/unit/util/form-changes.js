require('should');
const { compare, normalise, LIMITS } = require('../../../lib/util/form-changes');

// A hand-written XForm: `instance` is the primary instance's inside, `binds`
// and `body` are inserted as given.
const xform = ({ instance, binds = '', body = '', extra = '', itext = '', meta = '' }) => `<?xml version="1.0"?>
<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa">
  <h:head><h:title>t</h:title><model>${itext}
    <instance><data id="t">${instance}<meta><instanceID/></meta></data></instance>${extra}
    ${binds}
    <bind nodeset="/data/meta/instanceID" type="string" readonly="true()" jr:preload="uid"${meta}/>
  </model></h:head>
  <h:body>${body}</h:body>
</h:html>`;
const input = (path, label = path) => `<input ref="${path}"><label>${label}</label></input>`;
const select = (tag, path, items) => `<${tag} ref="${path}"><label>x</label>${items.map(([v, l]) => `<item><label>${l}</label><value>${v}</value></item>`).join('')}</${tag}>`;
const bind = (path, attrs = '') => `<bind nodeset="${path}" type="string"${attrs}/>`;
const codes = (report) => report.changes.map((c) => [c.effect, c.code, c.path]);

describe('(util) form changes', () => {
  const base = xform({
    instance: '<name/><age/>',
    binds: bind('/data/name') + '<bind nodeset="/data/age" type="int" constraint=". &gt;= 0"/>',
    body: input('/data/name', 'Name') + input('/data/age', 'Age')
  });

  it('finds nothing between identical versions, and ignores the meta block', () => {
    const report = compare(base, base);
    report.changes.should.eql([]);
    report.summary.should.eql({ meaning: 0, continuity: 0, population: 0, wording: 0, unchanged: 2 });
    const metaChanged = base.replace('jr:preload="uid"', 'jr:preload="uid" calculate="concat(\'x\', 1)"');
    compare(base, metaChanged).changes.should.eql([]);
  });

  it('reports added and removed columns, removed last', () => {
    const next = xform({
      instance: '<phone/><name/>',
      binds: bind('/data/phone') + bind('/data/name'),
      body: input('/data/phone') + input('/data/name', 'Name')
    });
    codes(compare(base, next)).should.eql([
      ['continuity', 'added', '/data/phone'],
      ['continuity', 'removed', '/data/age']
    ]);
  });

  it('matches a question whose path changed by its name, only when the name is unique', () => {
    const grouped = xform({
      instance: '<who><name/></who><age/>',
      binds: bind('/data/who/name') + '<bind nodeset="/data/age" type="int" constraint=". &gt;= 0"/>',
      body: `<group ref="/data/who"><label>Who</label>${input('/data/who/name', 'Name')}</group>${input('/data/age', 'Age')}`
    });
    const report = compare(base, grouped);
    codes(report).should.eql([['continuity', 'moved', '/data/who/name']]);
    report.changes[0].fromPath.should.equal('/data/name');

    // Two questions called "name": no guessing which one moved.
    const twice = xform({
      instance: '<a><name/></a><b><name/></b><age/>',
      binds: bind('/data/a/name') + bind('/data/b/name') + '<bind nodeset="/data/age" type="int" constraint=". &gt;= 0"/>',
      body: `<group ref="/data/a">${input('/data/a/name')}</group><group ref="/data/b">${input('/data/b/name')}</group>${input('/data/age', 'Age')}`
    });
    codes(compare(base, twice)).should.eql([
      ['continuity', 'added', '/data/a/name'],
      ['continuity', 'added', '/data/b/name'],
      ['continuity', 'removed', '/data/name']
    ]);
    // Nor when the earlier version used the name twice.
    codes(compare(twice, grouped)).should.eql([
      ['continuity', 'added', '/data/who/name'],
      ['continuity', 'removed', '/data/a/name'],
      ['continuity', 'removed', '/data/b/name']
    ]);
  });

  it('reports changes of data type, of single or multiple choice, and of kind', () => {
    const next = base.replace('type="int"', 'type="decimal"');
    compare(base, next).changes.should.eql([{ effect: 'meaning', code: 'type-changed', path: '/data/age', fromPath: '/data/age', detail: { from: 'int', to: 'decimal' } }]);

    const one = xform({ instance: '<c/>', binds: '<bind nodeset="/data/c" type="select1"/>', body: select('select1', '/data/c', [['a', 'A']]) });
    const many = xform({ instance: '<c/>', binds: '<bind nodeset="/data/c" type="select"/>', body: select('select', '/data/c', [['a', 'A']]) });
    codes(compare(one, many)).should.eql([['meaning', 'choice-kind-changed', '/data/c']]);

    const calculated = xform({ instance: '<name/><age/>', binds: bind('/data/name') + '<bind nodeset="/data/age" type="int" constraint=". &gt;= 0" calculate="1"/>', body: input('/data/name', 'Name') });
    compare(base, calculated).changes.slice(0, 2).map((c) => [c.code, c.detail]).should.eql([
      ['type-changed', { from: 'a question', to: 'a calculation' }],
      ['calculation-changed', { from: '', to: '1' }]
    ]);
  });

  it('reports a question moved into a repeat, its strongest effect first', () => {
    const next = xform({
      instance: '<name/><member><age/></member>',
      binds: bind('/data/name') + '<bind nodeset="/data/member/age" type="int" constraint=". &gt;= 0"/>',
      body: `${input('/data/name', 'Name')}<group ref="/data/member"><label>Member</label><repeat nodeset="/data/member">${input('/data/member/age', 'Age')}</repeat></group>`
    });
    const report = compare(base, next);
    codes(report).should.eql([
      ['continuity', 'added', '/data/member'],
      ['meaning', 'repeat-changed', '/data/member/age'],
      ['continuity', 'moved', '/data/member/age']
    ]);
    report.changes[1].detail.should.eql({ from: null, to: 'member' });
  });

  it('reports changed expressions, ignoring whitespace and default values', () => {
    const next = xform({
      instance: '<name/><age/>',
      binds: bind('/data/name', ' required="true()" readonly="false()"') + '<bind nodeset="/data/age" type="int" constraint=". &gt;= 18" relevant="/data/name != \'\'"/>',
      body: input('/data/name', 'Name') + input('/data/age', 'Age')
    });
    const report = compare(base, next);
    codes(report).should.eql([
      ['population', 'required-changed', '/data/name'],
      ['population', 'relevant-changed', '/data/age'],
      ['population', 'constraint-changed', '/data/age']
    ]);
    report.changes[2].detail.should.eql({ from: '.>=0', to: '.>=18' });

    const spaced = base.replace('constraint=". &gt;= 0"', 'constraint="  .&gt;=   0 "').replace(bind('/data/name'), bind('/data/name', ' required="false()"'));
    compare(base, spaced).changes.should.eql([]);
    normalise("a  and   b = 'x  y'").should.equal("a and b='x  y'");
    normalise('a and b').should.not.equal(normalise('aand b'));
  });

  it('reports choices added, removed and relabelled, and a change of choice source', () => {
    const before = xform({ instance: '<c/>', binds: '<bind nodeset="/data/c" type="select1"/>', body: select('select1', '/data/c', [['tap', 'Public tap'], ['well', 'Well']]) });
    const after = xform({ instance: '<c/>', binds: '<bind nodeset="/data/c" type="select1"/>', body: select('select1', '/data/c', [['tap', 'Standpipe'], ['river', 'River']]) });
    const report = compare(before, after);
    codes(report).should.eql([
      ['meaning', 'choice-relabelled', '/data/c'],
      ['population', 'choices-added', '/data/c'],
      ['population', 'choices-removed', '/data/c']
    ]);
    report.changes.map((c) => c.detail).should.eql([
      { value: 'tap', language: '', from: 'Public tap', to: 'Standpipe' },
      { values: ['river'] },
      { values: ['well'] }
    ]);

    const external = xform({
      instance: '<c/>', binds: '<bind nodeset="/data/c" type="select1"/>',
      extra: '<instance id="places" src="jr://file-csv/places.csv"/>',
      body: '<select1 ref="/data/c"><label>x</label><itemset nodeset="instance(\'places\')/root/item"><value ref="name"/><label ref="label"/></itemset></select1>'
    });
    codes(compare(before, external)).should.eql([['population', 'choice-source-changed', '/data/c']]);
  });

  it('compares labels in the languages both versions have, or their first when they share none', () => {
    const itext = (en, fr) => `<itext><translation lang="English"><text id="/data/q:label"><value>${en}</value></text></translation>${fr == null ? '' : `<translation lang="French"><text id="/data/q:label"><value>${fr}</value></text></translation>`}</itext>`;
    const form = (en, fr) => xform({ itext: itext(en, fr), instance: '<q/>', binds: bind('/data/q'), body: '<input ref="/data/q"><label ref="jr:itext(\'/data/q:label\')"/></input>' });
    codes(compare(form('Age', 'Âge'), form('Age', 'Âge (ans)'))).should.eql([['wording', 'label-changed', '/data/q']]);
    compare(form('Age', 'Âge'), form('Age', 'Âge (ans)')).changes[0].detail.language.should.equal('French');
    compare(form('Age', 'Âge'), form('Age')).changes.should.eql([]);
    const plain = xform({ instance: '<q/>', binds: bind('/data/q'), body: input('/data/q', 'How old?') });
    compare(plain, form('Age')).changes[0].detail.should.eql({ language: 'default → English', from: 'How old?', to: 'Age' });
  });

  it('reports a group whose relevance changed, not the group itself otherwise', () => {
    const grouped = (relevant) => xform({
      instance: '<g><q/></g>',
      binds: `<bind nodeset="/data/g"${relevant}/>` + bind('/data/g/q'),
      body: `<group ref="/data/g"><label>G</label>${input('/data/g/q')}</group>`
    });
    codes(compare(grouped(''), grouped(' relevant="1 = 2"'))).should.eql([['population', 'relevant-changed', '/data/g']]);
    compare(grouped(''), grouped('').replace('<label>G</label>', '<label>Group</label>')).changes.should.eql([]);
  });

  it(`returns at most ${LIMITS.changes} changes and says so`, () => {
    const n = LIMITS.changes + 1;
    const names = Array.from({ length: n }, (_, i) => `q${i}`);
    const big = xform({
      instance: names.map((x) => `<${x}/>`).join(''),
      binds: names.map((x) => bind(`/data/${x}`)).join(''),
      body: names.map((x) => input(`/data/${x}`)).join('')
    });
    const report = compare(xform({ instance: '' }), big);
    report.changes.length.should.equal(LIMITS.changes);
    report.truncated.should.equal(true);
    report.summary.continuity.should.equal(n);
  });
});
