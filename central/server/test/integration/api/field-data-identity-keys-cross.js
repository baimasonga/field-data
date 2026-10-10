// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// F2b identity keys across forms through the real routes: docs/field-intelligence/F2b-cross-form-identity.md

require('should');
const { sql } = require('slonik');
const { testService } = require('../setup');

/* eslint-disable no-await-in-loop */

// Round 1 asks top-level questions; round 2 asks them in a group with other names.
const round1 = `<?xml version="1.0"?>
<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml">
  <h:head><h:title>Round 1</h:title><model>
    <instance><data id="round1" version="1"><meta><instanceID/></meta><hh_code/><district/></data></instance>
    <bind nodeset="/data/meta/instanceID" type="string" readonly="true()" calculate="concat('uuid:', uuid())"/>
    <bind nodeset="/data/hh_code" type="string"/><bind nodeset="/data/district" type="string"/>
  </model></h:head>
  <h:body><input ref="/data/hh_code"><label>Code</label></input><input ref="/data/district"><label>District</label></input></h:body>
</h:html>`;
const round2 = (version = '1', withArea = true) => `<?xml version="1.0"?>
<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml">
  <h:head><h:title>Round 2</h:title><model>
    <instance><data id="round2" version="${version}"><meta><instanceID/></meta><household><code/>${withArea ? '<area/>' : ''}</household></data></instance>
    <bind nodeset="/data/meta/instanceID" type="string" readonly="true()" calculate="concat('uuid:', uuid())"/>
    <bind nodeset="/data/household/code" type="string"/>${withArea ? '<bind nodeset="/data/household/area" type="string"/>' : ''}
  </model></h:head>
  <h:body><group ref="/data/household"><input ref="/data/household/code"><label>Code</label></input>${withArea ? '<input ref="/data/household/area"><label>Area</label></input>' : ''}</group></h:body>
</h:html>`;
const r1 = (id, code, district) => `<data id="round1" version="1"><meta><instanceID>${id}</instanceID></meta><hh_code>${code}</hh_code><district>${district}</district></data>`;
const r2 = (id, code, area) => `<data id="round2" version="1"><meta><instanceID>${id}</instanceID></meta><household><code>${code}</code><area>${area}</area></household></data>`;

const mapping = { xmlFormId: 'round1', fields: { '/household/code': '/hh_code' }, sameFields: { '/household/area': '/district' } };
const key = (extra = {}) => ({
  title: 'Household code', explanation: 'Each household is interviewed once per round.',
  benignExplanations: ['A follow-up visit.'], nextStep: 'Ask which visit is right.',
  fields: [{ field: '/household/code' }], sameFields: ['/household/area'], alsoIn: [mapping], ...extra
});
const base = '/v1/projects/1/forms/round2';

const setUp = async (service) => {
  const alice = await service.login('alice');
  await alice.post('/v1/projects/1/forms?publish=true').send(round1).set('Content-Type', 'application/xml').expect(200);
  await alice.post('/v1/projects/1/forms?publish=true').send(round2()).set('Content-Type', 'application/xml').expect(200);
  const send = (form, xml) => alice.post(`/v1/projects/1/forms/${form}/submissions`).send(xml).set('Content-Type', 'application/xml').expect(200);
  await send('round1', r1('uuid:r1-a', 'WA0001', 'Bo'));
  await send('round1', r1('uuid:r1-b', 'WA0002', 'Kenema'));
  await send('round2', r2('uuid:r2-a', 'wa0001', 'Kenema'));
  await send('round2', r2('uuid:r2-c', 'WA0003', 'Bo'));
  return alice;
};
const findings = async (user) => (await user.get(`${base}/integrity`).expect(200)).body.filter((f) => f.rule.startsWith('identity-'));

describe('api: F2b identity keys across forms', () => {
  it('finds a household from round 1 again in round 2, flags only round 2, and shows both answers', testService(async (service, { all }) => {
    const alice = await setUp(service);
    const created = (await alice.post(`${base}/identity-keys`).send(key()).expect(201)).body;
    created.alsoIn.should.eql([mapping]);
    created.alsoInStatus.should.eql({ round1: { usable: true } });

    const run = (await alice.post(`${base}/integrity/run`).expect(200)).body;
    run.identityKeys[0].should.containEql({ examined: 2, examinedElsewhere: 2, reused: 1, inconsistent: 1, alsoIn: { round1: { usable: true } } });
    const found = await findings(alice);
    found.map((f) => [f.rule.split(':')[0], f.instanceId, f.relatedInstanceId]).sort().should.eql([
      ['identity-inconsistent', 'uuid:r2-a', 'uuid:r1-a'],
      ['identity-reused', 'uuid:r2-a', 'uuid:r1-a']
    ]);
    const changed = found.find((f) => f.rule.startsWith('identity-inconsistent'));
    changed.evidence.others.should.eql([{ instanceId: 'uuid:r1-a', receivedAt: changed.evidence.others[0].receivedAt, submitter: changed.evidence.others[0].submitter, xmlFormId: 'round1' }]);
    // The other form's answers are read live through the mapping, under this key's own paths.
    changed.answers.should.eql({
      'uuid:r2-a': { '/household/code': 'wa0001', '/household/area': 'Kenema' },
      'uuid:r1-a': { '/household/code': 'WA0001', '/household/area': 'Bo' }
    });
    // Round 1 is evidence, not flagged: no finding lives on round 1.
    const onRound1 = await all(sql`select count(*)::integer as n from field_data_integrity_flags i join forms f on f.id = i."formId" where f."xmlFormId" = 'round1'`);
    onRound1[0].n.should.equal(0);
    // A panel allowing one visit per round finds no reuse.
    const k = (await alice.get(`${base}/identity-keys`).expect(200)).body[0];
    await alice.put(`${base}/identity-keys/${k.id}`).set('If-Match', '"key-1"').send(key({ maxUses: 2 })).expect(200);
    (await alice.post(`${base}/integrity/run`).expect(200)).body.identityKeys[0].reused.should.equal(0);
  }));

  it('refuses mappings that cannot work, including a form of another project', testService(async (service) => {
    const alice = await setUp(service);
    const bad = async (alsoIn) => (await alice.post(`${base}/identity-keys`).send(key({ alsoIn })).expect(400)).body;
    (await bad([{ ...mapping, xmlFormId: 'round2' }])).message.should.match(/another form than the key's own/);
    (await bad([{ ...mapping, xmlFormId: 'nope' }])).message.should.match(/another form in this project/);
    (await bad([{ ...mapping, fields: {} }])).code.should.equal(400.56);
    (await bad([{ ...mapping, fields: { '/household/code': '/missing' } }])).code.should.equal(400.56);
    (await bad([mapping, mapping])).code.should.equal(400.56);
    // A form of another project is not a form of this one.
    const other = (await alice.post('/v1/projects').send({ name: 'Other' }).expect(200)).body;
    await alice.post(`/v1/projects/${other.id}/forms?publish=true`).send(round1.replace('id="round1"', 'id="elsewhere"'))
      .set('Content-Type', 'application/xml').expect(200);
    (await bad([{ ...mapping, xmlFormId: 'elsewhere' }])).message.should.match(/another form in this project/);
  }));

  it('runs without a form whose mapped question was removed, and says so', testService(async (service) => {
    const alice = await setUp(service);
    await alice.post(`${base}/identity-keys`).send(key({ alsoIn: [{ xmlFormId: 'round1', fields: { '/household/code': '/hh_code' } }] })).expect(201);
    // Round 1 drops hh_code.
    await alice.post('/v1/projects/1/forms/round1/draft?ignoreWarnings=true').send(round1.replace('version="1"', 'version="2"')
      .replace('<hh_code/>', '').replace('<bind nodeset="/data/hh_code" type="string"/>', '').replace('<input ref="/data/hh_code"><label>Code</label></input>', ''))
      .set('Content-Type', 'application/xml').expect(200);
    await alice.post('/v1/projects/1/forms/round1/draft/publish').expect(200);
    const run = (await alice.post(`${base}/integrity/run`).expect(200)).body.identityKeys[0];
    run.alsoIn.round1.should.containEql({ usable: false, reason: 'missing-fields', missing: ['/hh_code'] });
    run.should.containEql({ examined: 2, reused: 0 });
    run.should.not.have.property('examinedElsewhere');
    (await alice.get(`${base}/identity-keys`).expect(200)).body[0].alsoInStatus.round1.usable.should.equal(false);
  }));

  it('stops showing a deleted form\'s answers, and withdraws what depended on it', testService(async (service) => {
    const alice = await setUp(service);
    await alice.post(`${base}/identity-keys`).send(key()).expect(201);
    await alice.post(`${base}/integrity/run`).expect(200);
    await alice.delete('/v1/projects/1/forms/round1').expect(200);
    const changed = (await findings(alice)).find((f) => f.rule.startsWith('identity-inconsistent'));
    (changed.answers['uuid:r1-a'] === null).should.be.true();
    changed.answers['uuid:r2-a']['/household/code'].should.equal('wa0001');
    // The next run no longer finds round 1, and withdraws the findings.
    (await alice.post(`${base}/integrity/run`).expect(200)).body.identityKeys[0].alsoIn.round1.should.containEql({ usable: false, reason: 'not-available' });
    (await findings(alice)).every((f) => f.outcome === 'withdrawn').should.be.true();
  }));
});
