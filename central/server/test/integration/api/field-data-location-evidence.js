// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// G1 location checks through the real routes: docs/field-intelligence/G1-location-evidence.md

require('should');
const { strict: assert } = require('assert');
const { sql } = require('slonik');
const { testService } = require('../setup');
const testData = require('../../data/xml');

/* eslint-disable no-await-in-loop */

const geoForm = `<?xml version="1.0"?>
<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml">
  <h:head>
    <h:title>Geo survey</h:title>
    <model>
      <instance><data id="geo_survey"><meta><instanceID/></meta><name/><location/></data></instance>
      <bind nodeset="/data/meta/instanceID" type="string" readonly="true()" calculate="concat('uuid:', uuid())"/>
      <bind nodeset="/data/name" type="string"/>
      <bind nodeset="/data/location" type="geopoint"/>
    </model>
  </h:head>
  <h:body>
    <input ref="/data/name"><label>Name</label></input>
    <input ref="/data/location"><label>Location</label></input>
  </h:body>
</h:html>`;

const instance = (id, location) => `<data id="geo_survey"><meta><instanceID>${id}</instanceID></meta>`
  + `<name>${id}</name><location>${location}</location></data>`;

// Freetown, as a box, longitude/latitude.
const SHELL = [[-13.30, 8.40], [-13.15, 8.40], [-13.15, 8.52], [-13.30, 8.52], [-13.30, 8.40]];
const areaLayer = (ring = SHELL) => ({
  title: 'Freetown study area',
  data: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} }] }
});

const setUp = async (service, submissions) => {
  const alice = await service.login('alice');
  await alice.post('/v1/projects/1/forms?publish=true').send(geoForm).set('Content-Type', 'application/xml').expect(200);
  for (const [id, location] of submissions)
    await alice.post('/v1/projects/1/forms/geo_survey/submissions').send(instance(id, location))
      .set('Content-Type', 'application/xml').expect(200);
  return alice;
};

const designate = async (alice, layer = areaLayer()) => {
  const { id } = (await alice.post('/v1/projects/1/map-layers').send(layer).expect(200)).body;
  await alice.put(`/v1/projects/1/map-layers/${id}`).set('If-Match', '"layer-1"').send({ role: 'project-area' }).expect(200);
  return id;
};

const flags = async (alice) => (await alice.get('/v1/projects/1/forms/geo_survey/integrity').expect(200)).body;
const byRule = (rows, rule) => rows.filter((f) => f.rule === rule);

describe('api: G1 location evidence', () => {
  it('records accuracy, area and repeat findings with their evidence, and reports what it could not check',
    testService(async (service) => {
      const alice = await setUp(service, [
        ['uuid:inside', '8.42 -13.20 0 5'],
        ['uuid:poor', '8.43 -13.21 0 250'],
        ['uuid:far', '8.46 -13.31 0 5'],
        ['uuid:near', '8.46 -13.3005 0 80'],
        ['uuid:rep-a', '8.465712 -13.231755 0 5'],
        ['uuid:rep-b', '8.465712 -13.231755 0 4'],
        ['uuid:null', '0 0 0 0']
      ]);
      await designate(alice);

      const run = (await alice.post('/v1/projects/1/forms/geo_survey/integrity/run').expect(200)).body;
      run.projectArea.status.should.equal('set');
      run.encrypted.should.equal(false);
      const summary = Object.fromEntries(run.locationRules.map((r) => [r.rule, r]));
      summary['location-accuracy'].should.containEql({ ran: true, concern: 1, noLocation: 1, thresholds: { maxAccuracyM: 100 } });
      summary['outside-project-area'].should.containEql({ ran: true, concern: 1, nearEdge: 1 });
      summary['repeated-location'].should.containEql({ ran: true, concern: 1 });
      // The travel rule still answers as before.
      run.rule.should.equal('implausible-travel');

      const rows = await flags(alice);
      byRule(rows, 'location-accuracy').map((f) => f.instanceId).should.eql(['uuid:poor']);
      const outside = Object.fromEntries(byRule(rows, 'outside-project-area').map((f) => [f.instanceId, f]));
      outside['uuid:far'].outcome.should.equal('concern');
      outside['uuid:near'].outcome.should.equal('inconclusive');
      outside['uuid:far'].evidence.area.layerRevision.should.equal(2);
      const repeat = byRule(rows, 'repeated-location');
      repeat.map((f) => [f.instanceId, f.relatedInstanceId]).should.eql([['uuid:rep-b', 'uuid:rep-a']]);

      const evidence = (await alice.get('/v1/projects/1/forms/geo_survey/evidence').expect(200)).body;
      const components = Object.fromEntries(evidence.submissions.map((s) => [s.instanceId, s.locationComponents]));
      components['uuid:inside'].should.containEql({ present: 'yes', withinProjectArea: 'inside', accuracyBand: '≤10', field: '/location' });
      components['uuid:far'].withinProjectArea.should.equal('outside');
      components['uuid:near'].withinProjectArea.should.equal('near-edge');
      components['uuid:rep-a'].repeatedExactly.should.equal(1);
      components['uuid:null'].should.containEql({ present: 'null-island', withinProjectArea: 'not-checked' });
      evidence.submissions.every((s) => s.geopoint === undefined).should.be.true();
      evidence.coverage.byProjectArea.should.containEql({ inside: 4, outside: 1, 'near-edge': 1, 'not-checked': 1 });
    }));

  it('withdraws a finding the next run no longer observes, keeps the reviewer status and note, and routes the concern to review',
    testService(async (service, { one }) => {
      const alice = await setUp(service, [['uuid:far', '8.46 -13.31 0 5'], ['uuid:inside', '8.42 -13.20 0 5']]);
      const layerId = await designate(alice);
      await alice.post('/v1/projects/1/forms/geo_survey/integrity/run').expect(200);
      const [finding] = byRule(await flags(alice), 'outside-project-area');
      finding.outcome.should.equal('concern');

      // The concern was routed to the submission's review case.
      const codes = await one(sql`select rc."reasonCodes" from field_data_review_cases rc
        join field_data_claim_versions v on v.id = rc."claimVersionId"
        join submission_defs sd on sd.id = v."submissionDefId"
        join submissions s on s.id = sd."submissionId" where s."instanceId" = 'uuid:far'`);
      codes.reasonCodes.should.containEql('location-outside-area');

      await alice.patch(`/v1/projects/1/forms/geo_survey/integrity/${finding.id}`)
        .send({ status: 'investigating', note: 'Asked the collector.' }).expect(200);

      // The boundary is widened to include the point; the next run no longer finds it.
      const wider = [[-13.40, 8.40], [-13.15, 8.40], [-13.15, 8.52], [-13.40, 8.52], [-13.40, 8.40]];
      await alice.put(`/v1/projects/1/map-layers/${layerId}`).set('If-Match', '"layer-2"').send({ data: areaLayer(wider).data }).expect(200);
      const run = (await alice.post('/v1/projects/1/forms/geo_survey/integrity/run').expect(200)).body;
      run.withdrawn.should.equal(1);
      const [after] = byRule(await flags(alice), 'outside-project-area');
      after.should.containEql({ id: finding.id, outcome: 'withdrawn', status: 'investigating', note: 'Asked the collector.' });
      assert.ok(after.evidence.withdrawnAt);

      // The point moves outside again: the same row comes back as a concern.
      await alice.put(`/v1/projects/1/map-layers/${layerId}`).set('If-Match', '"layer-3"').send({ data: areaLayer().data }).expect(200);
      await alice.post('/v1/projects/1/forms/geo_survey/integrity/run').expect(200);
      const [again] = byRule(await flags(alice), 'outside-project-area');
      again.should.containEql({ id: finding.id, outcome: 'concern', status: 'investigating' });
      assert.equal(again.evidence.withdrawnAt, undefined);
    }));

  it('lets a review case be accepted when its only finding has been withdrawn',
    testService(async (service, { one, oneFirst, run }) => {
      const alice = await service.login('alice');
      await alice.post('/v1/projects/1/forms/simple/submissions')
        .send(testData.instances.simple.one).set('Content-Type', 'application/xml').expect(200);
      await alice.patch('/v1/projects/1/forms/simple/submissions/one').send({ reviewState: 'hasIssues' }).expect(200);
      const actorId = await oneFirst(sql`SELECT "actorId" FROM audits WHERE action = 'submission.update' ORDER BY id DESC LIMIT 1`);
      // Recorded before the case is taken: a location concern adds its reason code to the case.
      const finding = await one(sql`INSERT INTO field_data_integrity_flags ("formId", rule, "ruleVersion", "instanceId", outcome, evidence)
        SELECT id, 'outside-project-area', 1, 'one', 'concern', '{}'::jsonb FROM forms WHERE "projectId" = 1 AND "xmlFormId" = 'simple'
        RETURNING id`);
      const item = (await alice.get('/v1/field-data/review-queue?projectId=1&xmlFormId=simple').expect(200)).body.items[0];
      item.reasonCodes.should.containEql('location-outside-area');
      const assigned = await alice.patch(`/v1/field-data/review-queue/${item.id}/assignment`)
        .set('If-Match', item.etag).set('Idempotency-Key', 'take').send({ assignedTo: actorId, status: 'in-review' })
        .expect(200);
      // As in the review tests: model a submission whose capture time was supplied.
      await run(sql`UPDATE field_data_submission_provenance SET "capturedAt" = "receivedAt", degraded = NULL
        WHERE "submissionDefId" = (SELECT "submissionDefId" FROM field_data_claim_versions WHERE id = ${item.claimVersionId})`);
      await run(sql`UPDATE field_data_claim_versions SET degraded = NULL WHERE id = ${item.claimVersionId}`);
      const url = `/v1/field-data/review-queue/${item.id}/decisions`;
      const body = { outcome: 'accepted', override: false, reasonCode: 'legacy-review-state',
        note: 'Reviewed the original.', evidenceIds: [], integrityFindingIds: [] };
      // An open concern blocks acceptance.
      await alice.post(url).set('If-Match', assigned.headers.etag).set('Idempotency-Key', 'blocked').send(body)
        .expect(422);
      // Once a later run withdrew it, it does not, though nobody resolved it.
      await run(sql`UPDATE field_data_integrity_flags SET outcome = 'withdrawn' WHERE id = ${finding.id}`);
      await alice.post(url).set('If-Match', assigned.headers.etag).set('Idempotency-Key', 'accepted').send(body)
        .expect(201);
    }));

  it('runs on a form with no location question without raising anything',
    testService(async (service) => {
      const alice = await service.login('alice');
      await alice.post('/v1/projects/1/forms/simple/submissions')
        .send(testData.instances.simple.one).set('Content-Type', 'application/xml').expect(200);
      await designate(alice);
      const run = (await alice.post('/v1/projects/1/forms/simple/integrity/run').expect(200)).body;
      for (const rule of run.locationRules) (rule.concern ?? 0).should.equal(0);
      run.locationRules.find((r) => r.rule === 'outside-project-area').should.containEql({ ran: true, noLocation: 1 });
      const evidence = (await alice.get('/v1/projects/1/forms/simple/evidence').expect(200)).body;
      evidence.submissions[0].locationComponents.should.containEql({ present: 'no', field: null, withinProjectArea: 'not-checked' });
    }));

  it('does not withdraw area findings when the area is removed, since the rule did not run',
    testService(async (service) => {
      const alice = await setUp(service, [['uuid:far', '8.46 -13.31 0 5']]);
      const layerId = await designate(alice);
      await alice.post('/v1/projects/1/forms/geo_survey/integrity/run').expect(200);
      await alice.delete(`/v1/projects/1/map-layers/${layerId}`).set('If-Match', '"layer-2"').expect(200);
      const run = (await alice.post('/v1/projects/1/forms/geo_survey/integrity/run').expect(200)).body;
      run.projectArea.should.containEql({ status: 'unusable', reason: 'no-area-set' });
      Object.fromEntries(run.locationRules.map((r) => [r.rule, r.ran]))['outside-project-area'].should.equal(false);
      run.withdrawn.should.equal(0);
      byRule(await flags(alice), 'outside-project-area')[0].outcome.should.equal('concern');
    }));

  it('accepts only uploaded polygon layers as the project area, moves the role, and limits who can set it',
    testService(async (service) => {
      const alice = await setUp(service, []);
      const chelsea = await service.login('chelsea');
      const first = await designate(alice);

      const point = (await alice.post('/v1/projects/1/map-layers').send({ title: 'Wells', data: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [-13.2, 8.4] }, properties: {} }] } }).expect(200)).body.id;
      const refused = await alice.put(`/v1/projects/1/map-layers/${point}`).set('If-Match', '"layer-1"').send({ role: 'project-area' }).expect(400);
      refused.body.code.should.equal(400.54);
      refused.body.details.reason.should.equal('no-polygon');

      const bowTie = await alice.post('/v1/projects/1/map-layers').send(areaLayer([[-13.3, 8.4], [-13.2, 8.5], [-13.2, 8.4], [-13.3, 8.5], [-13.3, 8.4]])).expect(200);
      (await alice.put(`/v1/projects/1/map-layers/${bowTie.body.id}`).set('If-Match', '"layer-1"').send({ role: 'project-area' }).expect(400))
        .body.details.reason.should.equal('self-intersecting');

      // A valid second area takes the role from the first.
      const second = (await alice.post('/v1/projects/1/map-layers').send(areaLayer()).expect(200)).body.id;
      await alice.put(`/v1/projects/1/map-layers/${second}`).set('If-Match', '"layer-1"').send({ role: 'project-area' }).expect(200);
      const layers = (await alice.get('/v1/projects/1/map-layers').expect(200)).body;
      layers.filter((l) => l.definition.role === 'project-area').map((l) => l.id).should.eql([second]);
      assert.ok(layers.find((l) => l.id === first).revision > 2, 'losing the role is a change to the layer');

      // A designated area keeps its role through an unrelated edit, and cannot be replaced by unusable geometry.
      await alice.put(`/v1/projects/1/map-layers/${second}`).set('If-Match', '"layer-2"').send({ title: 'Renamed' }).expect(200);
      (await alice.get('/v1/projects/1/map-layers').expect(200)).body.find((l) => l.id === second).definition.role.should.equal('project-area');
      await alice.put(`/v1/projects/1/map-layers/${second}`).set('If-Match', '"layer-3"')
        .send({ data: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [-13.2, 8.4] }, properties: {} }] } }).expect(400);

      await chelsea.put(`/v1/projects/1/map-layers/${second}`).set('If-Match', '"layer-3"').send({ role: null }).expect(403);
      await chelsea.post('/v1/projects/1/forms/geo_survey/integrity/run').expect(403);
      await alice.post('/v1/projects/99/forms/geo_survey/integrity/run').expect(404);
    }));
});
