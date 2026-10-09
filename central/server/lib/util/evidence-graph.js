// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

const projectGraph = (claim, rows) => {
  const nodes = [];
  const edges = [];
  const timeline = [];
  const node = (type, id, details) => {
    const key = `${type}:${id}`;
    nodes.push({ id: key, type, sourceId: id, ...details });
    return key;
  };
  const event = (id, nodeId, kind, at, timeBasis) => {
    timeline.push({ id, nodeId, kind, at: at ?? null, timeBasis });
  };
  const claimId = node('claim-version', claim.id, {
    ordinal: claim.ordinal, current: claim.current,
    sourceUrl: `/v1/field-data/claim-versions/${claim.id}`
  });
  event(`capture:${claim.id}`, claimId, 'reported-capture', claim.provenance?.capturedAt, 'reported');
  event(`receipt:${claim.id}`, claimId, 'server-receipt', claim.provenance?.receivedAt, 'server');
  for (const original of rows.originals) {
    const integrityStatus = original.missing ? 'missing'
      : original.hashMatches === true ? 'verified'
        : original.hashMatches === false ? 'mismatch' : 'unverified';
    const id = node('evidence', original.id, {
      sourceKind: original.sourceKind, name: original.name,
      contentHash: original.contentHash, integrityStatus,
      degraded: original.degraded, sourceUrl: `/v1/field-data/evidence/${original.id}`
    });
    event(`evidence-receipt:${original.id}`, id, 'evidence-receipt', original.receivedAt, 'server');
    if (original.verifiedAt != null) {
      const verificationId = node('verification', original.id, {
        basis: original.verificationBasis,
        outcome: original.legacySha1Matched ? 'matched-at-verification' : 'mismatch-at-verification'
      });
      edges.push({ id: `verification:${original.id}`, from: verificationId, to: id, relation: 'assesses' });
      event(`verification:${original.id}`, verificationId, 'stored-byte-verification', original.verifiedAt, 'server');
    }
  }
  const nodeIds = new Set(nodes.map(item => item.id));
  const linkIds = new Set(rows.links.map(item => `link:${item.id}`));
  let lineageComplete = true;
  for (const link of rows.links) {
    const evidenceId = `evidence:${link.evidenceId}`;
    if (!nodeIds.has(evidenceId)) { lineageComplete = false; continue; }
    const id = node('link', link.id, { relation: link.relation });
    edges.push({ id: `${id}:claim`, from: id, to: claimId, relation: 'links-claim' },
      { id: `${id}:evidence`, from: id, to: evidenceId, relation: link.relation });
    event(`link:${link.id}`, id, 'evidence-linked', link.createdAt, 'server');
    if (link.supersedesLinkId != null) {
      const previous = `link:${link.supersedesLinkId}`;
      if (linkIds.has(previous) && rows.links.some(item => item.id === link.supersedesLinkId
        && nodeIds.has(`evidence:${item.evidenceId}`)))
        edges.push({ id: `${id}:supersedes`, from: id, to: previous, relation: 'supersedes' });
      else lineageComplete = false;
    }
  }
  for (const derived of rows.derived) {
    const id = node('derivation', derived.id, {
      kind: derived.kind, algorithm: derived.algorithm, algorithmVersion: derived.algorithmVersion,
      sourceUrl: `/v1/field-data/evidence/${derived.evidenceId}/derivations/${derived.id}/content`
    });
    edges.push({ id: `${id}:source`, from: id, to: `evidence:${derived.evidenceId}`, relation: 'derived-from' });
    event(`derived:${derived.id}`, id, 'derivation-created', derived.createdAt, 'server');
  }
  const decisionIds = new Set(rows.decisions.map(item => `decision:${item.id}`));
  for (const decision of rows.decisions) {
    const { id: sourceId, previousDecisionId, ...details } = decision;
    const id = node('decision', sourceId, { ...details,
      sourceUrl: `/v1/field-data/review-queue/${decision.caseId}` });
    edges.push({ id: `${id}:claim`, from: id, to: claimId, relation: 'reviews' });
    event(`decision:${sourceId}`, id, 'review-decision', decision.createdAt, 'server');
    if (previousDecisionId != null) {
      const previous = `decision:${previousDecisionId}`;
      if (decisionIds.has(previous))
        edges.push({ id: `${id}:previous`, from: id, to: previous, relation: 'follows' });
      else lineageComplete = false;
    }
  }
  timeline.sort((a, b) => (a.at == null && b.at == null ? 0 : a.at == null ? 1 : b.at == null ? -1
    : new Date(a.at) - new Date(b.at)) || a.id.localeCompare(b.id));
  const completeness = { ...rows.completeness, lineage: lineageComplete };
  return { schemaVersion: 'evidence-graph@1', generatedAt: rows.generatedAt,
    scope: 'single-claim-version', claimVersionId: claim.id, nodes, edges, timeline,
    completeness, complete: Object.values(completeness).every(value => value === true),
    presence: { status: 'insufficient_evidence',
      limitations: 'Stored-byte integrity does not establish physical presence. Sensor, challenge and witness corroboration are not assessed.' },
    limitations: [
      'Capture times are reported; clock accuracy is unknown. Timestamp order does not establish causality.',
      'Missing timestamps remain unknown. Each metadata category is limited to 500 records.',
      'Bytes over 2 MiB, beyond the 8 MiB inspection budget, or unavailable locally are unverified; dated remote verification is a historical observation.',
      'Review snapshot hashes describe historical decisions. Current integrity is assessed separately.',
      'Backcheck responses, asset history and other claim versions are outside this projection.'
    ] };
};

module.exports = { projectGraph };
