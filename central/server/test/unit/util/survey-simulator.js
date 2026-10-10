require('should');
const { parse } = require('../../../lib/util/xpath-reader');
const { evaluate, toStr, Unsupported } = require('../../../lib/util/xpath-eval');
const { simulate, generator, LIMITS } = require('../../../lib/util/survey-simulator');

// A flat model for evaluator tests.
const model = (answers, context = '/data/q') => ({
  context, now: new Date('2026-01-01T00:00:00Z'), random: () => 0.5,
  exists: (path) => path in answers || path === context,
  value: (path) => answers[path] ?? ''
});
const ev = (expr, answers = {}, context) => evaluate(parse(expr), model(answers, context));

// An XForm from [name, type, binds, control] rows under /data.
const xform = (rows, choices = {}) => {
  const instance = rows.map(([name]) => `<${name}/>`).join('');
  const binds = rows.map(([name, type, b = {}]) => `<bind nodeset="/data/${name}" type="${type}"${Object.entries(b)
    .map(([k, v]) => ` ${k}="${v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')}"`).join('')}/>`).join('');
  const body = rows.filter(([, , , control]) => control !== 'none').map(([name, , , control = 'input']) => {
    const items = (choices[name] ?? []).map((v) => `<item><label>${v}</label><value>${v}</value></item>`).join('');
    return `<${control} ref="/data/${name}"><label>${name}</label>${items}</${control}>`;
  }).join('');
  return `<?xml version="1.0"?><h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa">
<h:head><h:title>t</h:title><model><instance><data id="t">${instance}<meta><instanceID/></meta></data></instance>${binds}</model></h:head>
<h:body>${body}</h:body></h:html>`;
};

describe('(util) XPath evaluator', () => {
  it('converts and compares by XPath 1.0 rules', () => {
    ev('1 + 2 * 3').should.equal(7);
    ev('7 div 2').should.equal(3.5);
    ev('7 mod 3').should.equal(1);
    ev('-(2)').should.equal(-2);
    ev("'10' = 10").should.be.true();
    ev("'10' = '10.0'").should.be.false();
    ev("'abc' < 'b'").should.be.false(); // strings compare as numbers: NaN
    ev('/data/a > 5', { '/data/a': '12' }).should.be.true();
    ev("/data/a = ''", { '/data/a': '' }).should.be.true();
    ev("/data/missing = ''").should.be.false(); // an empty node-set equals nothing
    ev('/data/missing = false()').should.be.true();
    ev('true() and not(false())').should.be.true();
    ev('1 or /data/x').should.be.true();
    toStr(ev('1 div 0'), model({})).should.equal('Infinity');
    toStr(ev('0.1 + 0.2'), model({})).should.equal('0.3');
  });

  it('resolves absolute, relative and current() paths', () => {
    const answers = { '/data/g/a': '3', '/data/b': '4' };
    ev('/data/g/a + ../../b', answers, '/data/g/q').should.equal(7);
    ev('number(../a)', answers, '/data/g/q').should.equal(3);
    ev('. + 1', { '/data/g/q': '1' }, '/data/g/q').should.equal(2);
    ev('current()/../a * 2', answers, '/data/g/q').should.equal(6);
  });

  it('evaluates the ODK functions forms use', () => {
    const a = { '/data/s': 'red blue', '/data/n': '7', '/data/d': '2025-12-25' };
    ev("selected(/data/s, 'blue')", a).should.be.true();
    ev("selected(/data/s, 'green')", a).should.be.false();
    ev('count-selected(/data/s)', a).should.equal(2);
    ev('selected-at(/data/s, 1)', a).should.equal('blue');
    ev("if(/data/n > 5, 'big', 'small')", a).should.equal('big');
    ev("coalesce(/data/none, 'x')", a).should.equal('x');
    ev("concat('a', /data/n, 'b')", a).should.equal('a7b');
    ev("substr('abcdef', 1, 3)").should.equal('bc');
    ev("substring('abcdef', 2, 3)").should.equal('bcd');
    ev("string-length('héllo')").should.equal(5);
    ev("regex('AB-12', '^[A-Z]{2}-[0-9]+$')").should.be.true();
    ev('round(2.5)').should.equal(3);
    ev('round(3.14159, 2)').should.equal(3.14);
    ev('int(-2.7)').should.equal(-2);
    ev('today()').should.equal('2026-01-01');
    // Dates compare and subtract as days.
    ev('/data/d < today()', a).should.be.true();
    ev('today() - /data/d', a).should.equal(7);
    ev('date(today() - 1)').should.equal('2025-12-31');
    ev("jr:choice-name('x', '/data/s')").should.equal('x');
    ev("normalize-space('  a   b ')").should.equal('a b');
    ev("translate('abc', 'ab', 'AB')").should.equal('ABc');
    ev('sum(/data/n)', a).should.equal(7);
    ev("format-date(/data/d, '%Y')", a).should.equal('2025');
    ev("format-date(/data/d, '%d/%m/%y %b %a')", a).should.equal('25/12/25 Dec Thu');
    ev("number(format-date(today(), '%Y')) - 2000").should.equal(26);
    ev('count(/data/n)', a).should.equal(1);
  });

  it('reports what it does not evaluate instead of guessing', () => {
    for (const expr of ["instance('x')/root/item[name='a']/label", '/data/a[1]', 'pexplode(1)', '/data/a | /data/b', '$v', '//a', 'digest(1)'])
      (() => ev(expr)).should.throw(Unsupported);
    (() => ev("regex('a', '(')")).should.throw(Unsupported);
  });
});

describe('(util) survey simulator', () => {
  // q3 is reachable only when a=yes and b=no; q4 never (a cannot be both).
  const branching = xform([
    ['a', 'string', { required: 'true()' }, 'select1'],
    ['b', 'string', { required: 'true()' }, 'select1'],
    ['q3', 'string', { relevant: "/data/a = 'yes' and /data/b = 'no'" }],
    ['q4', 'string', { relevant: "/data/a = 'yes' and /data/a = 'no'" }],
    ['age', 'int', { required: 'true()', constraint: '. > 5 and . < 3' }],
    ['n', 'int', { required: 'true()', constraint: '. >= 500 and . <= 600' }],
    ['note', 'string', { readonly: 'true()' }],
    ['calc', 'string', { calculate: 'once(1)' }, 'none'],
    ['odd', 'string', { relevant: "instance('x')/root/item = 'a'" }]
  ], { a: ['yes', 'no'], b: ['yes', 'no'] });

  it('finds what interviews reach, never reach, and cannot answer', () => {
    const report = simulate(branching, { runs: 200, seed: 'fixed' });
    report.runs.should.equal(200);
    report.reducedForBudget.should.be.false();
    const q = Object.fromEntries(report.questions.map((x) => [x.path.replace('/data/', ''), x]));
    q.a.shown.should.equal(200);
    q.a.answered.should.equal(200);
    // About a quarter of interviews reach q3.
    q.q3.shown.should.be.within(25, 75);
    q.q4.shown.should.equal(0);
    report.neverShown.should.eql(['/data/q4']);
    // An impossible constraint is never met; a narrow one is met by searching wider.
    report.constraintNeverMet.should.eql([{ path: '/data/age', interviews: 200 }]);
    q.n.answered.should.equal(200);
    // Read-only questions are shown, not answered.
    q.note.should.containEql({ shown: 200, answered: 0 });
    // What could not be evaluated is reported, and its question still counted as shown.
    report.notSimulated.should.have.length(1);
    report.notSimulated[0].should.containEql({ path: '/data/odd', attribute: 'relevant' });
    report.notSimulated[0].reason.should.match(/secondary instances/);
    q.odd.shown.should.equal(200);
    report.length.should.containEql({ min: 6, max: 7 });
  });

  it('is reproducible for a seed and differs for another', () => {
    const a = simulate(branching, { runs: 50, seed: 'one' });
    simulate(branching, { runs: 50, seed: 'one' }).reportHash.should.equal(a.reportHash);
    simulate(branching, { runs: 50, seed: 'two' }).reportHash.should.not.equal(a.reportHash);
    simulate(branching, { runs: 50 }).seed.should.match(/^[0-9a-f]{16}$/);
    const r = generator('s'); const s = generator('s');
    [r(), r(), r()].should.eql([s(), s(), s()]);
  });

  it('leaves optional questions blank sometimes, follows calculations and group relevance', () => {
    const form = xform([
      ['opt', 'string', {}],
      ['kids', 'int', { required: 'true()', constraint: '. >= 0 and . <= 10' }],
      ['has_kids', 'string', { calculate: 'if(/data/kids > 0, 1, 0)' }, 'none'],
      ['kid_q', 'string', { relevant: '/data/has_kids = 1' }],
      ['old', 'date', { required: 'true()', constraint: '. <= today()' }]
    ]);
    const report = simulate(form, { runs: 300, seed: 'x' });
    const q = Object.fromEntries(report.questions.map((x) => [x.path.replace('/data/', ''), x]));
    q.opt.answered.should.be.within(240, 290);
    q.kid_q.shown.should.be.within(200, 299);
    q.old.answered.should.equal(300);
    report.notSimulated.should.eql([]);
    // Interview length differs by branch.
    report.length.min.should.equal(3);
    report.length.max.should.equal(4);
  });

  it('answers typed questions with the values the form compares them with', () => {
    // Typed text and numbers that only a particular value opens; a multiple
    // choice that must have exactly two; dates that must be in order.
    const form = xform([
      ['month', 'string', { required: 'true()' }],
      ['feb', 'string', { relevant: "/data/month = '2'" }],
      ['count', 'int', { required: 'true()' }],
      ['many', 'string', { relevant: '/data/count > 40' }],
      ['pick', 'string', { required: 'true()', constraint: 'count-selected(.) = 2' }, 'select'],
      ['start', 'date', { required: 'true()' }],
      ['end', 'date', { required: 'true()', constraint: '. >= /data/start and . <= today()' }],
      ['age', 'string', { required: 'true()', constraint: '. > 18 and . < 100' }]
    ], { pick: ['a', 'b', 'c'] });
    const report = simulate(form, { runs: 200, seed: 'targets' });
    report.neverShown.should.eql([]);
    report.constraintNeverMet.should.eql([]);
  });

  it('hides a group\'s questions when the group is not relevant', () => {
    const form = `<?xml version="1.0"?><h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml">
<h:head><h:title>g</h:title><model><instance><data id="g"><go/><grp><inner/></grp><meta><instanceID/></meta></data></instance>
<bind nodeset="/data/go" type="string" required="true()"/>
<bind nodeset="/data/grp" relevant="/data/go = 'yes'"/>
<bind nodeset="/data/grp/inner" type="string"/></model></h:head>
<h:body><select1 ref="/data/go"><label>Go</label><item><label>Yes</label><value>yes</value></item><item><label>No</label><value>no</value></item></select1>
<group ref="/data/grp"><label>G</label><input ref="/data/grp/inner"><label>Inner</label></input></group></h:body></h:html>`;
    const report = simulate(form, { runs: 200, seed: 'g' });
    const inner = report.questions.find((q) => q.path === '/data/grp/inner');
    inner.shown.should.be.within(70, 130);
    inner.label.should.equal('Inner');
    report.length.should.containEql({ min: 1, max: 2 });
  });

  it('keeps within the run budget', () => {
    const many = xform(Array.from({ length: 50 }, (_, i) => [`q${i}`, 'string', {}]));
    const max = LIMITS.visits;
    LIMITS.visits = 1000;
    try {
      const report = simulate(many, { runs: 100, seed: 'b' });
      report.should.containEql({ runs: 20, runsAsked: 100, reducedForBudget: true });
    } finally { LIMITS.visits = max; }
  });
});
