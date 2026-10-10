const should = require('should');
const { readFileSync } = require('fs');
const { join } = require('path');
const { examine, FormTooLarge } = require('../../../lib/util/survey-doctor');
const { parse, XPathSyntaxError } = require('../../../lib/util/xpath-reader');

// Compiled by pyxform from test/data/survey-doctor/make-fixtures.py: one form
// with a deliberate instance of each problem, and the same form corrected.
const fixture = (name) => readFileSync(join(__dirname, '../../data/survey-doctor', name), 'utf8');

// A hand-written XForm: `instance` is the primary instance's inside, `binds`
// and `body` are inserted as given, `extra` adds secondary instances.
const xform = ({ instance, binds = '', body = '', extra = '', itext = '' }) => `<?xml version="1.0"?>
<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa">
  <h:head><h:title>t</h:title><model>${itext}
    <instance><data id="t">${instance}<meta><instanceID/></meta></data></instance>${extra}
    ${binds}
    <bind nodeset="/data/meta/instanceID" type="string" readonly="true()" jr:preload="uid"/>
  </model></h:head>
  <h:body>${body}</h:body>
</h:html>`;
// An XLSForm reference left unconverted, as it would be in a hand-written XForm.
const UNCONVERTED = ['$', '{q}'].join('');
const codes = (report) => report.findings.map((f) => [f.code, f.path]);
const input = (path) => `<input ref="${path}"><label>${path}</label></input>`;
const select1 = (path, values) => `<select1 ref="${path}"><label>x</label>${values.map((v) => `<item><label>${v}</label><value>${v}</value></item>`).join('')}</select1>`;

describe('(util) survey doctor', () => {
  describe('XPath reader', () => {
    it('reads paths, predicates, functions and operator names', () => {
      parse("instance('c')/root/item[district = current()/../district]/name").filter.expr.name.should.equal('instance');
      parse('. > 18 and . < 16').type.should.equal('and');
      parse('div div div').should.containEql({ type: 'arith', op: 'div' });
      parse('-1 < .').left.type.should.equal('neg');
      parse("jr:choice-name(/data/x, ' /data/x ')").name.should.equal('jr:choice-name');
      parse('count(/data/rep) * 2').op.should.equal('*');
    });

    it('refuses what is not XPath', () => {
      for (const bad of [UNCONVERTED, "'open", '/data/x =', 'f(', '(1'])
        (() => parse(bad)).should.throw(XPathSyntaxError);
    });
  });

  describe('a pyxform form with one planted problem of each kind', () => {
    it('finds each planted problem, in order of severity', () => {
      const report = examine(fixture('planted.xml'));
      report.findings.map((f) => [f.severity, f.code, f.path]).should.eql([
        ['error', 'impossible-constraint', '/data/age'],
        ['error', 'never-shown', '/data/bo_only'],
        ['error', 'never-shown', '/data/tv_brand'],
        ['error', 'cycle', '/data/a'],
        ['error', 'unanswerable-required', '/data/locked'],
        ['warning', 'missing-translation', '/data/hh_size'],
        ['warning', 'duplicate-choice-label', '/data/assets'],
        ['warning', 'forward-reference', '/data/early'],
        ['note', 'number-without-range', '/data/hh_size'],
        // Written as false(): hidden on purpose, so a note.
        ['note', 'never-shown', '/data/never']
      ]);
      report.findings.find((f) => f.code === 'cycle').related.should.eql(['/data/b']);
      report.findings.find((f) => f.code === 'missing-translation').related.should.eql(['Krio (kri)']);
      report.findings.find((f) => f.code === 'duplicate-choice-label').related.should.eql(['radio', 'phone']);
      report.findings.find((f) => f.code === 'never-shown' && f.path === '/data/never').message.should.match(/group and everything in it is always hidden/);
      // The question inside the never-shown group is not reported again.
      report.findings.some((f) => f.path === '/data/never/inside').should.be.false();
      report.summary.should.containEql({ questions: 14, groups: 1, repeats: 1, calculations: 2, choiceLists: 3, errors: 5, warnings: 3, notes: 2 });
      report.summary.languages.should.eql(['English (en)', 'Krio (kri)']);
    });

    it('finds nothing wrong in the corrected form, and says what it could not check', () => {
      const report = examine(fixture('corrected.xml'));
      report.findings.should.eql([]);
      report.notChecked.should.eql([
        { reason: 'relevance-not-evaluated', paths: ['/data/fancy'] },
        { reason: 'external-or-filtered-choices', paths: ['/data/chiefdom'] }
      ]);
    });

    it('gives the same report for the same definition', () => {
      examine(fixture('planted.xml')).should.eql(examine(fixture('planted.xml')));
    });
  });

  describe('benign lookalikes', () => {
    it('does not call a one-way chain of calculations a cycle', () => {
      const report = examine(xform({
        instance: '<a/><b/><c/>',
        binds: '<bind nodeset="/data/a" calculate="1"/><bind nodeset="/data/b" calculate="/data/a + 1"/><bind nodeset="/data/c" calculate="/data/b + /data/a"/>'
      }));
      codes(report).should.eql([]);
    });

    it('accepts a choice compared with its exact name, and flags a different case', () => {
      const body = select1('/data/d', ['Bo', 'Kenema']) + input('/data/x');
      codes(examine(xform({ instance: '<d/><x/>', binds: `<bind nodeset="/data/x" relevant="/data/d = 'Bo'"/>`, body }))).should.eql([]);
      codes(examine(xform({ instance: '<d/><x/>', binds: `<bind nodeset="/data/x" relevant="/data/d = 'bo'"/>`, body })))
        .should.eql([['never-shown', '/data/x']]);
      // Not equal to a missing choice, or compared with '' (not answered), can be true.
      codes(examine(xform({ instance: '<d/><x/>', binds: `<bind nodeset="/data/x" relevant="/data/d != 'bo' or /data/d = ''"/>`, body }))).should.eql([]);
    });

    it('decides number constraints, and treats whole numbers as whole', () => {
      const check = (type, constraint) => codes(examine(xform({
        instance: '<n/><m/>', binds: `<bind nodeset="/data/n" type="${type}" constraint="${constraint}"/><bind nodeset="/data/m" calculate="3"/>`, body: input('/data/n')
      })));
      check('int', '. &gt;= 0 and . &lt;= 120').should.eql([]);
      check('int', '. &gt; 4 and . &lt; 5').should.eql([['impossible-constraint', '/data/n']]);
      check('decimal', '. &gt; 4 and . &lt; 5').should.eql([]);
      check('int', '(. &lt; 0 or . &gt; 10) and . = 5').should.eql([['impossible-constraint', '/data/n']]);
      check('int', 'not(. &gt;= 0) and . &gt; 3').should.eql([['impossible-constraint', '/data/n']]);
      check('int', '. != 5').should.eql([]);
      check('int', '18 &lt; . and . &lt; 16').should.eql([['impossible-constraint', '/data/n']]);
      // Depends on another answer: cannot be decided, so no finding.
      check('int', '. &gt; 18 and . &lt; /data/m').should.eql([]);
    });

    it('counts a bare question as understood, not as unevaluated', () => {
      const report = examine(xform({
        instance: '<a/><d/><b/>', binds: `<bind nodeset="/data/b" relevant="/data/a and /data/d = 'Bo'"/>`,
        body: input('/data/a') + select1('/data/d', ['Bo']) + input('/data/b')
      }));
      codes(report).should.eql([]);
      report.notChecked.should.eql([]);
    });

    it('says when relevance uses functions it does not model, instead of guessing', () => {
      const report = examine(xform({
        instance: '<a/><b/>', binds: '<bind nodeset="/data/b" relevant="string-length(/data/a) &gt; 3 and today() &gt; 0"/>',
        body: input('/data/a') + input('/data/b')
      }));
      codes(report).should.eql([]);
      report.notChecked.should.eql([{ reason: 'relevance-not-evaluated', paths: ['/data/b'] }]);
    });

    it('does not call a reference to an earlier sibling in a repeat a forward reference', () => {
      const report = examine(xform({
        instance: '<rep jr:template=""><name/><age/></rep>',
        binds: `<bind nodeset="/data/rep/age" type="int" relevant="../name != ''" constraint=". &gt;= 0"/>`,
        body: `<group ref="/data/rep"><repeat nodeset="/data/rep">${input('/data/rep/name')}${input('/data/rep/age')}</repeat></group>`
      }));
      codes(report).should.eql([]);
      report.summary.repeats.should.equal(1);
    });

    it('does not stop on a required read-only question shown only under a condition (a deliberate stop)', () => {
      const report = examine(xform({
        instance: '<a/><g><stop/></g><always/>',
        binds: `<bind nodeset="/data/stop" required="true()" readonly="true()" relevant="/data/a = 'x'"/>`
          + `<bind nodeset="/data/g" relevant="/data/a = 'y'"/><bind nodeset="/data/g/stop" required="true()" readonly="true()"/>`
          + '<bind nodeset="/data/always" required="true()" readonly="true()"/>',
        body: input('/data/a') + `<group ref="/data/g">${input('/data/g/stop')}</group>` + input('/data/always')
      }));
      codes(report).should.eql([['unanswerable-required', '/data/always']]);
    });

    it('does not check the labels of a list hidden on purpose', () => {
      const body = '<select1 ref="/data/h"><label>h</label><item><label>Same</label><value>a</value></item><item><label>Same</label><value>b</value></item></select1>';
      codes(examine(xform({ instance: '<h/>', binds: '<bind nodeset="/data/h" relevant="false()"/>', body })))
        .should.eql([['never-shown', '/data/h']]);
      codes(examine(xform({ instance: '<h/>', body }))).should.eql([['duplicate-choice-label', '/data/h']]);
    });

    it('treats null as an empty value, not a question', () => {
      const report = examine(xform({
        instance: '<a/><b/>', binds: "<bind nodeset=\"/data/b\" calculate=\"if(/data/a = 'x', /data/a, null)\"/>", body: input('/data/a')
      }));
      codes(report).should.eql([]);
    });

    it('reads choice entries by the path the list declares, including inside randomize()', () => {
      const report = examine(xform({
        instance: '<c/><f/>',
        extra: '<instance id="choices"><counties><county><value>a</value></county><county><value>a</value></county></counties></instance>'
          + '<instance id="fruits"><root><item><name>apple</name><label>Apple</label></item></root></instance>',
        body: `<select1 ref="/data/c"><label>c</label><itemset nodeset="instance('choices')/counties/county"><value ref="value"/><label ref="value"/></itemset></select1>`
          + `<select1 ref="/data/f"><label>f</label><itemset nodeset="randomize(instance('fruits')/root/item, 42)"><value ref="name"/><label ref="label"/></itemset></select1>`
      }));
      report.findings.map((f) => [f.code, f.path, f.related]).should.eql([['duplicate-choice', '/data/c', ['a']]]);
      report.notChecked.should.eql([]);
    });

    it('reports a language missing from most of the form once', () => {
      const n = 30;
      const ids = Array.from({ length: n }, (_, i) => `q${i}`);
      const text = (lang, done) => `<translation lang="${lang}">${ids.map((id, i) => `<text id="${id}"><value>${done(i) ? id : '-'}</value></text>`).join('')}</translation>`;
      const report = examine(xform({
        instance: ids.map((id) => `<${id}/>`).join(''),
        itext: `<itext>${text('English', () => true)}${text('French', (i) => i === 0)}${text('Krio', (i) => i !== 5)}</itext>`,
        body: ids.map((id) => `<input ref="/data/${id}"><label ref="jr:itext('${id}')"/></input>`).join('')
      }));
      report.findings.map((f) => [f.code, f.path, f.related]).should.eql([
        ['missing-translation', '/data', ['French']],
        ['missing-translation', '/data/q5', ['Krio']]
      ]);
      report.findings[0].message.should.match(/French is missing for 29 of 30/);
    });

    it('takes question order from the body, not the instance', () => {
      // The instance lists b before a; the body asks a first.
      // b depends on a (asked earlier: fine); a's constraint depends on b (asked later).
      const binds = `<bind nodeset="/data/b" relevant="/data/a = 'x'"/><bind nodeset="/data/a" constraint=". != /data/b"/>`;
      codes(examine(xform({ instance: '<b/><a/>', binds, body: input('/data/a') + input('/data/b') })))
        .should.eql([['forward-reference', '/data/a']]);
    });

    it('warns about a group that opens only on an answer inside it, unless that answer has its own value', () => {
      const group = (inner) => xform({
        instance: '<g><q/></g>', binds: `<bind nodeset="/data/g" relevant="/data/g/q = 'y'"/>${inner}`,
        body: `<group ref="/data/g">${input('/data/g/q')}</group>`
      });
      const report = examine(group(''));
      report.findings.map((f) => [f.code, f.path, f.related]).should.eql([['forward-reference', '/data/g', ['/data/g/q']]]);
      report.findings[0].message.should.match(/may never open/);
      codes(examine(group('<bind nodeset="/data/g/q" calculate="\'y\'"/>'))).should.eql([]);
    });

    it('does not treat always-true relevance as a condition', () => {
      const report = examine(xform({
        instance: '<g><stop/></g>',
        binds: '<bind nodeset="/data/g" relevant="true()"/><bind nodeset="/data/g/stop" required="true()" readonly="true()"/>',
        body: `<group ref="/data/g">${input('/data/g/stop')}</group>`
      }));
      codes(report).should.eql([['unanswerable-required', '/data/g/stop']]);
    });

    it('does not call an external or filtered list empty, and lists it as not checked', () => {
      const report = examine(xform({
        instance: '<v/><w/>',
        extra: `<instance id="villages" src="jr://file-csv/villages.csv"/><instance id="wards"><root><item><name>a</name><label>A</label><d>x</d></item></root></instance>`,
        body: `<select1 ref="/data/v"><label>v</label><itemset nodeset="instance('villages')/root/item"><value ref="name"/><label ref="label"/></itemset></select1>`
          + `<select1 ref="/data/w"><label>w</label><itemset nodeset="instance('wards')/root/item[d = /data/v]"><value ref="name"/><label ref="label"/></itemset></select1>`
      }));
      codes(report).should.eql([]);
      report.notChecked.should.eql([{ reason: 'external-or-filtered-choices', paths: ['/data/v', '/data/w'] }]);
    });
  });

  describe('other problems', () => {
    it('finds references to questions the form does not have, including inside predicates', () => {
      const report = examine(xform({
        instance: '<a/><b/>',
        extra: '<instance id="c"><root><item><name>x</name><d>1</d></item></root></instance>',
        binds: `<bind nodeset="/data/b" relevant="/data/old_name = 'yes'" calculate="count(instance('c')/root/item[d = /data/gone])"/>`,
        body: input('/data/a') + input('/data/b')
      }));
      report.findings.map((f) => [f.code, f.attribute, f.related]).should.eql([
        ['unknown-reference', 'relevant', ['/data/old_name']],
        ['unknown-reference', 'calculate', ['/data/gone']]
      ]);
    });

    it('finds a longer cycle through relevance, and a question relevant on itself', () => {
      const report = examine(xform({
        instance: '<a/><b/><c/><s/>',
        binds: `<bind nodeset="/data/a" relevant="/data/c = 'y'"/><bind nodeset="/data/b" calculate="/data/a"/><bind nodeset="/data/c" calculate="/data/b"/><bind nodeset="/data/s" relevant=". != ''"/>`,
        body: input('/data/a') + input('/data/s')
      }));
      const cycles = report.findings.filter((f) => f.code === 'cycle');
      cycles.map((f) => [f.path, f.related]).sort().should.eql([['/data/a', ['/data/b', '/data/c']], ['/data/s', []]]);
    });

    it('reports a never-shown group once, not again for hidden questions inside it', () => {
      const report = examine(xform({
        instance: '<g><q/></g>', binds: '<bind nodeset="/data/g" relevant="false()"/><bind nodeset="/data/g/q" relevant="1 = 2"/>',
        body: `<group ref="/data/g">${input('/data/g/q')}</group>`
      }));
      codes(report).should.eql([['never-shown', '/data/g']]);
    });

    it('finds duplicate choice names and an empty inline list', () => {
      const report = examine(xform({
        instance: '<d/><e/>',
        body: select1('/data/d', ['a', 'b', 'a']) + '<select1 ref="/data/e"><label>e</label></select1>'
      }));
      report.findings.map((f) => [f.code, f.path, f.related]).should.eql([
        ['duplicate-choice', '/data/d', ['a']],
        ['empty-choice-list', '/data/e', []]
      ]);
    });

    it('reads relative body references and does not crash on unreadable expressions', () => {
      const report = examine(xform({
        instance: '<g><q/></g><r/>',
        binds: `<bind nodeset="/data/r" relevant="${UNCONVERTED} = 1"/>`,
        body: `<group ref="/data/g"><input ref="q"><label>q</label></input></group>${input('/data/r')}`
      }));
      report.summary.questions.should.equal(2);
      report.notChecked.should.eql([{ reason: 'unreadable-expression', paths: ['/data/r'], detail: [{ path: '/data/r', attribute: 'relevant' }] }]);
    });

    it('refuses forms too large to check whole', () => {
      const many = Array.from({ length: 5001 }, (_, i) => `<q${i}/>`).join('');
      (() => examine(xform({ instance: many }))).should.throw(FormTooLarge);
      should.throws(() => examine('<notaform/>'), /not an XForm/);
    });
  });
});
