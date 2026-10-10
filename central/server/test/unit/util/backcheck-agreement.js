require('should');
const { questionOf, askedQuestions, fieldsOf, aggregate } = require('../../../lib/util/backcheck-agreement');
const { compareAnswers, compareMappedAnswers } = require('../../../lib/util/backcheck-comparison');

const form = `<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa">
  <h:head><h:title>Visit</h:title><model>
    <itext><translation lang="English"><text id="/data/water:label"><value>Main water source</value></text></translation></itext>
    <instance><data id="visit"><start/><end/><name/><double/><water/><household><member/></household><meta><instanceID/></meta></data></instance>
    <bind nodeset="/data/start" type="dateTime" jr:preload="timestamp" jr:preloadParams="start"/>
    <bind nodeset="/data/end" type="dateTime" jr:preload="timestamp" jr:preloadParams="end"/>
    <bind nodeset="/data/double" calculate="/data/name"/>
    <bind nodeset="/data/meta/instanceID" type="string" calculate="concat('uuid:', uuid())"/>
  </model></h:head>
  <h:body>
    <input ref="/data/name"><label>Respondent name</label></input>
    <select1 ref="/data/water"><label ref="jr:itext('/data/water:label')"/><item><label>Tap</label><value>tap</value></item></select1>
    <repeat nodeset="/data/household"><input ref="/data/household/member"><label>Member</label></input></repeat>
  </h:body>
</h:html>`;
const submission = (name, water, members, start) => `<data id="visit"><start>${start}</start><end>${start}</end><name>${name}</name><double>${name}</double>${water == null ? '' : `<water>${water}</water>`}${members.map((m) => `<household><member>${m}</member></household>`).join('')}<meta><instanceID>uuid:${start}</instanceID></meta></data>`;

describe('(util) backcheck agreement', () => {
  it('names an answer path by its question', () => {
    questionOf('/household[2]/member[1]').should.equal('/household/member');
    questionOf('/{http%3A%2F%2Fexample.org}name[1]').should.equal('/name');
  });

  it('lists only questions the form asks, with their labels', () => {
    const asked = askedQuestions(form);
    [...asked.entries()].should.eql([['/name', 'Respondent name'], ['/water', 'Main water source'], ['/household/member', 'Member']]);
  });

  it('keeps asked questions of a comparison by question, each repeat a field', () => {
    const asked = askedQuestions(form);
    const comparison = compareAnswers(submission('Awa', 'tap', ['A', 'B'], '1'), submission('Awa', null, ['A', 'C'], '2'));
    fieldsOf(comparison, { mapped: false, asked }).should.eql([
      { question: '/household/member', label: 'Member', result: 'agree' },
      { question: '/household/member', label: 'Member', result: 'differ' },
      { question: '/name', label: 'Respondent name', result: 'agree' },
      { question: '/water', label: 'Main water source', result: 'missing' }
    ]);
    fieldsOf(comparison, { mapped: false, asked: null }).should.eql([]);
  });

  it('uses mapped pairs and their labels, leaving out unmapped answers', () => {
    const asked = askedQuestions(form);
    const comparison = compareMappedAnswers(submission('Awa', 'tap', [], '1'), '<check><who>Ama</who><src>tap</src><extra>x</extra></check>', [
      { originalPath: '/name[1]', backcheckPath: '/who[1]', label: 'Name' },
      { originalPath: '/water[1]', backcheckPath: '/src[1]', label: '' }
    ]);
    fieldsOf(comparison, { mapped: true, asked }).should.eql([
      { question: 'mapped:Name', label: 'Name', result: 'differ' },
      { question: 'mapped:Main water source', label: 'Main water source', result: 'agree' }
    ]);
  });

  it('adds up by collector and question, ordering by share', () => {
    const f = (question, result) => ({ question, label: question, result });
    const result = aggregate([
      { actorId: 2, displayName: 'Bai', fields: [f('/a', 'agree'), f('/b', 'agree')] },
      { actorId: 1, displayName: 'Ama', fields: [f('/a', 'differ'), f('/b', 'agree'), f('/c', 'missing')] },
      { actorId: 1, displayName: 'Ama', fields: [f('/a', 'agree'), f('/b', 'agree')] },
      { actorId: 3, displayName: 'Abu', fields: [f('/a', 'agree')] },
      { actorId: 4, displayName: 'Zed', fields: [] }
    ]);
    result.collectors.should.eql([
      { actorId: 1, displayName: 'Ama', backchecks: 2, withDifferences: 1, fields: 4, different: 1, missing: 1 },
      { actorId: 3, displayName: 'Abu', backchecks: 1, withDifferences: 0, fields: 1, different: 0, missing: 0 },
      { actorId: 2, displayName: 'Bai', backchecks: 1, withDifferences: 0, fields: 2, different: 0, missing: 0 },
      { actorId: 4, displayName: 'Zed', backchecks: 1, withDifferences: 0, fields: 0, different: 0, missing: 0 }
    ]);
    result.questions.map((q) => [q.question, q.fields, q.different, q.missing]).should.eql([
      ['/a', 4, 1, 0], ['/b', 3, 0, 0], ['/c', 0, 0, 1]
    ]);
  });
});
