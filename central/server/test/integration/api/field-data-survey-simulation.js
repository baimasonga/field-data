// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// S2 interview simulation through the real routes:
// docs/field-intelligence/S2-survey-simulation.md

require('should');
const { readFileSync } = require('fs');
const { join } = require('path');
const { testService } = require('../setup');
const { LIMITS } = require('../../../lib/util/survey-simulator');

/* eslint-disable no-await-in-loop */

const fixture = (name) => readFileSync(join(__dirname, '../../data/survey-doctor', name), 'utf8');
const planted = fixture('planted.xml');
const corrected = fixture('corrected.xml').replace('id="doctor_good" version="1"', 'id="doctor_bad" version="2"');
const base = '/v1/projects/1/forms/doctor_bad';

describe('api: S2 interview simulation', () => {
  it('simulates the published version, an earlier version and the draft, reproducibly', testService(async (service) => {
    const alice = await service.login('alice');
    await alice.post('/v1/projects/1/forms?publish=true').send(planted).set('Content-Type', 'application/xml').expect(200);

    const published = await alice.get(`${base}/simulation?runs=50&seed=abc`).expect(200);
    published.headers['cache-control'].should.equal('private, no-store');
    published.body.should.containEql({ simulatorVersion: 1, seed: 'abc', runs: 50, formVersion: '1', draft: false });
    published.body.neverShown.length.should.be.above(0);
    published.body.reportHash.should.match(/^[0-9a-f]{64}$/);
    // The same seed gives the same report; no seed, a fresh one.
    (await alice.get(`${base}/simulation?runs=50&seed=abc`).expect(200)).body.reportHash.should.equal(published.body.reportHash);
    const fresh = (await alice.get(`${base}/simulation`).expect(200)).body;
    fresh.runs.should.equal(200);
    fresh.seed.should.not.equal('abc');

    await alice.post(`${base}/draft`).send(corrected).set('Content-Type', 'application/xml').expect(200);
    const draft = (await alice.get(`${base}/draft/simulation?runs=50&seed=abc`).expect(200)).body;
    draft.should.containEql({ formVersion: '2', draft: true });
    draft.neverShown.should.eql([]);
    await alice.post(`${base}/draft/publish`).expect(200);
    (await alice.get(`${base}/versions/1/simulation?runs=50&seed=abc`).expect(200)).body.reportHash
      .should.equal(published.body.reportHash);
    await alice.get(`${base}/draft/simulation`).expect(404);
  }));

  it('refuses invalid settings, keeps to the budget, and checks permissions as the form check does', testService(async (service) => {
    const alice = await service.login('alice');
    const chelsea = await service.login('chelsea');
    const chelseaId = (await chelsea.get('/v1/users/current').expect(200)).body.id;
    await alice.post('/v1/projects/1/forms?publish=true').send(planted).set('Content-Type', 'application/xml').expect(200);
    await alice.post(`${base}/draft`).send(corrected).set('Content-Type', 'application/xml').expect(200);

    for (const q of ['runs=0', 'runs=1001', 'runs=2.5', 'runs=x', 'seed=', 'seed=a%20b', `seed=${'a'.repeat(65)}`])
      (await alice.get(`${base}/simulation?${q}`).expect(400)).body.code.should.equal(400.61);
    const { visits } = LIMITS;
    LIMITS.visits = 100;
    try {
      (await alice.get(`${base}/simulation?runs=1000`).expect(200)).body.should.containEql({ runsAsked: 1000, reducedForBudget: true });
    } finally { LIMITS.visits = visits; }

    await chelsea.get(`${base}/simulation`).expect(403);
    await alice.post(`/v1/projects/1/assignments/viewer/${chelseaId}`).expect(200);
    await chelsea.get(`${base}/simulation?runs=5`).expect(200);
    await chelsea.get(`${base}/draft/simulation`).expect(403);
    await alice.get('/v1/projects/1/forms/nope/simulation').expect(404);
  }));
});
