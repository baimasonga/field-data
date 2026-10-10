// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// F1 answer contradictions through the real routes: docs/field-intelligence/F1-answer-contradictions.md

require('should');
const { strict: assert } = require('assert');
const { sql } = require('slonik');
const { testService } = require('../setup');

/* eslint-disable no-await-in-loop */

const form = (version = '1', withElectricity = true) => `<?xml version="1.0"?>
<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa">
  <h:head>
    <h:title>Household</h:title>
    <model>
      <instance><data id="household" version="${version}"><meta><instanceID/></meta>
        ${withElectricity ? '<electricity/>' : ''}<assets/><hh_size/><adult_count/><remarks/>
        <member jr:template=""><age/><relation/></member></data></instance>
      <bind nodeset="/data/meta/instanceID" type="string" readonly="true()" calculate="concat('uuid:', uuid())"/>
      ${withElectricity ? '<bind nodeset="/data/electricity" type="string"/>' : ''}
      <bind nodeset="/data/assets" type="string"/>
      <bind nodeset="/data/hh_size" type="int"/>
      <bind nodeset="/data/adult_count" type="int"/>
      <bind nodeset="/data/remarks" type="string"/>
      <bind nodeset="/data/member/age" type="int"/>
      <bind nodeset="/data/member/relation" type="string"/>
    </model>
  </h:head>
  <h:body>
    ${withElectricity ? '<select1 ref="/data/electricity"><label>Electricity</label><item><label>None</label><value>none</value></item><item><label>Grid</label><value>grid</value></item></select1>' : ''}
    <select ref="/data/assets"><label>Assets</label><item><label>TV</label><value>tv</value></item><item><label>Fridge</label><value>fridge</value></item></select>
    <input ref="/data/hh_size"><label>Household size</label></input>
    <input ref="/data/adult_count"><label>Adults</label></input>
    <input ref="/data/remarks"><label>Remarks</label></input>
    <group ref="/data/member"><label>Member</label><repeat nodeset="/data/member">
      <input ref="/data/member/age"><label>Age</label></input>
      <input ref="/data/member/relation"><label>Relation</label></input>
    </repeat></group>
  </h:body>
</h:html>`;

const instance = (id, { electricity = 'none', assets = 'tv fridge', adults = '2', members = [['40', 'head'], ['38', 'spouse'], ['9', 'child']], remarks = '', deprecated = null, version = '1' } = {}) =>
  `<data id="household" version="${version}"><meta>${deprecated ? `<deprecatedID>${deprecated}</deprecatedID>` : ''}<instanceID>${id}</instanceID></meta>`
  + `<electricity>${electricity}</electricity><assets>${assets}</assets><hh_size>${members.length}</hh_size>`
  + `<adult_count>${adults}</adult_count><remarks>${remarks}</remarks>`
  + members.map(([age, relation]) => `<member><age>${age}</age><relation>${relation}</relation></member>`).join('')
  + '</data>';

const rules = {
  adults: {
    title: 'Adults in roster differ from adult count',
    explanation: 'The roster lists a different number of adults from the count asked earlier.',
    benignExplanations: ['A member turned 18 between the two questions.'],
    nextStep: 'Ask the collector to recount the roster.',
    conditions: [{ count: { repeat: '/member', where: [{ field: '/member/age', op: '>=', value: '18' }] }, op: '<>', otherField: '/adult_count' }]
  },
  fridge: {
    title: 'No electricity but owns a fridge',
    explanation: 'A household without electricity reports a fridge.',
    benignExplanations: ['The fridge is owned but not in use.', 'It runs from a neighbour’s supply.'],
    nextStep: 'Ask whether the fridge is in use.',
    conditions: [{ field: '/electricity', op: '=', value: 'none' }, { field: '/assets', op: 'selected', value: 'fridge' }]
  },
  remarks: {
    title: 'Remarks say refused',
    explanation: 'Remarks record a refusal although the interview was completed.',
    benignExplanations: ['The respondent refused one question only.'],
    nextStep: 'Read the remarks.',
    conditions: [{ field: '/remarks', op: '=', value: 'refused' }]
  }
};

const base = '/v1/projects/1/forms/household';
const setUp = async (service, submissions) => {
  const alice = await service.login('alice');
  await alice.post('/v1/projects/1/forms?publish=true').send(form()).set('Content-Type', 'application/xml').expect(200);
  for (const [id, options] of submissions)
    await alice.post(`${base}/submissions`).send(instance(id, options)).set('Content-Type', 'application/xml').expect(200);
  return alice;
};
const create = async (user, rule) => (await user.post(`${base}/contradiction-rules`).send(rule).expect(201)).body;
const run = async (user) => (await user.post(`${base}/integrity/run`).expect(200)).body;
const findingsFor = async (user, ruleId) => (await user.get(`${base}/integrity`).expect(200)).body
  .filter((f) => f.rule === `contradiction:${ruleId}`);

describe('api: F1 answer contradictions', () => {
  it('finds a known-bad roster, shows the answers, leaves an unanswered rule uncounted, and routes it to review',
    testService(async (service, { one }) => {
      const alice = await setUp(service, [
        ['uuid:bad', { adults: '3' }],
        ['uuid:good', { electricity: 'grid' }],
        ['uuid:unknown-age', { members: [['40', 'head'], ['', 'spouse']], adults: '2' }]
      ]);
      const adults = await create(alice, rules.adults);
      adults.should.containEql({ version: 1, revision: 1, active: true, status: { usable: true } });
      const fridge = await create(alice, rules.fridge);
      const remarks = await create(alice, rules.remarks);

      const result = await run(alice);
      const summary = Object.fromEntries(result.contradictionRules.map((r) => [r.id, r]));
      summary[adults.id].should.containEql({ examined: 3, matched: 1, notEvaluated: 1 });
      summary[fridge.id].should.containEql({ examined: 3, matched: 2 });
      // Benign lookalike: an optional answer left blank is not a finding.
      summary[remarks.id].should.containEql({ matched: 0, notEvaluated: 3 });

      const [finding] = await findingsFor(alice, adults.id);
      finding.should.containEql({ instanceId: 'uuid:bad', outcome: 'concern', ruleVersion: 1 });
      finding.evidence.should.containEql({ title: rules.adults.title, nextStep: rules.adults.nextStep });
      finding.evidence.alternatives.should.eql(rules.adults.benignExplanations);
      finding.evidence.conditions[0].should.containEql({ counted: 2, compareAnswer: '3', op: '<>' });
      // The rule's own count definition is kept beside the number counted.
      finding.evidence.conditions[0].count.repeat.should.equal('/member');
      (await findingsFor(alice, fridge.id)).map((f) => f.instanceId).sort().should.eql(['uuid:bad', 'uuid:unknown-age']);

      const codes = await one(sql`select rc."reasonCodes" from field_data_review_cases rc
        join field_data_claim_versions v on v.id = rc."claimVersionId"
        join submission_defs sd on sd.id = v."submissionDefId"
        join submissions s on s.id = sd."submissionId" where s."instanceId" = 'uuid:bad'`);
      codes.reasonCodes.should.containEql('answer-contradiction');
      const audits = await one(sql`select count(*)::integer as n from audits where action = 'field_data.contradiction_rule.create'`);
      audits.n.should.equal(3);
    }));

  it('versions a rule only when its conditions change, and withdraws findings of the old version',
    testService(async (service) => {
      const alice = await setUp(service, [['uuid:bad', {}]]);
      const rule = await create(alice, rules.fridge);
      await run(alice);
      const [v1] = await findingsFor(alice, rule.id);

      const renamed = (await alice.put(`${base}/contradiction-rules/${rule.id}`).set('If-Match', '"rule-1"')
        .send({ ...rules.fridge, title: 'Renamed' }).expect(200)).body;
      renamed.should.containEql({ version: 1, revision: 2, title: 'Renamed' });
      await alice.put(`${base}/contradiction-rules/${rule.id}`).set('If-Match', '"rule-1"').send(rules.fridge).expect(412);
      await alice.put(`${base}/contradiction-rules/${rule.id}`).send(rules.fridge).expect(428);

      const changed = (await alice.put(`${base}/contradiction-rules/${rule.id}`).set('If-Match', '"rule-2"')
        .send({ ...rules.fridge, conditions: [rules.fridge.conditions[1]] }).expect(200)).body;
      changed.version.should.equal(2);
      const result = await run(alice);
      result.withdrawn.should.equal(1);
      const rows = await findingsFor(alice, rule.id);
      const old = rows.find((f) => f.id === v1.id);
      old.should.containEql({ outcome: 'withdrawn', ruleVersion: 1 });
      old.evidence.withdrawnReason.should.match(/now version 2/);
      // The old finding still shows the conditions it was found under.
      old.evidence.conditions.should.have.length(2);
      rows.find((f) => f.ruleVersion === 2).outcome.should.equal('concern');
    }));

  it('withdraws a finding once the submission is corrected, keeping the reviewer note',
    testService(async (service) => {
      const alice = await setUp(service, [['uuid:bad', {}]]);
      const rule = await create(alice, rules.fridge);
      await run(alice);
      const [finding] = await findingsFor(alice, rule.id);
      await alice.patch(`${base}/integrity/${finding.id}`).send({ status: 'investigating', note: 'Called the collector.' }).expect(200);
      await alice.put(`${base}/submissions/uuid:bad`)
        .send(instance('uuid:bad-2', { electricity: 'grid', deprecated: 'uuid:bad' })).set('Content-Type', 'application/xml').expect(200);
      (await run(alice)).withdrawn.should.equal(1);
      const [after] = await findingsFor(alice, rule.id);
      after.should.containEql({ outcome: 'withdrawn', status: 'investigating', note: 'Called the collector.' });
    }));

  it('reports a rule unusable when a new form version drops its question, and does not run or withdraw it',
    testService(async (service) => {
      const alice = await setUp(service, [['uuid:bad', {}]]);
      const rule = await create(alice, rules.fridge);
      await run(alice);
      const draft = await alice.post(`${base}/draft?ignoreWarnings=true`).send(form('2', false)).set('Content-Type', 'application/xml');
      assert.equal(draft.status, 200, JSON.stringify(draft.body));
      await alice.post(`${base}/draft/publish`).expect(200);
      const listed = (await alice.get(`${base}/contradiction-rules`).expect(200)).body;
      listed[0].status.should.containEql({ usable: false, reason: 'missing-fields', missing: ['/electricity'] });
      const result = await run(alice);
      result.contradictionRules[0].status.usable.should.equal(false);
      // Not run at all: older submissions still carry the dropped question, so a
      // run would look plausible while checking a question the form no longer asks.
      result.contradictionRules[0].should.not.have.property('examined');
      result.withdrawn.should.equal(0);
      (await findingsFor(alice, rule.id))[0].outcome.should.equal('concern');
      // It cannot be saved against the new form until it is rewritten.
      (await alice.put(`${base}/contradiction-rules/${rule.id}`).set('If-Match', '"rule-1"').send(rules.fridge).expect(400))
        .body.code.should.equal(400.55);
    }));

  it('validates rules, enforces the limit, deactivates instead of deleting, and limits who sees the logic',
    testService(async (service) => {
      const alice = await setUp(service, []);
      const chelsea = await service.login('chelsea');
      const chelseaId = (await chelsea.get('/v1/users/current').expect(200)).body.id;

      const bad = await alice.post(`${base}/contradiction-rules`)
        .send({ ...rules.fridge, conditions: [{ field: "/electricity') or 1=1 --", op: '=', value: 'x' }] }).expect(400);
      bad.body.code.should.equal(400.55);
      bad.body.message.should.match(/conditions\[0\]\.field/);
      (await alice.post(`${base}/contradiction-rules`).send({ ...rules.fridge, benignExplanations: [] }).expect(400))
        .body.code.should.equal(400.55);

      const rule = await create(alice, rules.fridge);
      const off = (await alice.delete(`${base}/contradiction-rules/${rule.id}`).set('If-Match', '"rule-1"').expect(200)).body;
      off.should.containEql({ active: false, revision: 2 });
      (await alice.get(`${base}/contradiction-rules`).expect(200)).body.should.have.length(1);
      (await run(alice)).contradictionRules.should.eql([]);

      for (let i = 0; i < 50; i += 1) await create(alice, { ...rules.remarks, title: `Rule ${i}` });
      (await alice.post(`${base}/contradiction-rules`).send(rules.remarks).expect(409)).body.code.should.equal(409.37);
      (await alice.put(`${base}/contradiction-rules/${rule.id}`).set('If-Match', '"rule-2"').send(rules.fridge).expect(409))
        .body.code.should.equal(409.37);

      // A viewer reads findings like other integrity findings, but not the rule logic.
      await chelsea.get(`${base}/contradiction-rules`).expect(403);
      await alice.post(`/v1/projects/1/assignments/viewer/${chelseaId}`).expect(200);
      await chelsea.get(`${base}/contradiction-rules`).expect(403);
      await chelsea.post(`${base}/contradiction-rules`).send(rules.remarks).expect(403);
      await chelsea.get(`${base}/integrity`).expect(200);
      const appUser = (await alice.post('/v1/projects/1/app-users').send({ displayName: 'Collector' }).expect(200)).body;
      await service.get(`${base}/contradiction-rules`).set('Authorization', `Bearer ${appUser.token}`).expect(403);
      await alice.get('/v1/projects/99/forms/household/contradiction-rules').expect(404);
      assert.ok(true);
    }));
});
