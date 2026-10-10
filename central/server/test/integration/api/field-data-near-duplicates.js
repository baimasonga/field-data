// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// F4 near-duplicate submissions through the real integrity run:
// docs/field-intelligence/F4-near-duplicates.md

require('should');
const { sql } = require('slonik');
const { testService } = require('../setup');
const { NEAR_DUPLICATE } = require('../../../lib/util/near-duplicates');

/* eslint-disable no-await-in-loop */

const QUESTIONS = Array.from({ length: 10 }, (_, i) => `q${i}`);
const form = `<?xml version="1.0"?>
<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml">
  <h:head><h:title>Household survey</h:title><model>
    <instance><data id="hh_survey"><start/>${QUESTIONS.map((q) => `<${q}/>`).join('')}<region/><meta><instanceID/></meta></data></instance>
    <bind nodeset="/data/start" type="dateTime" jr:preload="timestamp" jr:preloadParams="start" xmlns:jr="http://openrosa.org/javarosa"/>
    ${QUESTIONS.map((q) => `<bind nodeset="/data/${q}" type="string"/>`).join('')}
    <bind nodeset="/data/region" type="string"/>
    <bind nodeset="/data/meta/instanceID" type="string" readonly="true()" calculate="concat('uuid:', uuid())"/>
  </model></h:head>
  <h:body>${[...QUESTIONS, 'region'].map((q) => `<input ref="/data/${q}"><label>${q}</label></input>`).join('')}</h:body>
</h:html>`;
// Answers for a household: distinct per `n`, the same region everywhere.
const answers = (n) => Object.fromEntries(QUESTIONS.map((q, i) => [q, `household ${n} answer ${i}`]));
const instance = (id, values, start = '2026-10-01T10:00:00Z') => `<data id="hh_survey"><start>${start}</start>${QUESTIONS.map((q) => `<${q}>${values[q] ?? ''}</${q}>`).join('')}<region>Bo</region><meta><instanceID>${id}</instanceID></meta></data>`;

const base = '/v1/projects/1/forms/hh_survey';
const run = async (user) => (await user.post(`${base}/integrity/run`).expect(200)).body;
const nearDuplicates = async (user) => (await user.get(`${base}/integrity`).expect(200)).body.filter((f) => f.rule === 'near-duplicate');
const caseCodes = async (all, instanceId) => (await all(sql`select rc."reasonCodes" from field_data_review_cases rc
  join field_data_claim_versions v on v.id = rc."claimVersionId"
  join submission_defs sd on sd.id = v."submissionDefId" and sd.current
  join submissions s on s.id = sd."submissionId" where s."instanceId" = ${instanceId}`))[0]?.reasonCodes ?? [];

const setUp = async (service) => {
  const alice = await service.login('alice');
  await alice.post('/v1/projects/1/forms?publish=true').send(form).set('Content-Type', 'application/xml').expect(200);
  for (let n = 0; n < 6; n += 1)
    await alice.post(`${base}/submissions`).send(instance(`hh${n}`, answers(n), `2026-10-0${n + 1}T10:00:00Z`)).set('Content-Type', 'application/xml').expect(200);
  return alice;
};

describe('api: F4 near-duplicate submissions', () => {
  it('finds a copied interview from another collector, routes it to review, stores no answers, and withdraws it once corrected', testService(async (service, { all }) => {
    const alice = await setUp(service);
    const collector = (await alice.post('/v1/projects/1/app-users').send({ displayName: 'Collector' }).expect(200)).body;
    await alice.post(`/v1/projects/1/forms/hh_survey/assignments/app-user/${collector.id}`).expect(200);
    // A copy of hh2 with a new start time and one answer changed.
    await service.post(`/v1/key/${collector.token}/projects/1/forms/hh_survey/submissions`)
      .send(instance('copy', { ...answers(2), q9: 'something else' }, '2026-10-09T08:00:00Z'))
      .set('Content-Type', 'application/xml').expect(200);

    const report = await run(alice);
    report.nearDuplicates.should.containEql({ rule: 'near-duplicate', ruleVersion: 1, ran: true, examined: 7, concern: 1, comparedQuestions: 10 });
    report.nearDuplicates.thresholds.should.eql({ similarity: 0.9, minShared: 8, maxCommonShare: 0.8 });

    const [finding] = await nearDuplicates(alice);
    finding.should.containEql({ instanceId: 'copy', relatedInstanceId: 'hh2', outcome: 'concern', status: 'open' });
    finding.evidence.should.containEql({ similarity: 0.9, identical: 9, compared: 10, differing: ['/q9'], sameCollector: false, exact: false });
    finding.evidence.explanation.should.match(/9 of 10 compared answers \(90%\)/);
    // The region (the same everywhere) and the start time are not compared; no answer is stored.
    JSON.stringify(finding.evidence).should.not.match(/household 2|something else|region/);
    (await caseCodes(all, 'copy')).should.containEql('near-duplicate');
    (await caseCodes(all, 'hh2')).should.not.containEql('near-duplicate');

    // In the project's findings inbox, as its own family.
    const inbox = (await alice.get('/v1/projects/1/findings?family=similarity').expect(200)).body;
    inbox.items.map((f) => [f.instanceId, f.family]).should.eql([['copy', 'similarity']]);

    // Running again changes nothing; correcting the copy withdraws the finding.
    (await run(alice)).nearDuplicates.concern.should.equal(1);
    (await all(sql`select id from field_data_integrity_flags where rule = 'near-duplicate'`)).length.should.equal(1);
    await alice.put(`${base}/submissions/copy`)
      .send(instance('copy2', { ...answers(2), q8: 'fixed', q9: 'something else' }).replace('<meta>', '<meta><deprecatedID>copy</deprecatedID>'))
      .set('Content-Type', 'application/xml').expect(200);
    (await run(alice)).withdrawn.should.equal(1);
    (await nearDuplicates(alice))[0].outcome.should.equal('withdrawn');
  }));

  it('does not run on forms too large to compare, and reports why', testService(async (service) => {
    const alice = await setUp(service);
    const max = NEAR_DUPLICATE.maxSubmissions;
    NEAR_DUPLICATE.maxSubmissions = 3;
    try {
      (await run(alice)).nearDuplicates.should.containEql({ ran: false, reason: 'too-many-submissions', examined: 6 });
    } finally { NEAR_DUPLICATE.maxSubmissions = max; }
    (await run(alice)).nearDuplicates.should.containEql({ ran: true, concern: 0 });
  }));
});
