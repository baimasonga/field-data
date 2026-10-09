// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

const { strict: assert } = require('assert');
const { sql } = require('slonik');
const { testService } = require('../setup');
const testData = require('../../data/xml');

describe('api: evidence graph and survey replay', () => {
  it('projects sources, contradictions, supersession and decisions without asserting presence',
    testService(async (service, { run, one }) => {
      const alice = await service.login('alice');
      const chelsea = await service.login('chelsea');
      await alice.post('/v1/projects/1/forms/simple/submissions')
        .send(testData.instances.simple.one).set('Content-Type', 'application/xml').expect(200);
      const claim = (await alice.get('/v1/projects/1/forms/simple/submissions/one/claim').expect(200)).body;
      const versionId = claim.currentVersionId;
      const path = `/v1/field-data/claim-versions/${versionId}/graph`;
      const response = await alice.get(path).expect(200);
      assert.equal(response.headers['cache-control'], 'private, no-store');
      const graph = response.body;
      assert.equal(graph.presence.status, 'insufficient_evidence');
      assert.equal(graph.complete, true);
      assert.equal(graph.nodes.find(node => node.type === 'evidence').integrityStatus, 'verified');
      assert.equal(graph.timeline.find(event => event.kind === 'reported-capture').at, null);
      assert.equal(graph.timeline.at(-1).kind, 'reported-capture');
      const repeated = (await alice.get(path).expect(200)).body;
      assert.deepEqual(repeated.nodes, graph.nodes);
      assert.deepEqual(repeated.edges, graph.edges);
      assert.deepEqual(repeated.timeline, graph.timeline);
      await chelsea.get(path).expect(404);
      await service.get(path).expect(401);
      const inspections = await one(sql`SELECT count(*)::integer AS count FROM audits
        WHERE action = 'field_data.evidence.graph.read'`);
      assert.equal(inspections.count, 2);
      const evidence = graph.nodes.find(node => node.type === 'evidence');
      const link = graph.nodes.find(node => node.type === 'link');
      await alice.post(`/v1/field-data/claim-versions/${versionId}/evidence-links`)
        .set('Idempotency-Key', 'graph-contradiction')
        .send({ evidenceId: evidence.sourceId, relation: 'contradicts', supersedesLinkId: link.sourceId })
        .expect(201);
      const item = (await alice.get('/v1/field-data/review-queue?projectId=1&xmlFormId=simple')
        .expect(200)).body.items[0];
      const actorId = (await alice.get('/v1/users/current').expect(200)).body.id;
      const assignment = await alice.patch(`/v1/field-data/review-queue/${item.id}/assignment`)
        .set('If-Match', item.etag).set('Idempotency-Key', 'graph-review-assignment')
        .send({ assignedTo: actorId, status: 'in-review' })
        .expect(200);
      await alice.post(`/v1/field-data/review-queue/${item.id}/decisions`)
        .set('If-Match', assignment.headers.etag).set('Idempotency-Key', 'graph-review-decision')
        .send({ outcome: 'needs-evidence', override: false, reasonCode: item.reasonCodes[0],
          note: '<img src=x onerror=alert(1)> investigate contradiction', evidenceIds: [], integrityFindingIds: [] })
        .expect(201);
      const reviewed = (await alice.get(path).expect(200)).body;
      assert(reviewed.edges.some(edge => edge.relation === 'contradicts'));
      assert(reviewed.edges.some(edge => edge.relation === 'supersedes'));
      const decision = reviewed.nodes.find(node => node.type === 'decision');
      assert.equal(decision.outcome, 'needs-evidence');
      assert.match(decision.evidenceSnapshotHash, /^sha256:/);
      const ids = new Set(reviewed.nodes.map(node => node.id));
      for (const edge of reviewed.edges) assert(ids.has(edge.from) && ids.has(edge.to));
      assert(reviewed.timeline.some(event => event.kind === 'review-decision'));
      await run(sql`UPDATE submission_defs SET xml = xml || ' '
        WHERE id = (SELECT "submissionDefId" FROM field_data_claim_versions WHERE id = ${versionId})`);
      const tampered = (await alice.get(path).expect(200)).body;
      assert.equal(tampered.nodes.find(node => node.type === 'evidence').integrityStatus, 'mismatch');
      assert.equal(tampered.nodes.find(node => node.type === 'decision').evidenceSnapshotHash,
        decision.evidenceSnapshotHash);
      await run(sql`UPDATE submissions SET "deletedAt" = now() WHERE "instanceId" = 'one'`);
      await alice.get(path).expect(404);
    }));

  it('bounds derivation history, excludes raw outputs and leaves oversized bytes unverified',
    testService(async (service, { run }) => {
      const alice = await service.login('alice');
      await alice.post('/v1/projects/1/forms?publish=true').set('Content-Type', 'application/xml')
        .send(testData.forms.binaryType).expect(200);
      await alice.post('/v1/projects/1/forms/binaryType/submissions').set('Content-Type', 'application/xml')
        .send(testData.instances.binaryType.both).expect(200);
      const claim = (await alice.get('/v1/projects/1/forms/binaryType/submissions/both/claim').expect(200)).body;
      const path = `/v1/field-data/claim-versions/${claim.currentVersionId}/graph`;
      const initial = (await alice.get(path).expect(200)).body;
      assert.equal(initial.nodes.filter(node => node.integrityStatus === 'missing').length, 2);
      const source = initial.nodes.find(node => node.sourceKind === 'submission-xml');
      await run(sql`INSERT INTO field_data_evidence_derivations
        ("evidenceId", kind, algorithm, "algorithmVersion", "outputJson", "contentHash")
        SELECT ${source.sourceId}, 'image-metadata', 'graph-test-' || n, '1', '{"private":"never-return"}'::jsonb,
          'sha256:' || repeat('a', 64) FROM generate_series(1, 501) n`);
      await run(sql`UPDATE submission_defs SET xml = repeat('x', 2097153)
        WHERE id = (SELECT "submissionDefId" FROM field_data_claim_versions WHERE id = ${claim.currentVersionId})`);
      const bounded = (await alice.get(path).expect(200)).body;
      assert.equal(bounded.nodes.filter(node => node.type === 'derivation').length, 500);
      assert.equal(bounded.completeness.derivations, false);
      assert.equal(bounded.complete, false);
      assert.equal(bounded.nodes.find(node => node.sourceKind === 'submission-xml').integrityStatus, 'unverified');
      assert(!JSON.stringify(bounded).includes('never-return'));
    }));
});
