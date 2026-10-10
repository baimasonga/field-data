// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// F5 groups of collectors whose submissions keep matching, from real
// near-duplicate findings: docs/field-intelligence/F5-collusion-groups.md

require('should');
const { sql } = require('slonik');
const { testService } = require('../setup');

/* eslint-disable no-await-in-loop */

const QUESTIONS = Array.from({ length: 10 }, (_, i) => `q${i}`);
const form = `<?xml version="1.0"?>
<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml">
  <h:head><h:title>Household survey</h:title><model>
    <instance><data id="hh_survey">${QUESTIONS.map((q) => `<${q}/>`).join('')}<meta><instanceID/></meta></data></instance>
    ${QUESTIONS.map((q) => `<bind nodeset="/data/${q}" type="string"/>`).join('')}
    <bind nodeset="/data/meta/instanceID" type="string" readonly="true()" calculate="concat('uuid:', uuid())"/>
  </model></h:head>
  <h:body>${QUESTIONS.map((q) => `<input ref="/data/${q}"><label>${q}</label></input>`).join('')}</h:body>
</h:html>`;
const household = (n) => Object.fromEntries(QUESTIONS.map((q, i) => [q, `household ${n} answer ${i}`]));
const instance = (id, values) => `<data id="hh_survey">${QUESTIONS.map((q) => `<${q}>${values[q]}</${q}>`).join('')}<meta><instanceID>${id}</instanceID></meta></data>`;
const base = '/v1/projects/1/forms/hh_survey';
const collectors = (user, q = '') => user.get(`/v1/projects/1/findings/collectors${q}`);

// Aminata collects households 0-2; Bockarie copies them and collects 3-5;
// Christiana copies Bockarie's 3-5. Alice collects 6-9 honestly.
const setUp = async (service) => {
  const alice = await service.login('alice');
  await alice.post('/v1/projects/1/forms?publish=true').send(form).set('Content-Type', 'application/xml').expect(200);
  const users = {};
  for (const name of ['Aminata', 'Bockarie', 'Christiana']) {
    users[name] = (await alice.post('/v1/projects/1/app-users').send({ displayName: name }).expect(200)).body;
    await alice.post(`/v1/projects/1/forms/hh_survey/assignments/app-user/${users[name].id}`).expect(200);
  }
  const submit = (name, id, values) => service.post(`/v1/key/${users[name].token}/projects/1/forms/hh_survey/submissions`)
    .send(instance(id, values)).set('Content-Type', 'application/xml').expect(200);
  for (const n of [0, 1, 2]) await submit('Aminata', `a${n}`, household(n));
  for (const n of [3, 4, 5]) await submit('Bockarie', `b${n}`, household(n));
  for (const n of [0, 1, 2]) await submit('Bockarie', `bcopy${n}`, { ...household(n), q9: 'changed' });
  for (const n of [3, 4, 5]) await submit('Christiana', `ccopy${n}`, household(n));
  for (const n of [6, 7, 8, 9]) await alice.post(`${base}/submissions`).send(instance(`h${n}`, household(n))).set('Content-Type', 'application/xml').expect(200);
  (await alice.post(`${base}/integrity/run`).expect(200)).body.nearDuplicates.concern.should.equal(6);
  return { alice, users };
};

describe('api: F5 groups of collectors whose submissions keep matching', () => {
  it('connects collectors through repeated matches, and leaves out explained findings', testService(async (service, { run }) => {
    const { alice, users } = await setUp(service);
    const { body } = await collectors(alice).expect(200);
    body.should.containEql({ minLinks: 3, links: 6 });
    body.groups.length.should.equal(1);
    const [group] = body.groups;
    group.members.map((m) => m.displayName).should.eql(['Bockarie', 'Aminata', 'Christiana']);
    group.members[0].links.should.equal(6);
    group.connections.should.eql([
      { a: users.Aminata.id, b: users.Bockarie.id, links: 3, byRule: { 'near-duplicate': 3 } },
      { a: users.Bockarie.id, b: users.Christiana.id, links: 3, byRule: { 'near-duplicate': 3 } }
    ]);
    group.forms.should.eql([{ xmlFormId: 'hh_survey', formName: 'Household survey' }]);
    group.findings.map((f) => f.instanceId).sort().should.eql(['bcopy0', 'bcopy1', 'bcopy2', 'ccopy3', 'ccopy4', 'ccopy5']);
    group.should.containEql({ findingsShown: 6, findingsTotal: 6 });

    // A finding explained in review no longer counts: Aminata drops out at 3.
    const finding = (await alice.get(`${base}/integrity`).expect(200)).body.find((f) => f.instanceId === 'bcopy0');
    await alice.patch(`${base}/integrity/${finding.id}`).send({ status: 'resolved', decision: 'explained', note: 'Same household, two members.' }).expect(200);
    const after = (await collectors(alice).expect(200)).body;
    after.links.should.equal(5);
    after.groups[0].members.map((m) => m.displayName).should.eql(['Bockarie', 'Christiana']);
    (await collectors(alice, '?minLinks=2').expect(200)).body.groups[0].members.length.should.equal(3);
    (await collectors(alice, '?minLinks=4').expect(200)).body.groups.should.eql([]);
    // Nor does one a later run withdrew.
    await run(sql`update field_data_integrity_flags set outcome = 'withdrawn' where "instanceId" = 'ccopy5'`);
    (await collectors(alice).expect(200)).body.should.containEql({ links: 4, groups: [] });
  }));

  it('limits who can see it, and refuses bad settings', testService(async (service) => {
    const { alice, users } = await setUp(service);
    const chelsea = await service.login('chelsea');
    const chelseaId = (await chelsea.get('/v1/users/current').expect(200)).body.id;
    await collectors(chelsea).expect(403);
    await alice.post(`/v1/projects/1/assignments/viewer/${chelseaId}`).expect(200);
    (await collectors(chelsea).expect(200)).body.groups.length.should.equal(1);
    await service.get('/v1/projects/1/findings/collectors').set('Authorization', `Bearer ${users.Aminata.token}`).expect(403);
    for (const q of ['?minLinks=1', '?minLinks=21', '?minLinks=x', '?minLinks=3.5', '?minLinks=-3'])
      (await collectors(alice, q).expect(400)).body.code.should.equal(400.8);
    await collectors(alice, '?minLinks=20').expect(200);
    await alice.get('/v1/projects/99/findings/collectors').expect(404);
  }));
});
