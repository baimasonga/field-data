// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// S3 version changes through the real routes: docs/field-intelligence/S3-version-changes.md

const should = require('should');
const { testService } = require('../setup');

/* eslint-disable no-await-in-loop */

// A form whose version string, age constraint, water choices and phone question
// vary. (Central refuses a type change at the same path, 400.17.)
const form = ({ id = 'changing', version = '1', adult = false, tap = 'Public tap', extra = false }) => `<?xml version="1.0"?>
<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa">
  <h:head><h:title>Changing</h:title><model>
    <instance><data id="${id}"${version == null ? '' : ` version="${version}"`}><name/><age/><water/>${extra ? '<phone/>' : ''}<meta><instanceID/></meta></data></instance>
    <bind nodeset="/data/name" type="string"/>
    <bind nodeset="/data/age" type="int"${adult ? ' constraint=". &gt;= 18"' : ''}/>
    <bind nodeset="/data/water" type="select1"/>
    ${extra ? '<bind nodeset="/data/phone" type="string"/>' : ''}
    <bind nodeset="/data/meta/instanceID" type="string" readonly="true()" calculate="concat('uuid:', uuid())"/>
  </model></h:head>
  <h:body>
    <input ref="/data/name"><label>Name</label></input>
    <input ref="/data/age"><label>Age</label></input>
    <select1 ref="/data/water"><label>Water</label><item><label>${tap}</label><value>tap</value></item><item><label>Well</label><value>well</value></item></select1>
    ${extra ? '<input ref="/data/phone"><label>Phone</label></input>' : ''}
  </h:body>
</h:html>`;
const base = '/v1/projects/1/forms/changing';
const xml = (request, body) => request.send(body).set('Content-Type', 'application/xml');
const codes = (body) => body.changes.map((c) => [c.effect, c.code, c.path]);

describe('api: S3 version changes', () => {
  it('compares a draft with the published version, and a version with the one before it', testService(async (service) => {
    const alice = await service.login('alice');

    // A form never published has nothing to compare with.
    await xml(alice.post('/v1/projects/1/forms'), form({})).expect(200);
    const unpublished = (await alice.get(`${base}/draft/changes`).expect(200)).body;
    unpublished.should.containEql({ from: null, changes: [], truncated: false });
    unpublished.to.should.containEql({ version: '1', draft: true });
    await alice.post(`${base}/draft/publish`).expect(200);

    // Nor does a first version.
    const first = await alice.get(`${base}/changes`).expect(200);
    first.headers['cache-control'].should.equal('private, no-store');
    should.not.exist(first.body.from);

    await xml(alice.post(`${base}/draft`), form({ version: '2', adult: true, tap: 'Standpipe', extra: true })).expect(200);
    const draft = (await alice.get(`${base}/draft/changes`).expect(200)).body;
    draft.from.version.should.equal('1');
    draft.from.hash.should.match(/^[0-9a-f]{32}$/);
    draft.to.should.containEql({ version: '2', draft: true });
    codes(draft).should.eql([
      ['population', 'constraint-changed', '/data/age'],
      ['meaning', 'choice-relabelled', '/data/water'],
      ['continuity', 'added', '/data/phone']
    ]);
    draft.changes[1].detail.should.eql({ value: 'tap', language: '', from: 'Public tap', to: 'Standpipe' });
    draft.summary.should.eql({ meaning: 1, continuity: 1, population: 1, wording: 0, unchanged: 1 });

    await alice.post(`${base}/draft/publish`).expect(200);
    const current = (await alice.get(`${base}/changes`).expect(200)).body;
    current.from.version.should.equal('1');
    current.to.should.containEql({ version: '2', draft: false });
    codes(current).should.eql(codes(draft));
    (await alice.get(`${base}/versions/2/changes`).expect(200)).body.changes.should.eql(draft.changes);
    should.not.exist((await alice.get(`${base}/versions/1/changes`).expect(200)).body.from);

    // A third version, compared with the one before it or with the first.
    // Removing a question is a warning Central asks to be acknowledged.
    await xml(alice.post(`${base}/draft?ignoreWarnings=true`), form({ version: '3' })).expect(200);
    codes((await alice.get(`${base}/draft/changes`).expect(200)).body).should.eql([
      ['population', 'constraint-changed', '/data/age'],
      ['meaning', 'choice-relabelled', '/data/water'],
      ['continuity', 'removed', '/data/phone']
    ]);
    (await alice.get(`${base}/draft/changes?from=1`).expect(200)).body.changes.should.eql([]);
    await alice.post(`${base}/draft/publish`).expect(200);
    (await alice.get(`${base}/changes`).expect(200)).body.from.version.should.equal('2');
    (await alice.get(`${base}/versions/1/changes?from=3`).expect(200)).body.from.version.should.equal('3');
  }));

  it('names a version with no version string ___, and refuses an unknown or malformed baseline', testService(async (service) => {
    const alice = await service.login('alice');
    await xml(alice.post('/v1/projects/1/forms?publish=true'), form({ version: null })).expect(200);
    await xml(alice.post(`${base}/draft`), form({ version: '2', extra: true })).expect(200);
    const draft = (await alice.get(`${base}/draft/changes`).expect(200)).body;
    draft.from.version.should.equal('');
    (await alice.get(`${base}/draft/changes?from=___`).expect(200)).body.changes.should.eql(draft.changes);
    // Once published, its predecessor is the version with no version string.
    await alice.post(`${base}/draft/publish`).expect(200);
    const current = (await alice.get(`${base}/changes`).expect(200)).body;
    current.from.version.should.equal('');
    current.changes.should.eql(draft.changes);

    await alice.get(`${base}/draft/changes?from=9`).expect(404);
    (await alice.get(`${base}/draft/changes?from=`).expect(400)).body.code.should.equal(400.63);
    (await alice.get(`${base}/draft/changes?from=1&from=2`).expect(400)).body.code.should.equal(400.63);
    await alice.get('/v1/projects/1/forms/nothing/changes').expect(404);
  }));

  it('lets whoever can read the form see its changes, and only managers the draft', testService(async (service) => {
    const alice = await service.login('alice');
    const chelsea = await service.login('chelsea');
    const chelseaId = (await chelsea.get('/v1/users/current').expect(200)).body.id;
    await xml(alice.post('/v1/projects/1/forms?publish=true'), form({})).expect(200);
    await xml(alice.post(`${base}/draft`), form({ version: '2', extra: true })).expect(200);

    await chelsea.get(`${base}/changes`).expect(403);
    await alice.post(`/v1/projects/1/assignments/viewer/${chelseaId}`).expect(200);
    await chelsea.get(`${base}/changes`).expect(200);
    await chelsea.get(`${base}/draft/changes`).expect(403);
  }));

  it('refuses a form too large to compare whole', testService(async (service) => {
    const alice = await service.login('alice');
    const many = Array.from({ length: 5001 }, (_, i) => `<q${i}/>`).join('');
    const binds = Array.from({ length: 5001 }, (_, i) => `<bind nodeset="/data/q${i}" type="string"/>`).join('');
    const big = (version) => `<?xml version="1.0"?><h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml">
      <h:head><h:title>big</h:title><model><instance><data id="big" version="${version}">${many}<meta><instanceID/></meta></data></instance>${binds}
      <bind nodeset="/data/meta/instanceID" type="string" readonly="true()" calculate="concat('uuid:', uuid())"/></model></h:head>
      <h:body></h:body></h:html>`;
    await xml(alice.post('/v1/projects/1/forms?publish=true'), big('1')).expect(200);
    await xml(alice.post('/v1/projects/1/forms/big/draft'), big('2')).expect(200);
    (await alice.get('/v1/projects/1/forms/big/draft/changes').expect(400)).body.code.should.equal(400.57);
  }));
});
