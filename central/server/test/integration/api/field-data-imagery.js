// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// G1b imagery availability through the real routes, with the catalogue
// replaced by a recorded answer: docs/field-intelligence/G1b-imagery-availability.md

require('should');
const { sql } = require('slonik');
const { testService } = require('../setup');
const freetown = require('../../data/imagery/earth-search-freetown.json');

/* eslint-disable no-await-in-loop */

const geoForm = `<?xml version="1.0"?>
<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml">
  <h:head><h:title>Geo survey</h:title><model>
    <instance><data id="geo_survey"><meta><instanceID/></meta><location/></data></instance>
    <bind nodeset="/data/meta/instanceID" type="string" readonly="true()" calculate="concat('uuid:', uuid())"/>
    <bind nodeset="/data/location" type="geopoint"/>
  </model></h:head>
  <h:body><input ref="/data/location"><label>Location</label></input></h:body>
</h:html>`;
const instance = (id, location) => `<data id="geo_survey"><meta><instanceID>${id}</instanceID></meta><location>${location}</location></data>`;
const base = '/v1/projects/1/forms/geo_survey';

// Every catalogue request is recorded and answered by `answer`.
const catalogue = (answer) => {
  const requests = [];
  const original = global.fetch;
  global.fetch = async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) });
    return answer(url, init);
  };
  return { requests, restore: () => { global.fetch = original; } };
};
const ok = (json) => ({ ok: true, status: 200, json: async () => json });

const setUp = async (service, run, submissions) => {
  const alice = await service.login('alice');
  await alice.post('/v1/projects/1/forms?publish=true').send(geoForm).set('Content-Type', 'application/xml').expect(200);
  for (const [id, location, receivedAt] of submissions) {
    await alice.post(`${base}/submissions`).send(instance(id, location)).set('Content-Type', 'application/xml').expect(200);
    if (receivedAt) await run(sql`update submissions set "createdAt" = ${receivedAt} where "instanceId" = ${id}`);
  }
  return alice;
};

describe('api: G1b imagery availability', () => {
  const env = { ...process.env };
  afterEach(() => { process.env.FIELD_DATA_IMAGERY_ENABLED = env.FIELD_DATA_IMAGERY_ENABLED; process.env.FIELD_DATA_STAC_URL = env.FIELD_DATA_STAC_URL; });

  it('is off until an operator turns it on, and then sends only a cell centre and whole days', testService(async (service, { run, all }) => {
    const alice = await setUp(service, run, [
      ['uuid:a', '8.4801 -13.2344 10 5', '2026-09-20T10:30:00Z'],
      // Same cell and day as a: one request between them.
      ['uuid:b', '8.4602 -13.2121 10 5', '2026-09-20T15:00:00Z'],
      ['uuid:none', '', '2026-09-20T10:00:00Z']
    ]);
    delete process.env.FIELD_DATA_IMAGERY_ENABLED;
    (await alice.post(`${base}/imagery/check`).expect(501)).body.code.should.equal(501.12);
    (await alice.get(`${base}/imagery`).expect(200)).body.should.containEql({ enabled: false });

    process.env.FIELD_DATA_IMAGERY_ENABLED = 'true';
    process.env.FIELD_DATA_STAC_URL = 'https://catalogue.test/v1';
    const stac = catalogue(async () => ok(freetown));
    try {
      const result = (await alice.post(`${base}/imagery/check`).expect(200)).body;
      result.should.containEql({ submissions: 3, located: 2, lookups: 1, looked: 1, cached: 0, unavailable: [] });
      stac.requests.length.should.equal(1);
      stac.requests[0].url.should.equal('https://catalogue.test/v1/search');
      // Exactly this, and nothing else, is sent.
      stac.requests[0].body.should.eql({
        collections: ['sentinel-2-l2a'], intersects: { type: 'Point', coordinates: [-13.225, 8.475] },
        datetime: '2026-08-21T00:00:00Z/2026-10-20T23:59:59Z', limit: 100,
        fields: { include: ['id', 'properties.datetime', 'properties.eo:cloud_cover', 'collection'], exclude: ['assets', 'links', 'geometry', 'bbox'] }
      });
      stac.requests[0].body.datetime.should.equal('2026-08-21T00:00:00Z/2026-10-20T23:59:59Z');
      JSON.stringify(stac.requests).should.not.match(/8\.48|8\.46|13\.23|13\.21|10:30|15:00|uuid/);

      // Checked again: answered from the cache.
      (await alice.post(`${base}/imagery/check`).expect(200)).body.should.containEql({ looked: 0, cached: 1 });
      stac.requests.length.should.equal(1);
    } finally { stac.restore(); }

    const view = (await alice.get(`${base}/imagery`).expect(200)).body;
    view.should.containEql({ enabled: true, windowDays: 30, clearBelow: 30, cellDegrees: 0.05 });
    view.coverage.should.eql({ total: 3, noLocation: 1, notChecked: 0, checked: 2, withScene: 2, withClearScene: 0 });
    const a = view.submissions.find((x) => x.instanceId === 'uuid:a');
    a.should.containEql({ status: 'checked', visitTime: 'receipt', scenes: 15, clear: 0 });
    a.nearest.should.containEql({ date: '2026-09-22', daysFromVisit: 2 });
    a.clearest.should.containEql({ date: '2026-10-04', cloud: 41.7 });
    view.submissions.find((x) => x.instanceId === 'uuid:none').status.should.equal('no-location');
    // The cache holds no submission data.
    const cached = await all(sql`select * from field_data_imagery_lookups`);
    cached.length.should.equal(1);
    cached[0].should.containEql({ cellKey: '8.475,-13.225', windowDays: 30, catalogue: 'https://catalogue.test/v1' });
  }));

  it('records a failing catalogue as unavailable without caching it, and retries next time', testService(async (service, { run, all }) => {
    const alice = await setUp(service, run, [['uuid:a', '8.4801 -13.2344 10 5', '2026-09-20T10:30:00Z']]);
    process.env.FIELD_DATA_IMAGERY_ENABLED = 'true';
    process.env.FIELD_DATA_STAC_URL = 'https://catalogue.test/v1';
    let calls = 0;
    const stac = catalogue(async () => { calls += 1; return calls === 1 ? { ok: false, status: 503 } : ok(freetown); });
    try {
      const failed = (await alice.post(`${base}/imagery/check`).expect(200)).body;
      failed.unavailable.should.eql([{ cell: '8.475,-13.225', day: '2026-09-20', reason: 'catalogue answered 503' }]);
      (await all(sql`select * from field_data_imagery_lookups`)).length.should.equal(0);
      (await alice.get(`${base}/imagery`).expect(200)).body.submissions[0].status.should.equal('not-checked');
      (await alice.post(`${base}/imagery/check`).expect(200)).body.should.containEql({ looked: 1, unavailable: [] });
    } finally { stac.restore(); }
  }));

  it('refreshes a stale answer, and limits who can check and read', testService(async (service, { run }) => {
    const alice = await setUp(service, run, [['uuid:a', '8.4801 -13.2344 10 5', '2026-09-20T10:30:00Z']]);
    process.env.FIELD_DATA_IMAGERY_ENABLED = 'true';
    process.env.FIELD_DATA_STAC_URL = 'https://catalogue.test/v1';
    const stac = catalogue(async () => ok(freetown));
    try {
      await alice.post(`${base}/imagery/check`).expect(200);
      await run(sql`update field_data_imagery_lookups set "fetchedAt" = now() - interval '8 days'`);
      (await alice.post(`${base}/imagery/check`).expect(200)).body.should.containEql({ looked: 1, cached: 0 });
      stac.requests.length.should.equal(2);

      const chelsea = await service.login('chelsea');
      const chelseaId = (await chelsea.get('/v1/users/current').expect(200)).body.id;
      await chelsea.get(`${base}/imagery`).expect(403);
      await alice.post(`/v1/projects/1/assignments/viewer/${chelseaId}`).expect(200);
      await chelsea.get(`${base}/imagery`).expect(200);
      await chelsea.post(`${base}/imagery/check`).expect(403);
      const appUser = (await alice.post('/v1/projects/1/app-users').send({ displayName: 'Collector' }).expect(200)).body;
      await service.get(`${base}/imagery`).set('Authorization', `Bearer ${appUser.token}`).expect(403);
      await alice.get('/v1/projects/1/forms/nope/imagery').expect(404);
      stac.requests.length.should.equal(2);
    } finally { stac.restore(); }
  }));
});
