// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// F2 identity reuse through the real routes: docs/field-intelligence/F2-identity-reuse.md

require('should');
const { strict: assert } = require('assert');
const { sql } = require('slonik');
const { testService } = require('../setup');

/* eslint-disable no-await-in-loop */

const form = (version = '1', withDistrict = true) => `<?xml version="1.0"?>
<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa">
  <h:head>
    <h:title>Households</h:title>
    <model>
      <instance><data id="households" version="${version}"><meta><instanceID/></meta>
        <hh_code/><phone/>${withDistrict ? '<district/>' : ''}<head_name/></data></instance>
      <bind nodeset="/data/meta/instanceID" type="string" readonly="true()" calculate="concat('uuid:', uuid())"/>
      <bind nodeset="/data/hh_code" type="string"/>
      <bind nodeset="/data/phone" type="string"/>
      ${withDistrict ? '<bind nodeset="/data/district" type="string"/>' : ''}
      <bind nodeset="/data/head_name" type="string"/>
    </model>
  </h:head>
  <h:body>
    <input ref="/data/hh_code"><label>Household code</label></input>
    <input ref="/data/phone"><label>Phone</label></input>
    ${withDistrict ? '<input ref="/data/district"><label>District</label></input>' : ''}
    <input ref="/data/head_name"><label>Head of household</label></input>
  </h:body>
</h:html>`;

const instance = (id, { code = 'WA0001', phone = '', district = 'Bo', head = 'Fatmata Kamara', deprecated = null } = {}) =>
  `<data id="households" version="1"><meta>${deprecated ? `<deprecatedID>${deprecated}</deprecatedID>` : ''}<instanceID>${id}</instanceID></meta>`
  + `<hh_code>${code}</hh_code><phone>${phone}</phone><district>${district}</district><head_name>${head}</head_name></data>`;

const keys = {
  household: {
    title: 'Household code',
    explanation: 'Each household is interviewed once in this round.',
    benignExplanations: ['A follow-up visit recorded on the same form.'],
    nextStep: 'Ask the collector which visit is the right one.',
    fields: [{ field: '/hh_code' }],
    sameFields: ['/district', '/head_name']
  },
  phone: {
    title: 'Phone number',
    explanation: 'A phone number usually belongs to one household.',
    benignExplanations: ['A family or community phone shared between households.'],
    nextStep: 'Call the number and ask who it belongs to.',
    fields: [{ field: '/phone', match: 'digits' }]
  }
};

const base = '/v1/projects/1/forms/households';
const setUp = async (service, submissions) => {
  const alice = await service.login('alice');
  await alice.post('/v1/projects/1/forms?publish=true').send(form()).set('Content-Type', 'application/xml').expect(200);
  for (const [id, options] of submissions)
    await alice.post(`${base}/submissions`).send(instance(id, options)).set('Content-Type', 'application/xml').expect(200);
  return alice;
};
const create = async (user, key) => (await user.post(`${base}/identity-keys`).send(key).expect(201)).body;
const run = async (user) => (await user.post(`${base}/integrity/run`).expect(200)).body;
const findingsFor = async (user, keyId) => (await user.get(`${base}/integrity`).expect(200)).body
  .filter((f) => f.rule.endsWith(`:${keyId}`));
const caseCodes = async (one, instanceId) => (await one(sql`select rc."reasonCodes" from field_data_review_cases rc
  join field_data_claim_versions v on v.id = rc."claimVersionId"
  join submission_defs sd on sd.id = v."submissionDefId"
  join submissions s on s.id = sd."submissionId" where s."instanceId" = ${instanceId}`)).reasonCodes;

describe('api: F2 identity reuse', () => {
  it('finds a reused household code and a changed district, shows answers live and stores none',
    testService(async (service, { one, all }) => {
      const alice = await setUp(service, [
        ['uuid:first', { code: 'WA0001' }],
        ['uuid:again', { code: ' wa0001 ', district: 'Kenema', head: '' }],
        ['uuid:other', { code: 'WA0002' }],
        ['uuid:blank', { code: '' }]
      ]);
      const key = await create(alice, keys.household);
      key.should.containEql({ version: 1, revision: 1, active: true, maxUses: 1, windowDays: null, minLength: 3, status: { usable: true } });

      const result = await run(alice);
      result.identityKeys[0].should.containEql({ id: key.id, examined: 4, noKey: 1, distinct: 2, reused: 1, inconsistent: 1 });

      const found = await findingsFor(alice, key.id);
      found.map((f) => [f.rule, f.instanceId, f.relatedInstanceId]).sort().should.eql([
        [`identity-inconsistent:${key.id}`, 'uuid:again', 'uuid:first'],
        [`identity-reused:${key.id}`, 'uuid:again', 'uuid:first']
      ]);
      const reused = found.find((f) => f.rule.startsWith('identity-reused'));
      reused.evidence.should.containEql({ kind: 'reused', sharedBy: 2, title: keys.household.title });
      reused.answers.should.eql({ 'uuid:again': { '/hh_code': 'wa0001' }, 'uuid:first': { '/hh_code': 'WA0001' } });
      const changed = found.find((f) => f.rule.startsWith('identity-inconsistent'));
      // A blank head of household is not a difference; the district is.
      changed.evidence.differing.should.eql(['/district']);
      changed.answers['uuid:again']['/district'].should.equal('Kenema');
      changed.answers['uuid:first']['/district'].should.equal('Bo');

      // Nothing anybody answered is kept in the findings table.
      const stored = await all(sql`select evidence::text as e from field_data_integrity_flags where rule like 'identity-%'`);
      stored.forEach(({ e }) => e.should.not.match(/WA0001|wa0001|Kenema|Fatmata/i));

      const codes = await caseCodes(one, 'uuid:again');
      codes.should.containEql('identity-reused');
      codes.should.containEql('identity-inconsistent');
      (await caseCodes(one, 'uuid:first')).should.not.containEql('identity-reused');
      (await one(sql`select count(*)::integer as n from audits where action = 'field_data.identity_key.create'`)).n.should.equal(1);
    }));

  it('ignores placeholder phones, matches digits, allows a panel its visits and counts only within the window',
    testService(async (service, { run: exec }) => {
      const alice = await setUp(service, [
        ...Array.from({ length: 5 }, (_, i) => [`uuid:none-${i}`, { code: `P${i}00`, phone: '0000000' }]),
        ['uuid:p1', { code: 'P900', phone: '076 123-456' }],
        ['uuid:p2', { code: 'P901', phone: '(076) 123456' }]
      ]);
      const phone = await create(alice, keys.phone);
      const panel = await create(alice, { ...keys.household, title: 'Panel', maxUses: 2, sameFields: [] });
      let result = await run(alice);
      const byId = Object.fromEntries(result.identityKeys.map((k) => [k.id, k]));
      byId[phone.id].should.containEql({ noKey: 5, reused: 1 });
      byId[panel.id].should.containEql({ reused: 0 });
      (await findingsFor(alice, phone.id)).map((f) => f.instanceId).should.eql(['uuid:p2']);

      // Two visits to a panel household are expected; a third is one too many.
      for (const id of ['uuid:v1', 'uuid:v2', 'uuid:v3'])
        await alice.post(`${base}/submissions`).send(instance(id, { code: 'PANEL1' })).set('Content-Type', 'application/xml').expect(200);
      await exec(sql`update submissions set "createdAt" = now() - interval '80 days' where "instanceId" = 'uuid:v1'`);
      await exec(sql`update submissions set "createdAt" = now() - interval '40 days' where "instanceId" = 'uuid:v2'`);
      result = await run(alice);
      (await findingsFor(alice, panel.id)).filter((f) => f.outcome === 'concern').map((f) => [f.instanceId, f.relatedInstanceId])
        .should.eql([['uuid:v3', 'uuid:v1']]);

      // With a 30-day window and one use allowed, visits 40 days apart are each fine.
      const windowed = (await alice.put(`${base}/identity-keys/${panel.id}`).set('If-Match', '"key-1"')
        .send({ ...keys.household, title: 'Panel', maxUses: 1, windowDays: 30, sameFields: [] }).expect(200)).body;
      windowed.version.should.equal(2);
      result = await run(alice);
      result.withdrawn.should.equal(1);
      (await findingsFor(alice, panel.id)).filter((f) => f.outcome === 'concern').should.eql([]);
    }));

  it('keeps a shared phone resolved as explained, and withdraws once the duplicate is deleted, keeping the note',
    testService(async (service) => {
      const alice = await setUp(service, [
        ['uuid:a', { code: 'A100', phone: '076111222' }],
        ['uuid:b', { code: 'A101', phone: '076111222' }],
        ['uuid:c', { code: 'A100', phone: '' }]
      ]);
      const phone = await create(alice, keys.phone);
      const household = await create(alice, { ...keys.household, sameFields: [] });
      await run(alice);
      const [shared] = await findingsFor(alice, phone.id);
      await alice.patch(`${base}/integrity/${shared.id}`)
        .send({ status: 'resolved', decision: 'explained', note: 'Family phone.' }).expect(200);
      const [dup] = await findingsFor(alice, household.id);
      await alice.patch(`${base}/integrity/${dup.id}`).send({ status: 'investigating', note: 'Asked the collector.' }).expect(200);

      await run(alice);
      (await findingsFor(alice, phone.id))[0].should.containEql({ status: 'resolved', decision: 'explained', outcome: 'concern' });

      await alice.delete(`${base}/submissions/uuid:c`).expect(200);
      (await run(alice)).withdrawn.should.equal(1);
      const [after] = await findingsFor(alice, household.id);
      after.should.containEql({ outcome: 'withdrawn', status: 'investigating', note: 'Asked the collector.' });
      // A deleted submission's answers are no longer shown.
      assert.equal(after.answers['uuid:c'], null);
      after.answers['uuid:a'].should.eql({ '/hh_code': 'A100' });
    }));

  it('reports a key unusable when the form drops its question, and does not run or withdraw it',
    testService(async (service) => {
      const alice = await setUp(service, [['uuid:a', {}], ['uuid:b', { district: 'Kenema' }]]);
      const key = await create(alice, keys.household);
      await run(alice);
      const before = await findingsFor(alice, key.id);
      before.length.should.equal(2);
      const draft = await alice.post(`${base}/draft?ignoreWarnings=true`).send(form('2', false)).set('Content-Type', 'application/xml');
      assert.equal(draft.status, 200, JSON.stringify(draft.body));
      await alice.post(`${base}/draft/publish`).expect(200);
      (await alice.get(`${base}/identity-keys`).expect(200)).body[0].status
        .should.containEql({ usable: false, reason: 'missing-fields', missing: ['/district'] });
      const result = await run(alice);
      result.identityKeys[0].should.not.have.property('examined');
      result.withdrawn.should.equal(0);
      (await findingsFor(alice, key.id)).every((f) => f.outcome === 'concern').should.be.true();
      (await alice.put(`${base}/identity-keys/${key.id}`).set('If-Match', '"key-1"').send(keys.household).expect(400))
        .body.code.should.equal(400.56);
    }));

  it('validates keys, enforces revisions and the limit, and limits who sees the keys',
    testService(async (service) => {
      const alice = await setUp(service, []);
      const chelsea = await service.login('chelsea');
      const chelseaId = (await chelsea.get('/v1/users/current').expect(200)).body.id;

      const bad = await alice.post(`${base}/identity-keys`)
        .send({ ...keys.phone, fields: [{ field: "/phone') or 1=1 --" }] }).expect(400);
      bad.body.code.should.equal(400.56);
      bad.body.message.should.match(/fields\[0\]\.field/);
      (await alice.post(`${base}/identity-keys`).send({ ...keys.phone, benignExplanations: [] }).expect(400)).body.code.should.equal(400.56);
      (await alice.post(`${base}/identity-keys`).send({ ...keys.phone, maxUses: 0 }).expect(400)).body.code.should.equal(400.56);

      const key = await create(alice, keys.phone);
      const renamed = (await alice.put(`${base}/identity-keys/${key.id}`).set('If-Match', '"key-1"')
        .send({ ...keys.phone, title: 'Mobile number' }).expect(200)).body;
      renamed.should.containEql({ version: 1, revision: 2 });
      (await alice.put(`${base}/identity-keys/${key.id}`).set('If-Match', '"key-1"').send(keys.phone).expect(412)).body.code.should.equal(412.5);
      (await alice.put(`${base}/identity-keys/${key.id}`).send(keys.phone).expect(428)).body.code.should.equal(428.5);
      const off = (await alice.delete(`${base}/identity-keys/${key.id}`).set('If-Match', '"key-2"').expect(200)).body;
      off.should.containEql({ active: false, revision: 3 });
      (await run(alice)).identityKeys.should.eql([]);

      for (let i = 0; i < 20; i += 1) await create(alice, { ...keys.phone, title: `Key ${i}` });
      (await alice.post(`${base}/identity-keys`).send(keys.phone).expect(409)).body.code.should.equal(409.38);
      (await alice.put(`${base}/identity-keys/${key.id}`).set('If-Match', '"key-3"').send(keys.phone).expect(409))
        .body.code.should.equal(409.38);

      await chelsea.get(`${base}/identity-keys`).expect(403);
      await alice.post(`/v1/projects/1/assignments/viewer/${chelseaId}`).expect(200);
      await chelsea.get(`${base}/identity-keys`).expect(403);
      await chelsea.post(`${base}/identity-keys`).send(keys.phone).expect(403);
      await chelsea.get(`${base}/integrity`).expect(200);
      const appUser = (await alice.post('/v1/projects/1/app-users').send({ displayName: 'Collector' }).expect(200)).body;
      await service.get(`${base}/identity-keys`).set('Authorization', `Bearer ${appUser.token}`).expect(403);
      await service.get(`${base}/integrity`).set('Authorization', `Bearer ${appUser.token}`).expect(403);
      await alice.get('/v1/projects/99/forms/households/identity-keys').expect(404);
    }));
});
