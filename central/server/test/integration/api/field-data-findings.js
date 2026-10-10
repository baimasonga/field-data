// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// F3 project findings inbox through the real routes: docs/field-intelligence/F3-findings-inbox.md

require('should');
const { sql } = require('slonik');
const { testService } = require('../setup');
const testData = require('../../data/xml');

/* eslint-disable no-await-in-loop */

// Findings as the checks record them, written directly: the inbox only reads.
const insert = async (run, one, xmlFormId, projectId, rows) => {
  const { id: formId } = await one(sql`select id from forms where "xmlFormId" = ${xmlFormId} and "projectId" = ${projectId}`);
  for (const [rule, instanceId, extra = {}] of rows) {
    await run(sql`insert into field_data_integrity_flags
      ("formId", rule, "ruleVersion", "instanceId", "relatedInstanceId", outcome, evidence, status, decision, note, "createdAt")
      values (${formId}, ${rule}, 1, ${instanceId}, ${extra.related ?? null}, ${extra.outcome ?? 'concern'},
        ${JSON.stringify(extra.evidence ?? {})}, ${extra.status ?? 'open'}, ${extra.decision ?? null}, ${extra.note ?? null},
        ${extra.at ?? '2026-10-01T00:00:00Z'})`);
  }
};

const seed = async (service, { run, one }) => {
  const alice = await service.login('alice');
  await insert(run, one, 'simple', 1, [
    ['implausible-travel', 'one', { related: 'two', at: '2026-10-01T01:00:00Z' }],
    ['location-accuracy', 'two', { outcome: 'inconclusive', at: '2026-10-01T02:00:00Z' }],
    ['contradiction:11111111-1111-4111-8111-111111111111', 'three', { evidence: { title: 'No electricity but a fridge', conditions: [{ answer: 'secret answer' }] }, at: '2026-10-01T03:00:00Z' }],
    ['outside-project-area', 'four', { status: 'resolved', decision: 'explained', note: 'Border village', at: '2026-10-01T04:00:00Z' }],
    ['repeated-location', 'five', { outcome: 'withdrawn', at: '2026-10-01T05:00:00Z' }]
  ]);
  await insert(run, one, 'withrepeat', 1, [
    ['identity-reused:22222222-2222-4222-8222-222222222222', 'rone', { related: 'rtwo', evidence: { title: 'Household code', kind: 'reused', others: [{ instanceId: 'rtwo', xmlFormId: 'simple' }] }, status: 'investigating', at: '2026-10-01T06:00:00Z' }]
  ]);
  // Another project's finding must never appear.
  const other = (await alice.post('/v1/projects').send({ name: 'Other' }).expect(200)).body;
  await alice.post(`/v1/projects/${other.id}/forms?publish=true`).send(testData.forms.simple)
    .set('Content-Type', 'application/xml').expect(200);
  await insert(run, one, 'simple', other.id, [['implausible-travel', 'elsewhere']]);
  return { alice, otherProjectId: other.id };
};

describe('api: F3 project findings inbox', () => {
  it('lists open findings across forms by default, labelled by family, without evidence', testService(async (service, container) => {
    const { alice } = await seed(service, container);
    const { body } = await alice.get('/v1/projects/1/findings').expect(200);
    // Concerns first (open before investigating), then inconclusive; newest first within.
    body.items.map((f) => [f.xmlFormId, f.family, f.instanceId, f.status, f.outcome]).should.eql([
      ['simple', 'contradiction', 'three', 'open', 'concern'],
      ['simple', 'travel', 'one', 'open', 'concern'],
      ['withrepeat', 'identity', 'rone', 'investigating', 'concern'],
      ['simple', 'location', 'two', 'open', 'inconclusive']
    ]);
    body.items[0].title.should.equal('No electricity but a fridge');
    // The related submission of a cross-form identity finding is in the other form (F2b).
    body.items[2].should.containEql({ title: 'Household code', kind: 'reused', relatedInstanceId: 'rtwo', relatedXmlFormId: 'simple' });
    body.items[1].should.containEql({ relatedInstanceId: 'two', relatedXmlFormId: 'simple' });
    body.items[3].should.containEql({ relatedInstanceId: null, relatedXmlFormId: null });
    body.items[0].should.not.have.property('evidence');
    JSON.stringify(body).should.not.match(/secret answer|elsewhere/);
    (body.nextCursor == null).should.be.true();
  }));

  it('filters by status, outcome, family and form, and refuses bad filters', testService(async (service, container) => {
    const { alice } = await seed(service, container);
    const get = async (q) => (await alice.get(`/v1/projects/1/findings?${q}`).expect(200)).body.items.map((f) => f.instanceId);
    (await get('status=resolved')).should.eql(['four']);
    (await get('status=resolved&outcome=inconclusive')).should.eql([]);
    (await get('status=open&status=investigating&status=resolved&outcome=withdrawn')).should.eql(['five']);
    (await get('family=location&status=open&status=resolved&outcome=concern&outcome=inconclusive')).should.eql(['four', 'two']);
    (await get('xmlFormId=withrepeat')).should.eql(['rone']);
    const resolved = (await alice.get('/v1/projects/1/findings?status=resolved&outcome=concern').expect(200)).body.items[0];
    resolved.should.containEql({ decision: 'explained', note: 'Border village' });
    for (const bad of ['status=done', 'outcome=maybe', 'family=fraud', 'cursor=notacursor'])
      (await alice.get(`/v1/projects/1/findings?${bad}`).expect(400)).body.code.should.equal(400.8);
  }));

  it('pages with a stable cursor while new findings arrive', testService(async (service, container) => {
    const alice = await service.login('alice');
    await insert(container.run, container.one, 'simple', 1, Array.from({ length: 120 }, (_, i) =>
      ['implausible-travel', `i${String(i).padStart(3, '0')}`, { at: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString() }]));
    const first = (await alice.get('/v1/projects/1/findings').expect(200)).body;
    first.items.length.should.equal(50);
    first.items[0].instanceId.should.equal('i119');
    // A finding recorded between pages does not shift the next page.
    await insert(container.run, container.one, 'simple', 1, [['implausible-travel', 'late', { at: '2026-10-09T00:00:00Z' }]]);
    const second = (await alice.get(`/v1/projects/1/findings?cursor=${first.nextCursor}`).expect(200)).body;
    second.items[0].instanceId.should.equal('i069');
    const third = (await alice.get(`/v1/projects/1/findings?cursor=${second.nextCursor}`).expect(200)).body;
    third.items.length.should.equal(20);
    (third.nextCursor == null).should.be.true();
    new Set([...first.items, ...second.items, ...third.items].map((f) => f.instanceId)).size.should.equal(120);
  }));

  it('counts open findings by family and form, and limits who can see any of it', testService(async (service, container) => {
    const { alice, otherProjectId } = await seed(service, container);
    const summary = (await alice.get('/v1/projects/1/findings/summary').expect(200)).body;
    summary.should.eql({
      open: 4,
      byFamily: { travel: 1, location: 1, contradiction: 1, identity: 1, similarity: 0 },
      byForm: [{ xmlFormId: 'simple', formName: 'Simple', open: 3 }, { xmlFormId: 'withrepeat', formName: 'withrepeat', open: 1 }]
    });
    (await alice.get(`/v1/projects/${otherProjectId}/findings`).expect(200)).body.items.map((f) => f.instanceId).should.eql(['elsewhere']);

    const chelsea = await service.login('chelsea');
    const chelseaId = (await chelsea.get('/v1/users/current').expect(200)).body.id;
    await chelsea.get('/v1/projects/1/findings').expect(403);
    // A Data Collector can see the project but not its submissions: no findings at all.
    await alice.post(`/v1/projects/1/assignments/formfill/${chelseaId}`).expect(200);
    (await chelsea.get('/v1/projects/1/findings').expect(200)).body.items.should.eql([]);
    (await chelsea.get('/v1/projects/1/findings/summary').expect(200)).body.should.containEql({ open: 0, byForm: [] });
    await alice.delete(`/v1/projects/1/assignments/formfill/${chelseaId}`).expect(200);
    await alice.post(`/v1/projects/1/assignments/viewer/${chelseaId}`).expect(200);
    (await chelsea.get('/v1/projects/1/findings').expect(200)).body.items.length.should.equal(4);
    await chelsea.get(`/v1/projects/${otherProjectId}/findings`).expect(403);
    const appUser = (await alice.post('/v1/projects/1/app-users').send({ displayName: 'Collector' }).expect(200)).body;
    await service.get('/v1/projects/1/findings').set('Authorization', `Bearer ${appUser.token}`).expect(403);
    await service.get('/v1/projects/1/findings').expect(401);
    await alice.get('/v1/projects/999/findings').expect(404);
    await alice.get('/v1/projects/0/findings').expect(404);
  }));
});
