// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// S1 survey doctor through the real routes: docs/field-intelligence/S1-survey-doctor.md

require('should');
const { readFileSync } = require('fs');
const { join } = require('path');
const { testService } = require('../setup');

/* eslint-disable no-await-in-loop */

const fixture = (name) => readFileSync(join(__dirname, '../../data/survey-doctor', name), 'utf8');
const planted = fixture('planted.xml');
// The corrected form, as a new version of the planted one.
const corrected = fixture('corrected.xml').replace('id="doctor_good" version="1"', 'id="doctor_bad" version="2"');
const base = '/v1/projects/1/forms/doctor_bad';

describe('api: S1 survey doctor', () => {
  it('checks the published version, an earlier version and the draft', testService(async (service) => {
    const alice = await service.login('alice');
    await alice.post('/v1/projects/1/forms?publish=true').send(planted).set('Content-Type', 'application/xml').expect(200);

    const published = await alice.get(`${base}/doctor`).expect(200);
    published.headers['cache-control'].should.equal('private, no-store');
    published.body.should.containEql({ doctorVersion: 1, formVersion: '1', draft: false });
    published.body.hash.should.match(/^[0-9a-f]{32}$/);
    published.body.summary.should.containEql({ errors: 5, warnings: 3, notes: 2 });
    published.body.findings.map((f) => f.code).should.containEql('cycle');

    await alice.post(`${base}/draft`).send(corrected).set('Content-Type', 'application/xml').expect(200);
    const draft = (await alice.get(`${base}/draft/doctor`).expect(200)).body;
    draft.should.containEql({ formVersion: '2', draft: true });
    draft.findings.should.eql([]);

    // The published form is unchanged until the draft is published.
    (await alice.get(`${base}/doctor`).expect(200)).body.summary.errors.should.equal(5);
    await alice.post(`${base}/draft/publish`).expect(200);
    (await alice.get(`${base}/doctor`).expect(200)).body.summary.errors.should.equal(0);
    // The earlier version can still be checked.
    (await alice.get(`${base}/versions/1/doctor`).expect(200)).body.summary.errors.should.equal(5);
    await alice.get(`${base}/draft/doctor`).expect(404);
    await alice.get(`${base}/versions/9/doctor`).expect(404);
  }));

  it('lets whoever can read the form definition see the report, and only managers the draft', testService(async (service) => {
    const alice = await service.login('alice');
    const chelsea = await service.login('chelsea');
    const chelseaId = (await chelsea.get('/v1/users/current').expect(200)).body.id;
    await alice.post('/v1/projects/1/forms?publish=true').send(planted).set('Content-Type', 'application/xml').expect(200);
    await alice.post(`${base}/draft`).send(corrected).set('Content-Type', 'application/xml').expect(200);

    await chelsea.get(`${base}/doctor`).expect(403);
    await alice.post(`/v1/projects/1/assignments/viewer/${chelseaId}`).expect(200);
    await chelsea.get(`${base}/doctor`).expect(200);
    await chelsea.get(`${base}/draft/doctor`).expect(403);

    // A collector can download the form, so can read its check.
    const appUser = (await alice.post('/v1/projects/1/app-users').send({ displayName: 'Collector' }).expect(200)).body;
    await alice.post(`/v1/projects/1/forms/doctor_bad/assignments/app-user/${appUser.id}`).expect(200);
    await service.get(`${base}/doctor`).set('Authorization', `Bearer ${appUser.token}`).expect(200);
    await service.get(`${base}/draft/doctor`).set('Authorization', `Bearer ${appUser.token}`).expect(403);

    await service.get(`${base}/doctor`).expect(401);
    await alice.get('/v1/projects/99/forms/doctor_bad/doctor').expect(404);
    await alice.get('/v1/projects/1/forms/nope/doctor').expect(404);
  }));

  it('refuses a form too large to check whole, instead of checking part of it', testService(async (service) => {
    const alice = await service.login('alice');
    const many = Array.from({ length: 5001 }, (_, i) => `<q${i}/>`).join('');
    const binds = Array.from({ length: 5001 }, (_, i) => `<bind nodeset="/data/q${i}" type="string"/>`).join('');
    const big = `<?xml version="1.0"?><h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml">
      <h:head><h:title>big</h:title><model><instance><data id="big">${many}<meta><instanceID/></meta></data></instance>${binds}
      <bind nodeset="/data/meta/instanceID" type="string" readonly="true()" calculate="concat('uuid:', uuid())"/></model></h:head>
      <h:body></h:body></h:html>`;
    await alice.post('/v1/projects/1/forms?publish=true').send(big).set('Content-Type', 'application/xml').expect(200);
    const refused = await alice.get('/v1/projects/1/forms/big/doctor').expect(400);
    refused.body.code.should.equal(400.57);
  }));
});
