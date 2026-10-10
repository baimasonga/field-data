import { expect, test } from '@playwright/test';

const appUrl = process.env.ODK_URL || 'http://127.0.0.1:8989';
const caseId = '11111111-1111-4111-8111-111111111111';
const versionId = '22222222-2222-4222-8222-222222222222';
const backcheckId = '33333333-3333-4333-8333-333333333333';
const etag = revision => `"review-case-${revision}"`;

const setup = async (page, { comparisonUnavailable = false, failComparison = false, staleAssignment = false, canOverride = false, readOnly = false, noProjects = false, failQueue = false, failAssignment = false, manageQuality = false, delayOpen = false, failMetrics = false, delayMetrics = false } = {}) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let releaseOpen;
  const openWait = delayOpen ? new Promise(resolve => { releaseOpen = resolve; }) : null;
  let releaseMetrics;
  const metricsWait = delayMetrics ? new Promise(resolve => { releaseMetrics = resolve; }) : null;
  const state = { assets: [], assetHistory: [], assetTasks: [], assetWrites: [], assetFailures: 0, assetConflict: false, mappingRevision: 0, mappingHistory: [], mappingRequests: [], mappingFailures: 0, mappingConflict: false, comparisonFailures: failComparison ? 1 : 0, comparisonRequests: 0, staleWrites: 0, conflictFailures: staleAssignment ? 1 : 0, status: 'open', assignedTo: null, revision: 1, backchecks: [], decisions: [], mutations: [], queueRequests: [], queueFailures: failQueue ? 1 : 0, assignmentFailures: failAssignment ? 1 : 0, metricsFailures: failMetrics ? 2 : 0 };
  Object.assign(state, { queueCalls: [], queueFailures_: 0, queueGate: null, queuePaged: false, queueTasks: [] });
  Object.assign(state, { findings: [], findingsCalls: [], findingsFailures: 0, findingsPaged: false, collectorGroups: [], collectorCalls: [], workload: false, search: null, searchCalls: [], searchFailures: 0, projection: null, projectionCalls: [], projectionFailures: 0 });
  await page.addInitScript(() => globalThis.localStorage.setItem('sessionExpires', String(Date.now() + 3600000)));
  await page.route('**/client-config.json', route => route.fulfill({ json: {} }));
  await page.route('**/version.txt', route => route.fulfill({ body: 'test' }));
  await page.route('**/v1/**', async route => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const respond = (json, revision) => route.fulfill({ json, headers: revision ? { etag: etag(revision) } : {} });
    if (path === '/v1/sessions/restore') return respond({ expiresAt: '2099-01-01T00:00:00Z', csrf: 'test' });
    if (path === '/v1/users/current') return respond({ id: 1, displayName: 'Test reviewer', email: 'reviewer@example.test', verbs: manageQuality ? ['project.create'] : [], preferences: { site: {}, projects: {} } });
    if (path === '/v1/projects') return respond(noProjects ? [] : [
      { id: 7, name: 'Health project', verbs: readOnly ? ['submission.read'] : ['submission.read', 'submission.update'], formList: [{ xmlFormId: 'health', name: 'Health survey' }, { xmlFormId: 'nutrition', name: 'Nutrition survey' }] },
      { id: 8, name: 'Water project', verbs: ['submission.read'], formList: [{ xmlFormId: 'water', name: 'Water survey' }] }
    ]);
    if (path === '/v1/field-data/review') {
      if (!manageQuality) throw new Error('Legacy review API must not be used');
      state.qualityLoaded = true;
      return respond({ items: [], counts: { pending: 0, flagged: 0 }, rules: [], qualitySummary: [] });
    }
    if (path === '/v1/field-data/review-queue/metrics') {
      if (state.metricsFailures-- > 0) return route.fulfill({ status: 503, json: { message: 'Unavailable' } });
      const selected = url.searchParams.get('projectId') === '7' && url.searchParams.get('xmlFormId') === 'health';
      if (delayMetrics && selected) await metricsWait;
      return respond({ counts: { open: selected && state.status === 'open' ? 1 : 0,
        inReview: selected && state.status === 'in-review' ? 1 : 0,
        resolved: selected && state.status === 'resolved' ? 1 : 0, superseded: 0 },
      staleWrites: { total: selected ? state.staleWrites : 0,
        byOperation: selected && state.staleWrites > 0 ? [{ operation: 'assignment', count: state.staleWrites }] : [] },
      oldestActiveSeconds: selected ? 7200 : null, averageFirstAssignmentSeconds: null,
      averageResolutionSeconds: null, assignedCaseCount: 0,
      backchecks: { pending: state.backchecks.filter(b => b.status === 'requested').length, overdue: 0 },
      activeReasons: selected ? [{ reasonCode: 'provenance-degraded', count: 1 }] : [] });
    }
    if (path === '/v1/projects/7/app-users') return respond([{ id: 42, displayName: 'Collector' }]);
    // K2 cited search.
    if (/^\/v1\/projects\/\d+\/search$/.test(path)) {
      state.searchCalls.push(url.searchParams.get('q'));
      if (state.searchFailures-- > 0) return route.fulfill({ status: 500, json: { message: 'Failed' } });
      const empty = { assets: [], facts: [], findings: [], decisions: [] };
      return respond({ q: url.searchParams.get('q'), results: state.search ?? empty, more: { assets: 0, facts: 0, findings: 0, decisions: 0, ...state.searchMore } });
    }
    // F5 collector groups: those whose strongest connection meets the minimum.
    if (/^\/v1\/projects\/\d+\/findings\/collectors$/.test(path)) {
      const minLinks = Number(url.searchParams.get('minLinks') ?? 3);
      state.collectorCalls.push(minLinks);
      const groups = path.startsWith('/v1/projects/7/') ? state.collectorGroups.filter((g) => g.connections.some((c) => c.links >= minLinks)) : [];
      return respond({ minLinks, links: state.collectorGroups.reduce((n, g) => n + g.findingsTotal, 0), groups });
    }
    // F3 findings inbox: filtered by the query, as the server does.
    if (/^\/v1\/projects\/\d+\/findings(\/summary)?$/.test(path)) {
      state.findingsCalls.push(Object.fromEntries([...url.searchParams.keys()].map((k) => [k, url.searchParams.getAll(k)])));
      if (state.findingsFailures > 0) { state.findingsFailures -= 1; return route.fulfill({ status: 503, json: { message: 'Unavailable' } }); }
      const rows = path.startsWith('/v1/projects/7/') ? state.findings : [];
      const open = rows.filter((f) => f.status !== 'resolved' && f.outcome !== 'withdrawn');
      if (path.endsWith('/summary')) {
        const byFamily = { travel: 0, location: 0, contradiction: 0, identity: 0, similarity: 0 };
        const byForm = new Map();
        for (const f of open) {
          byFamily[f.family] += 1;
          byForm.set(f.xmlFormId, { xmlFormId: f.xmlFormId, formName: f.formName, open: (byForm.get(f.xmlFormId)?.open ?? 0) + 1 });
        }
        return respond({ open: open.length, byFamily, byForm: [...byForm.values()] });
      }
      const statuses = url.searchParams.getAll('status'); const outcomes = url.searchParams.getAll('outcome');
      const wanted = rows.filter((f) => statuses.includes(f.status) && outcomes.includes(f.outcome)
        && (!url.searchParams.get('family') || f.family === url.searchParams.get('family'))
        && (!url.searchParams.get('xmlFormId') || f.xmlFormId === url.searchParams.get('xmlFormId')));
      const second = url.searchParams.get('cursor') === 'findings-2';
      const page = state.findingsPaged ? (second ? wanted.slice(2) : wanted.slice(0, 2)) : wanted;
      return respond({ items: page, nextCursor: state.findingsPaged && !second && wanted.length > 2 ? 'findings-2' : null });
    }
    const queueRoot = path.replace(/\/summary$/, '');
    if (/^\/v1\/field-data\/projects\/\d+\/reverification-tasks$/.test(queueRoot)) {
      state.queueCalls.push({ path: path.slice(queueRoot.length) || '/', ...Object.fromEntries(url.searchParams) });
      if (state.queueFailures_ > 0) { state.queueFailures_ -= 1; return route.fulfill({ status: 503, json: { message: 'Unavailable' } }); }
      if (state.queueMalformed) return respond({ unexpected: true });
      const rows = state.queueTasks;
      if (path.endsWith('/summary')) {
        const counts = { queued: 0, dispatched: 0, closed: 0, cancelled: 0, superseded: 0, overdue: 0 };
        const people = new Map();
        for (const task of rows) {
          counts[task.status] += 1;
          if (task.overdue) counts.overdue += 1;
          if (task.status === 'dispatched') {
            const row = people.get(task.assignee.id) ?? { assignee: task.assignee, open: 0, overdue: 0 };
            row.open += 1;
            if (task.overdue) row.overdue += 1;
            people.set(task.assignee.id, row);
          }
        }
        const everyone = new Map(rows.filter(task => task.assignee).map(task => [task.assignee.id, task.assignee]));
        return respond({ counts, workload: [...people.values()], collectors: [...everyone.values()], truncated: false });
      }
      const gate = state.queueGate;
      if (gate != null) { state.queueGate = null; await gate; }
      const wanted = rows.filter(task => (url.searchParams.get('status') == null || task.status === url.searchParams.get('status'))
        && (url.searchParams.get('overdue') !== 'true' || task.overdue)
        && (url.searchParams.get('assigneeId') == null || String(task.assignee?.id) === url.searchParams.get('assigneeId')));
      const second = url.searchParams.get('cursor') === 'page-2';
      const page = state.queuePaged ? (second ? wanted.slice(1) : wanted.slice(0, 1)) : wanted;
      return respond({ items: page, allowed: true, nextCursor: state.queuePaged && !second && wanted.length > 1 ? 'page-2' : null });
    }
    const taskRoot = '/v1/field-data/projects/7/reverification-tasks/';
    if (path.startsWith(taskRoot)) {
      const { task } = state;
      const snapshot = () => route.fulfill({ json: { task, events: state.taskEvents, candidates: state.taskCandidates,
        allowed: canOverride }, headers: { etag: `"task-${task.revision}"` } });
      if (req.method() === 'GET') return snapshot();
      const data = req.postDataJSON();
      state.taskWrites.push({ path, data, headers: req.headers() });
      if (state.taskConflict) { state.taskConflict = false; task.revision += 1; return route.fulfill({ status: 412, json: { message: 'Stale' } }); }
      expect(req.headers()['if-match']).toBe(`"task-${task.revision}"`);
      const reply = () => route.fulfill({ json: { id: task.id, status: task.status, revision: task.revision, replayed: false },
        headers: { etag: `"task-${task.revision}"` } });
      const event = action => state.taskEvents.push({ id: data.requestId, action, recordedAt: '2026-10-09T10:00:00Z', note: data.note,
        assigneeName: task.assignee?.displayName ?? null, reasonCode: data.reasonCode ?? null });
      if (path.endsWith('/dispatch')) {
        Object.assign(task, { status: 'dispatched', assignee: { id: data.assigneeId, displayName: 'Collector' },
          dispatchedAt: '2026-10-09T10:00:00Z', visitBy: data.visitBy ?? null, revision: task.revision + 1 });
        event('dispatch');
        return reply();
      }
      if (path.endsWith('/close')) {
        if (state.proofRejection) return route.fulfill({ status: 409, json: { message: state.proofRejection } });
        Object.assign(task, { status: 'closed', closureObservationId: data.observationId, revision: task.revision + 1 });
        event('close');
        return reply();
      }
      if (path.endsWith('/cancel')) {
        Object.assign(task, { status: 'cancelled', revision: task.revision + 1 });
        event('cancel');
        return reply();
      }
      return route.fulfill({ status: 404, json: {} });
    }
    // K3 asset status: the predicate list, then one predicate's projection.
    if (/^\/v1\/field-data\/projects\/\d+\/assets\/projection$/.test(path)) {
      const predicate = url.searchParams.get('predicate');
      state.projectionCalls.push(url.search);
      if (state.projectionFailures-- > 0) return route.fulfill({ status: 500, json: { message: 'Failed' } });
      const p = state.projection ?? { predicates: [], assets: [], summary: { byValue: [], byStatus: {} }, excluded: { notReadable: 0, sourceDeleted: 0 }, truncated: false };
      return respond({ ...p, predicate, at: '2026-10-10T00:00:00.000Z', knownAt: '2026-10-10T00:00:00.000Z',
        assets: predicate == null ? [] : p.assets.filter((a) => !url.searchParams.get('assetType') || a.assetType === url.searchParams.get('assetType')) });
    }
    const assetRoot = '/v1/field-data/projects/7/assets';
    if (path.startsWith(assetRoot)) {
      const asset = state.assets.find(item => path.endsWith(`/${item.id}`)) ?? state.assets[0];
      if (req.method() === 'GET' && path !== assetRoot && state.assetGate != null) { const hold = state.assetGate; state.assetGate = null; await hold; }
      if (req.method() === 'GET' && path === assetRoot)
        return respond({ items: state.assets, allowed: canOverride, nextCursor: null });
      if (req.method() === 'GET') return respond({ asset, allowed: canOverride,
        history: state.assetHistory, facts: state.assetHistory.length ? [state.assetHistory[0]] : [],
        tasks: url.searchParams.get('knownAt') ? [] : state.assetTasks, at: '2026-10-09T09:00:00Z', knownAt: '2026-10-09T09:00:00Z' });
      const data = req.postDataJSON();
      state.assetWrites.push({ path, data, headers: req.headers() });
      if (state.assetFailures-- > 0) return route.fulfill({ status: 503, json: { message: 'Retry asset' } });
      if (path === assetRoot) {
        expect(data.xmlFormId).toBe('health');
        state.assets.push({ id: '55555555-5555-4555-8555-555555555555', ...data, revision: 1 });
        return respond(state.assets[0]);
      }
      if (path.endsWith('/observations')) {
        expect(req.headers()['if-match']).toBe(`"asset-${asset.revision}"`);
        if (state.assetConflict) { state.assetConflict = false; asset.revision += 1; return route.fulfill({ status: 412, json: { message: 'Stale' } }); }
        asset.revision += 1;
        state.assetHistory.unshift({ id: data.requestId, ...data, actorId: 1, recordedAt: '2026-10-09T08:00:00Z',
          integrityStatus: 'verified', sourceUrl: `/v1/field-data/claim-versions/${versionId}`,
          freshness: { status: 'expired', dueAt: '2026-01-11T00:00:00Z', expiresAt: '2026-01-13T00:00:00Z',
            limitations: 'Supervisor-defined age policy; no confidence or verification of field conditions.' } });
        return respond({ id: data.requestId, revision: asset.revision });
      }
      if (path.endsWith('/refresh')) {
        const generated = state.assetTasks.length ? 0 : 1;
        if (generated) state.assetTasks.push({ id: 'task-1', predicate: 'condition', status: 'queued', dueAt: '2026-01-11T00:00:00Z' });
        return respond({ generated });
      }
    }
    if (path === '/v1/field-data/review-queue') {
      state.queueRequests.push(Object.fromEntries(url.searchParams));
      if (state.queueFailures-- > 0) return route.fulfill({ status: 503, json: { message: 'Unavailable' } });
      if (delayOpen && url.searchParams.get('status') === 'open') await openWait;
      const matches = url.searchParams.get('projectId') === '7' && url.searchParams.get('xmlFormId') === 'health' && url.searchParams.get('status') === state.status;
      return respond({ items: matches ? [{ id: caseId, claimVersionId: versionId, revision: state.revision, status: state.status, priority: 'normal', reasonCodes: ['missing-evidence', 'provenance-degraded'], assignedTo: state.assignedTo, claim: { ordinal: 1, current: true, rootInstanceId: 'uuid:original' }, etag: etag(state.revision) }] : [], nextCursor: null });
    }
    if (path === `/v1/field-data/claim-versions/${versionId}/evidence`) return respond({ items: [{ id: 'evidence-1', sourceKind: 'submission-xml', integrityStatus: 'verified', downloadUrl: '/v1/field-data/evidence/evidence-1/content' }], nextCursor: null });
    if (path === `/v1/field-data/claim-versions/${versionId}/graph`) {
      state.graphRequests = (state.graphRequests || 0) + 1;
      if (state.graphWait) await state.graphWait;
      if (state.graphFailures-- > 0) return route.fulfill({ status: 503, json: { message: 'Unavailable' } });
      return respond({ generatedAt: '2026-10-09T09:00:00Z', complete: false,
        presence: { status: 'insufficient_evidence', limitations: 'Stored-byte integrity does not establish physical presence.' },
        limitations: ['Capture clock accuracy is unknown.'],
        nodes: [{ id: `claim-version:${versionId}`, sourceId: versionId, type: 'claim-version' },
          { id: 'evidence:original', sourceId: 'original', type: 'evidence', name: '<img src=x onerror=alert(1)>',
            integrityStatus: 'mismatch', sourceUrl: '/v1/field-data/evidence/original' }],
        edges: [{ id: 'relationship', from: 'evidence:original', to: `claim-version:${versionId}`, relation: 'contradicts' }],
        timeline: [{ id: 'capture', nodeId: `claim-version:${versionId}`, kind: 'reported-capture', timeBasis: 'reported', at: null }] });
    }
    if (path === `/v1/field-data/review-queue/${caseId}`) return respond({ claim: { id: versionId, provenance: { origin: 'collected', capturedAt: '2026-10-03T09:00:00Z', receivedAt: '2026-10-03T10:00:00Z', integrityHash: 'abcdef', degraded: null }, degraded: null }, decisions: state.decisions, reversalRequired: state.decisions.some(d => ['accepted', 'rejected'].includes(d.outcome)), overridePolicy: { allowed: canOverride, reasonCodes: canOverride ? ['verified-by-supervisor'] : [] } });
    if (path.endsWith('/comparison')) {
      state.comparisonRequests += 1;
      if (state.comparisonFailures-- > 0) return route.fulfill({ status: 503, json: { message: 'Unavailable' } });
      const source = { instanceId: 'original-version', current: true, formVersion: '1',
        provenance: { origin: 'collected', capturedAt: null, degraded: { capturedAt: 'unknown' } },
        integrityStatus: 'verified', xmlDownloadUrl: '/v1/original-version.xml' };
      return respond({ mapping: { revision: state.mappingRevision, etag: `"backcheck-mapping-${state.mappingRevision}"`,
        allowed: canOverride, history: state.mappingHistory },
        availablePaths: { original: ['/name[1]', '/note[1]'], backcheck: ['/name[1]', '/age[1]'] },
        comparisonMode: state.mappingRevision ? 'mapped' : 'exact-path', original: source, backcheck: { ...source, instanceId: 'linked-version', current: false,
        xmlDownloadUrl: '/v1/linked-version.xml' },
      ...(comparisonUnavailable ? { unavailableReason: 'source-integrity' } : state.mappingRevision && state.mappingHistory.length ? {
        summary: { same: 0, changed: 1, missingOriginal: 0, missingBackcheck: 0, unmappedOriginal: 1, unmappedBackcheck: 1 },
        rows: [{ path: 'mapped:/name[1]', originalPath: '/name[1]', backcheckPath: '/name[1]', label: 'Respondent',
          original: '<img src=x onerror=alert(1)>', backcheck: 'Corrected', status: 'changed' },
          { path: 'original:/note[1]', originalPath: '/note[1]', backcheckPath: null, original: 'Observed', backcheck: null, status: 'unmappedOriginal' }]
      } : {
        summary: { same: 0, changed: 1, missingOriginal: 1, missingBackcheck: 1 },
        rows: [{ path: '/name[1]', original: '<img src=x onerror=alert(1)>', backcheck: 'Corrected', status: 'changed' },
          { path: '/age[1]', original: null, backcheck: '', status: 'missingOriginal' },
          { path: '/note[1]', original: 'Observed', backcheck: null, status: 'missingBackcheck' }] }) });
    }
    // O4: with workload, the original collector, open counts and a suggestion.
    if (path.endsWith('/backcheck-forms') && state.workload) return respond([
      { id: 1, xmlFormId: 'health', name: 'Original', assignees: [
        { id: 41, name: 'First collector', pending: 0, overdue: 0, linkedRecently: 0, original: true, suggested: false },
        { id: 42, name: 'Second collector', pending: 2, overdue: 1, linkedRecently: 0, original: false, suggested: false },
        { id: 43, name: 'Replacement collector', pending: 0, overdue: 0, linkedRecently: 3, original: false, suggested: true }] },
      { id: 2, xmlFormId: 'verification', name: 'Verification', assignees: [
        { id: 42, name: 'Second collector', pending: 2, overdue: 1, linkedRecently: 0, original: false, suggested: true }] }]);
    if (path.endsWith('/backcheck-forms')) return respond([{ id: 1, xmlFormId: 'health', name: 'Original', assignees: [{ id: 42, name: 'Second collector' }, { id: 43, name: 'Replacement collector' }] }, { id: 2, xmlFormId: 'verification', name: 'Verification', assignees: [{ id: 43, name: 'Replacement collector' }] }]);
    if (path.endsWith('/backcheck-assignees')) return respond([{ id: 42, name: 'Second collector' }, { id: 43, name: 'Replacement collector' }]);
    if (req.method() === 'GET' && path.endsWith('/backchecks')) return respond(state.backchecks);
    if (req.method() === 'POST' && path.endsWith('/mapping')) {
      const data = req.postDataJSON();
      const headers = req.headers();
      state.mappingRequests.push({ data, headers });
      expect(headers['if-match']).toBe(`"backcheck-mapping-${state.mappingRevision}"`);
      expect(data.requestId).toMatch(/^[0-9a-f-]{36}$/);
      if (state.mappingConflict) {
        state.mappingRevision += 1;
        state.mappingConflict = false;
        return route.fulfill({ status: 412, json: { message: 'Stale mapping' } });
      }
      if (state.mappingFailures-- > 0) return route.fulfill({ status: 503, json: { message: 'Retry mapping' } });
      state.mappingRevision += 1;
      state.mappingHistory.unshift({ id: data.requestId, revision: state.mappingRevision,
        actorName: 'Supervisor', createdAt: '2026-10-09T08:00:00Z', note: data.note, pairs: data.pairs });
      return respond({ revision: state.mappingRevision });
    }
    if (['POST', 'PATCH'].includes(req.method())) {
      const data = req.postDataJSON();
      const headers = req.headers();
      state.mutations.push({ path, data, headers });
      expect(headers['if-match']).toBe(etag(state.revision));
      if (path.endsWith('/assignment') || path.endsWith('/decisions'))
        expect(headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
      if (path.endsWith('/assignment')) {
        if (state.conflictFailures-- > 0) {
          state.revision += 1;
          state.staleWrites += 1;
          return route.fulfill({ status: 412, json: { code: 412.1, message: 'Refresh and retry.' } });
        }
        if (state.assignmentFailures-- > 0) return route.fulfill({ status: 503, json: { message: 'Retry assignment' } });
        state.assignedTo = data.assignedTo;
        state.status = data.status;
      } else if (path.endsWith('/backchecks')) {
        expect(data.requestId).toMatch(/^[0-9a-f-]{36}$/);
        state.backchecks.push({ id: state.backchecks.length === 0 ? backcheckId : '44444444-4444-4444-8444-444444444444', status: 'requested', responseXmlFormId: data.responseXmlFormId, assignedTo: data.assignedTo, assigneeName: data.assignedTo === 43 ? 'Replacement collector' : 'Second collector', question: data.question });
      } else if (path.endsWith('/cancel')) {
        expect(data.requestId).toMatch(/^[0-9a-f-]{36}$/);
        state.backchecks[0] = { ...state.backchecks[0], status: 'cancelled',
          cancellationReason: data.reason, cancelledBy: 1, cancelledAt: '2026-10-08T10:00:00Z' };
      } else if (path.endsWith('/link')) {
        state.backchecks[0] = { ...state.backchecks[0], status: 'linked', responseInstanceId: data.instanceId, responseCapturedAt: null, responseDegraded: { capturedAt: 'unknown' } };
      } else if (path.endsWith('/decisions')) {
        expect(data.override).toBe(canOverride);
        state.decisions.push({ id: `decision-${state.decisions.length + 1}`, override: data.override, outcome: data.outcome, reasonCode: data.reasonCode, note: data.note, reviewerId: 1, createdAt: '2026-10-03T11:00:00Z' });
        state.status = data.outcome === 'needs-evidence' ? 'open' : 'resolved';
        state.assignedTo = null;
      } else throw new Error(`Unexpected mutation: ${path}`);
      state.revision += 1;
      return respond({ revision: state.revision }, state.revision);
    }
    return respond([]);
  });
  await page.goto(`${appUrl}/field-data/review`);
  await expect(page.getByRole('heading', { name: 'Review Queue', exact: true })).toBeVisible();
  return { state, errors, releaseOpen, releaseMetrics };
};

const openInspection = async page => {
  await page.getByText('Inspect evidence and decision history', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Claim provenance' })).toBeVisible();
};

test('sidebar queue uses claim reviews with project and form selectors', async ({ page }) => {
  const { state, errors } = await setup(page);
  await expect(page.getByRole('button', { name: 'Assign to me' })).toBeVisible();
  await openInspection(page);
  await expect(page.getByText('collected', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download original' })).toHaveAttribute('href', '/v1/field-data/evidence/evidence-1/content');
  await expect(page.getByText('No prior decisions.')).toBeVisible();
  await page.locator('#review-form').selectOption('nutrition');
  await expect(page.getByText('No open claim review cases for this form.')).toBeVisible();
  await page.locator('#review-project').selectOption('8');
  await expect(page.locator('#review-form')).toHaveValue('water');
  await expect.poll(() => state.queueRequests.at(-1)?.projectId).toBe('8');
  expect(state.queueRequests.at(-1).xmlFormId).toBe('water');
  expect(errors).toEqual([]);
});

test('workload metrics show elapsed age and refresh when the form changes', async ({ page }) => {
  await setup(page, { readOnly: true });
  const metrics = page.getByRole('region', { name: 'Review workload' });
  await expect(metrics).toContainText('2 hr');
  await expect(metrics).toContainText('No data');
  await metrics.getByText('Reasons for active cases', { exact: true }).click();
  await expect(metrics).toContainText('provenance-degraded: 1');
  await page.locator('#review-form').selectOption('nutrition');
  await expect(metrics).toContainText('No active routing reasons.');
  await expect(metrics).not.toContainText('2 hr');
});

test('workload failure offers retry without hiding the review queue', async ({ page }) => {
  await setup(page, { failMetrics: true });
  await expect(page.getByRole('button', { name: 'Assign to me' })).toBeVisible();
  await page.getByRole('button', { name: 'Retry workload' }).click();
  await expect(page.getByRole('region', { name: 'Review workload' })).toContainText('2 hr');
});

test('late workload response cannot replace the selected form totals', async ({ page }) => {
  const { releaseMetrics } = await setup(page, { delayMetrics: true });
  await expect(page.getByRole('button', { name: 'Assign to me' })).toBeVisible();
  await page.locator('#review-form').selectOption('nutrition');
  const metrics = page.getByRole('region', { name: 'Review workload' });
  await expect(metrics).toContainText('No data');
  const oldResponse = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/metrics') && url.searchParams.get('xmlFormId') === 'health';
  });
  releaseMetrics();
  await oldResponse;
  await expect(metrics).not.toContainText('2 hr');
});

test('read-only reviewer can inspect but cannot assign or decide', async ({ page }) => {
  const { errors } = await setup(page, { readOnly: true });
  await expect(page.locator('#fd-sidebar').getByRole('link', { name: 'Review Queue' })).toBeVisible();
  await openInspection(page);
  await expect(page.getByRole('button', { name: 'Assign to me' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Accept claim' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('reviewer assigns, requests and links a back-check, then records a decision', async ({ page }) => {
  const { state, errors } = await setup(page);
  await page.getByRole('button', { name: 'Assign to me' }).click();
  await page.getByRole('button', { name: 'In review', exact: true }).click();
  await openInspection(page);
  await page.getByLabel('App User', { exact: true }).selectOption('42');
  await page.getByLabel('What should they verify?').fill('Verify the visit date.');
  await page.getByRole('button', { name: 'Request back-check', exact: true }).click();
  await expect.poll(() => state.backchecks.length).toBe(1);
  await openInspection(page);
  await page.getByLabel('Decision reason', { exact: true }).fill('Verified the original and field result.');
  await expect(page.getByRole('button', { name: 'Accept claim', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Reject claim', exact: true })).toBeDisabled();
  await page.getByLabel('Synced back-check submission ID').fill('uuid:backcheck');
  await page.getByRole('button', { name: 'Link field result' }).click();
  await expect.poll(() => state.backchecks[0].status).toBe('linked');
  await openInspection(page);
  await expect(page.getByRole('link', { name: 'uuid:backcheck', exact: true })).toHaveAttribute('href', '/projects/7/forms/health/submissions/uuid%3Abackcheck');
  await expect(page.getByText(/Capture time: unknown/)).toBeVisible();
  await page.getByLabel('Reason code', { exact: true }).selectOption('provenance-degraded');
  await page.getByRole('button', { name: 'Accept claim', exact: true }).click();
  await expect.poll(() => state.status).toBe('resolved');
  await page.getByRole('button', { name: 'Resolved', exact: true }).click();
  await openInspection(page);
  await expect(page.getByText(/accepted · provenance-degraded/)).toBeVisible();
  expect(state.mutations.map(mutation => mutation.headers['if-match'])).toEqual([etag(1), etag(2), etag(3), etag(4)]);
  expect(errors).toEqual([]);
});

test('reviewer cancels a pending visit with a reason and retains it when requesting a replacement', async ({ page }) => {
  const { state, errors } = await setup(page);
  await page.getByRole('button', { name: 'Assign to me' }).click();
  await page.getByRole('button', { name: 'In review', exact: true }).click();
  await openInspection(page);
  await page.getByLabel('App User', { exact: true }).selectOption('42');
  await page.getByLabel('What should they verify?').fill('Verify the visit date.');
  await page.getByRole('button', { name: 'Request back-check', exact: true }).click();
  await expect.poll(() => state.backchecks.length).toBe(1);
  await openInspection(page);
  const cancel = page.getByRole('button', { name: 'Cancel back-check', exact: true });
  await expect(cancel).toBeDisabled();
  await page.getByLabel('Cancellation reason', { exact: true }).fill('Collector is unavailable.');
  await cancel.click();
  await expect.poll(() => state.backchecks[0].status).toBe('cancelled');
  await openInspection(page);
  await expect(page.getByText('Cancellation reason: Collector is unavailable.')).toBeVisible();
  await expect(page.getByLabel('Synced back-check submission ID')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Request back-check', exact: true })).toBeVisible();
  await page.getByLabel('App User', { exact: true }).selectOption('43');
  await page.getByLabel('What should they verify?').fill('Arrange a replacement visit.');
  await page.getByRole('button', { name: 'Request back-check', exact: true }).click();
  await expect.poll(() => state.backchecks.length).toBe(2);
  expect(state.backchecks.map(backcheck => backcheck.assignedTo)).toEqual([42, 43]);
  await openInspection(page);
  await expect(page.getByText('Cancellation reason: Collector is unavailable.')).toBeVisible();
  expect(state.mutations.map(mutation => mutation.headers['if-match']))
    .toEqual([etag(1), etag(2), etag(3), etag(4)]);
  expect(errors).toEqual([]);
});

test('queue failure offers retry', async ({ page }) => {
  await setup(page, { failQueue: true });
  await expect(page.getByText('Review cases could not be loaded.')).toBeVisible();
  await page.locator('.review-queue').getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('button', { name: 'Assign to me' })).toBeVisible();
});

test('unchanged assignment retry reuses its idempotency key', async ({ page }) => {
  const { state } = await setup(page, { failAssignment: true });
  await page.getByRole('button', { name: 'Assign to me' }).click();
  await expect.poll(() => state.mutations.length).toBe(1);
  await expect(page.getByRole('button', { name: 'Assign to me' })).toBeEnabled();
  await page.getByRole('button', { name: 'Assign to me' }).click();
  await expect.poll(() => state.mutations.length).toBe(2);
  expect(state.mutations[0].headers['idempotency-key']).toBe(state.mutations[1].headers['idempotency-key']);
});

test('empty permissions show an explicit empty state', async ({ page }) => {
  const { state, errors } = await setup(page, { noProjects: true });
  await expect(page.getByText('No projects with submission read access are available.')).toBeVisible();
  expect(state.queueRequests).toHaveLength(0);
  expect(errors).toEqual([]);
});


test('late response from an old status cannot overwrite the selected queue', async ({ page }) => {
  const { state, releaseOpen, errors } = await setup(page, { delayOpen: true });
  await expect.poll(() => state.queueRequests.length).toBe(1);
  await page.getByRole('button', { name: 'In review', exact: true }).click();
  await expect(page.getByText('No in-review claim review cases for this form.')).toBeVisible();
  const oldResponse = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/review-queue') && url.searchParams.get('status') === 'open';
  });
  releaseOpen();
  await (await oldResponse).finished();
  await expect(page.getByText('No in-review claim review cases for this form.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Assign to me' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('administrator retains submission quality rules as a secondary tool', async ({ page }) => {
  const { state } = await setup(page, { manageQuality: true });
  await expect(page.getByRole('button', { name: 'Assign to me' })).toBeVisible();
  expect(state.qualityLoaded).toBeUndefined();
  await page.getByText('Submission quality checks and rules', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Submission quality review' })).toBeVisible();
  await expect(page.getByText('Quality rules', { exact: true })).toBeVisible();
  expect(state.qualityLoaded).toBe(true);
});


test('supervisor can explicitly accept with an audited override', async ({ page }) => {
  const { state } = await setup(page, { canOverride: true });
  await page.goto(`${appUrl}/field-data/review`);
  await page.getByRole('button', { name: 'Assign to me' }).click();
  await page.getByRole('button', { name: 'In review', exact: true }).click();
  await openInspection(page);
  const accept = page.getByRole('button', { name: 'Accept with supervisor override' });
  await expect(accept).toBeDisabled();
  await page.getByLabel('Decision reason', { exact: true }).fill('Verified with the field supervisor.');
  await accept.click();
  await expect.poll(() => state.status).toBe('resolved');
  await page.getByRole('button', { name: 'Resolved', exact: true }).click();
  await openInspection(page);
  await expect(page.getByText(/Supervisor override · accepted/)).toBeVisible();
  expect(state.mutations.at(-1).data).toMatchObject({ outcome: 'accepted', override: true,
    reasonCode: 'verified-by-supervisor', note: 'Verified with the field supervisor.' });
});


test('stale assignment refreshes revision and form conflict totals before retry', async ({ page }) => {
  const { state, errors } = await setup(page, { staleAssignment: true });
  const metrics = page.getByRole('region', { name: 'Review workload' });
  await expect(metrics).toContainText('Stale write conflicts: 0');
  await page.getByRole('button', { name: 'Assign to me' }).click();
  await expect(metrics).toContainText('Stale write conflicts: 1');
  await metrics.getByText('Stale write conflicts: 1', { exact: true }).click();
  await expect(metrics).toContainText('Assignment: 1');
  await expect(metrics).toContainText('Refresh the case before retrying.');
  await page.getByRole('button', { name: 'Assign to me' }).click();
  await expect.poll(() => state.status).toBe('in-review');
  expect(state.mutations.map(m => m.headers['if-match'])).toEqual([etag(1), etag(2)]);
  expect(state.mutations[0].headers['idempotency-key']).not.toBe(state.mutations[1].headers['idempotency-key']);
  expect(errors).toEqual([]);
  await page.locator('#review-form').selectOption('nutrition');
  await expect(metrics).toContainText('Stale write conflicts: 0');
  await expect(metrics).toContainText('No stale write conflicts recorded.');
});


test('supervisor reopens a resolved case and replaces its decision without erasing history', async ({ page }) => {
  const { state, errors } = await setup(page, { canOverride: true });
  await page.getByRole('button', { name: 'Assign to me' }).click();
  await page.getByRole('button', { name: 'In review', exact: true }).click();
  await openInspection(page);
  await page.getByLabel('Decision reason', { exact: true }).fill('Initial supervisor assessment.');
  await page.getByRole('button', { name: 'Accept with supervisor override' }).click();
  await page.getByRole('button', { name: 'Resolved', exact: true }).click();
  await openInspection(page);
  const reopen = page.getByRole('button', { name: 'Reopen for review', exact: true });
  await expect(reopen).toBeDisabled();
  await page.getByLabel('Reason for reopening').fill('New field information requires review.');
  await reopen.click();
  await expect.poll(() => state.status).toBe('open');
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await page.getByRole('button', { name: 'Assign to me' }).click();
  await page.getByRole('button', { name: 'In review', exact: true }).click();
  await openInspection(page);
  await expect(page.getByRole('button', { name: 'Accept claim', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reject claim', exact: true })).toHaveCount(0);
  await page.getByLabel('Decision reason', { exact: true }).fill('Original decision corrected after verification.');
  await page.getByRole('button', { name: 'Replace decision with rejection' }).click();
  await page.getByRole('button', { name: 'Resolved', exact: true }).click();
  await openInspection(page);
  expect(state.decisions.map(d => d.outcome)).toEqual(['accepted', 'needs-evidence', 'rejected']);
  await expect(page.getByText(/accepted · verified-by-supervisor/)).toBeVisible();
  await expect(page.getByText(/needs-evidence · reopen-for-review/)).toBeVisible();
  await expect(page.getByText(/rejected · reconsidered-decision/)).toBeVisible();
  expect(state.mutations.map(m => m.headers['if-match'])).toEqual([etag(1), etag(2), etag(3), etag(4), etag(5)]);
  expect(errors).toEqual([]);
});


test('ordinary reviewers cannot replace the terminal decision of a reopened case', async ({ page }) => {
  const { state } = await setup(page);
  state.decisions.push({ id: 'prior-decision', outcome: 'rejected', override: false,
    reasonCode: 'provenance-degraded', note: 'Original decision.', reviewerId: 1 });
  state.status = 'in-review';
  state.assignedTo = 1;
  await page.getByRole('button', { name: 'In review', exact: true }).click();
  await openInspection(page);
  await expect(page.getByText('This reopened case requires a supervisor to replace the earlier terminal decision.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept claim', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reject claim', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Replace decision with rejection' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reopen for review', exact: true })).toHaveCount(0);
});


test('read-only comparison shows pinned versions, safe answer text, missing values and mobile reflow', async ({ page }) => {
  const { state, errors } = await setup(page, { readOnly: true });
  state.backchecks.push({ id: backcheckId, status: 'linked', responseInstanceId: 'uuid:backcheck',
    question: 'Verify answers.', assigneeName: 'Independent checker' });
  await openInspection(page);
  expect(state.comparisonRequests).toBe(0);
  await page.getByRole('button', { name: 'Compare answers', exact: true }).click();
  const comparison = page.getByRole('region', { name: 'Back-check answer comparison' });
  await expect(comparison).toContainText('Changed: 1');
  await expect(comparison).toContainText('Not present');
  await expect(comparison).toContainText('Empty answer');
  await expect(comparison).toContainText('Historical version; newer edits are not included.');
  await expect(comparison).toContainText('Repeats align by position');
  await expect(comparison.getByRole('link', { name: 'Download back-check version XML' })).toHaveAttribute('href', '/v1/linked-version.xml');
  await expect(comparison.getByText('<img src=x onerror=alert(1)>', { exact: true })).toBeVisible();
  await expect(comparison.locator('img')).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 720 });
  await expect.poll(() => page.evaluate(() => globalThis.document.documentElement.scrollWidth <= 320)).toBe(true);
  await expect(comparison.getByText('Configure field mapping', { exact: true })).toHaveCount(0);
  expect(state.mutations).toEqual([]);
  expect(errors).toEqual([]);
});

test('comparison failure retries independently and unverified sources do not show answer rows', async ({ page }) => {
  const { state, errors } = await setup(page, { readOnly: true, failComparison: true, comparisonUnavailable: true });
  state.backchecks.push({ id: backcheckId, status: 'linked', responseInstanceId: 'uuid:backcheck',
    question: 'Verify answers.', assigneeName: 'Independent checker' });
  await openInspection(page);
  await page.getByRole('button', { name: 'Compare answers', exact: true }).click();
  await expect(page.getByText('Answer comparison could not be loaded. Retry to inspect the linked versions.')).toBeVisible();
  await page.getByRole('button', { name: 'Retry answer comparison', exact: true }).click();
  const comparison = page.getByRole('region', { name: 'Back-check answer comparison' });
  await expect(comparison).toContainText('source integrity could not be verified');
  await expect(comparison.getByRole('table')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Claim provenance' })).toBeVisible();
  expect(errors).toEqual([]);
});


test('dedicated back-check form filters collectors and links to the selected form', async ({ page }) => {
  const { state, errors } = await setup(page);
  await page.getByRole('button', { name: 'Assign to me' }).click();
  await page.getByRole('button', { name: 'In review', exact: true }).click();
  await openInspection(page);
  await page.getByLabel('App User', { exact: true }).selectOption('42');
  await page.getByLabel('Back-check form', { exact: true }).selectOption('verification');
  await expect(page.getByLabel('App User', { exact: true }).locator('option:checked'))
    .toHaveText('Choose a different collector');
  await expect(page.getByLabel('App User', { exact: true }).locator('option')).toHaveCount(2);
  await page.getByLabel('App User', { exact: true }).selectOption('43');
  await page.getByLabel('What should they verify?').fill('Verify the visit independently.');
  await page.getByRole('button', { name: 'Request back-check', exact: true }).click();
  await expect.poll(() => state.backchecks.length).toBe(1);
  expect(state.backchecks[0].responseXmlFormId).toBe('verification');
  await openInspection(page);
  await page.getByLabel('Synced back-check submission ID').fill('uuid:verification');
  await page.getByRole('button', { name: 'Link field result' }).click();
  await openInspection(page);
  await expect(page.getByRole('link', { name: 'uuid:verification', exact: true }))
    .toHaveAttribute('href', '/projects/7/forms/verification/submissions/uuid%3Averification');
  state.backchecks[0].seenAt = '2026-10-09T05:00:00Z';
  await page.getByRole('button', { name: 'Refresh back-checks' }).click();
  await expect(page.getByText('App User acknowledgment: 2026-10-09T05:00:00Z')).toBeVisible();
  expect(errors).toEqual([]);
});


test('supervisor saves an audited mapping with independent revisions and stable retry IDs', async ({ page }) => {
  const { state, errors } = await setup(page, { canOverride: true });
  state.mappingFailures = 1;
  state.backchecks.push({ id: backcheckId, status: 'linked', responseInstanceId: 'uuid:backcheck',
    question: 'Verify answers.', assigneeName: 'Independent checker' });
  await openInspection(page);
  await page.getByRole('button', { name: 'Compare answers', exact: true }).click();
  const comparison = page.getByRole('region', { name: 'Back-check answer comparison' });
  await comparison.getByText('Configure field mapping', { exact: true }).click();
  await comparison.getByRole('button', { name: 'Add field pair' }).click();
  await comparison.getByLabel('Label', { exact: true }).fill('Respondent');
  await comparison.getByLabel('Original field path', { exact: true }).fill('/name[1]');
  await comparison.getByLabel('Back-check field path', { exact: true }).fill('/name[1]');
  await comparison.getByLabel('Reason for mapping change').fill('Equivalent respondent questions.');
  await comparison.getByRole('button', { name: 'Save field mapping' }).click();
  await expect(comparison.getByRole('alert')).toContainText('could not be saved');
  await comparison.getByRole('button', { name: 'Save field mapping' }).click();
  await expect(comparison).toContainText('Field mapping revision: 1');
  await expect(comparison).toContainText('Review decisions are unchanged.');
  await expect(comparison).toContainText('Unmapped original: 1');
  await expect(comparison.getByRole('cell', { name: 'Unmapped original', exact: true })).toBeVisible();
  expect(state.mappingRequests[0].data.requestId).toBe(state.mappingRequests[1].data.requestId);
  expect(state.mappingHistory[0].pairs).toEqual([{ label: 'Respondent', originalPath: '/name[1]', backcheckPath: '/name[1]' }]);
  await comparison.getByText('Mapping history (latest 100 revisions)', { exact: true }).click();
  await expect(comparison).toContainText('Equivalent respondent questions.');
  await page.setViewportSize({ width: 320, height: 720 });
  await expect.poll(() => page.evaluate(() => globalThis.document.documentElement.scrollWidth <= 320)).toBe(true);
  expect(state.revision).toBe(1);
  expect(state.decisions).toEqual([]);
  expect(errors).toEqual([]);
});

test('mapping conflict requires reload before another save', async ({ page }) => {
  const { state, errors } = await setup(page, { canOverride: true });
  state.mappingConflict = true;
  state.backchecks.push({ id: backcheckId, status: 'linked', responseInstanceId: 'uuid:backcheck', question: 'Verify.', assigneeName: 'Checker' });
  await openInspection(page);
  await page.getByRole('button', { name: 'Compare answers', exact: true }).click();
  const comparison = page.getByRole('region', { name: 'Back-check answer comparison' });
  await comparison.getByText('Configure field mapping', { exact: true }).click();
  await comparison.getByLabel('Reason for mapping change').fill('Keep all fields unmapped.');
  await comparison.getByRole('button', { name: 'Save field mapping' }).click();
  await expect(comparison.getByRole('alert')).toContainText('Another supervisor changed this mapping');
  await page.getByRole('button', { name: 'Compare answers', exact: true }).click();
  await expect(comparison).toContainText('Field mapping revision: 1');
  expect(errors).toEqual([]);
});


test('asset passport registration, dated evidence, task generation and mobile history', async ({ page }) => {
  const { state, errors } = await setup(page, { canOverride: true });
  await openInspection(page);
  await page.getByRole('button', { name: 'Use as asset observation source' }).click();
  const assets = page.getByRole('region', { name: 'Asset passports and re-verification' });
  await assets.getByRole('button', { name: 'Load assets', exact: true }).click();
  await expect(assets).toContainText('No accessible assets');
  await assets.getByText('Register physical asset', { exact: true }).click();
  await assets.getByLabel('Asset name', { exact: true }).fill('Water point');
  await assets.getByLabel('Asset type', { exact: true }).fill('water-point');
  await assets.getByLabel('External asset identifier').fill('WP-01');
  await assets.getByRole('button', { name: 'Register asset', exact: true }).click();
  await expect(assets.getByRole('heading', { name: 'Water point · WP-01' })).toBeVisible();
  await assets.getByText('Record asset observation', { exact: true }).click();
  await expect(assets.getByLabel('Source claim version ID')).toHaveValue(versionId);
  await assets.getByLabel('Fact / predicate').fill('condition');
  await assets.getByLabel('Observed value').fill('<img src=x onerror=alert(1)>');
  await assets.getByLabel('Valid from (ISO date and time)').fill('2026-01-01T00:00:00Z');
  await assets.getByLabel('Validity in days').fill('10');
  await assets.getByLabel('Grace period in days').fill('2');
  await assets.getByLabel('Observation reason').fill('Recorded from inspected source.');
  state.assetFailures = 1;
  await assets.getByRole('button', { name: 'Save observation' }).click();
  await expect(assets.getByRole('alert')).toContainText('Asset request failed');
  await assets.getByRole('button', { name: 'Save observation' }).click();
  await expect(assets).toContainText('expired');
  expect(state.assetWrites[1].data.requestId).toBe(state.assetWrites[2].data.requestId);
  await expect(assets.locator('img')).toHaveCount(0);
  await assets.getByRole('button', { name: 'Generate due re-verification tasks' }).click();
  await expect(assets).toContainText('Generated 1 new re-verification tasks.');
  await assets.getByRole('button', { name: 'Generate due re-verification tasks' }).click();
  await expect(assets).toContainText('Generated 0 new re-verification tasks.');
  await assets.getByText('Observation history', { exact: true }).click();
  await expect(assets).toContainText('Recorded from inspected source.');
  await page.setViewportSize({ width: 320, height: 720 });
  await expect.poll(() => page.evaluate(() => globalThis.document.documentElement.scrollWidth <= 320)).toBe(true);
  expect(state.decisions).toEqual([]);
  expect(errors).toEqual([]);
});

test('asset viewers cannot register or write observations', async ({ page }) => {
  const { state, errors } = await setup(page, { readOnly: true });
  state.assets.push({ id: '55555555-5555-4555-8555-555555555555', name: 'Water point', externalId: 'WP-01', assetType: 'water-point', revision: 1 });
  const assets = page.getByRole('region', { name: 'Asset passports and re-verification' });
  await assets.getByRole('button', { name: 'Load assets', exact: true }).click();
  await expect(assets.getByText('Register physical asset', { exact: true })).toHaveCount(0);
  await assets.getByLabel('Asset', { exact: true }).selectOption(state.assets[0].id);
  await expect(assets.getByText('Record asset observation', { exact: true })).toHaveCount(0);
  await expect(assets.getByRole('button', { name: 'Generate due re-verification tasks' })).toHaveCount(0);
  expect(state.assetWrites).toEqual([]);
  expect(errors).toEqual([]);
});


test('asset stale-write recovery reloads the current revision before another observation', async ({ page }) => {
  const { state, errors } = await setup(page, { canOverride: true });
  state.assets.push({ id: '55555555-5555-4555-8555-555555555555', name: 'Water point', externalId: 'WP-01', assetType: 'water-point', revision: 1 });
  state.assetConflict = true;
  const assets = page.getByRole('region', { name: 'Asset passports and re-verification' });
  await assets.getByRole('button', { name: 'Load assets', exact: true }).click();
  await assets.getByLabel('Asset', { exact: true }).selectOption(state.assets[0].id);
  await assets.getByText('Record asset observation', { exact: true }).click();
  await assets.getByLabel('Source claim version ID').fill(versionId);
  await assets.getByLabel('Fact / predicate').fill('condition');
  await assets.getByLabel('Observed value').fill('operating');
  await assets.getByLabel('Valid from (ISO date and time)').fill('2026-01-01T00:00:00Z');
  await assets.getByLabel('Observation reason').fill('Recorded source.');
  await assets.getByRole('button', { name: 'Save observation' }).click();
  await expect(assets.getByRole('alert')).toContainText('Another supervisor changed this asset');
  await assets.getByRole('button', { name: 'Query dated facts' }).click();
  await expect(assets).toContainText('Revision 2');
  expect(state.assetHistory).toEqual([]);
  expect(errors).toEqual([]);
});

test('evidence graph loads on demand, retries and shows safe source-linked replay on mobile', async ({ page }) => {
  const { state, errors } = await setup(page, { readOnly: true });
  await page.getByText('Inspect evidence and decision history', { exact: true }).click();
  const graph = page.locator('.evidence-graph');
  await expect(graph.getByRole('button', { name: 'Load evidence graph', exact: true })).toBeVisible();
  expect(state.graphRequests).toBeUndefined();
  state.graphFailures = 1;
  await graph.getByRole('button', { name: 'Load evidence graph', exact: true }).click();
  await expect(graph.getByRole('alert')).toContainText('could not be loaded');
  await graph.getByRole('button', { name: 'Load evidence graph', exact: true }).click();
  await expect(graph).toContainText('insufficient_evidence');
  await expect(graph).toContainText('projection is incomplete');
  await expect(graph).toContainText('Integrity: mismatch');
  await expect(graph).toContainText('contradicts');
  await expect(graph).toContainText('Time unknown');
  await expect(graph.locator('img')).toHaveCount(0);
  const target = await graph.getByRole('link', { name: 'evidence:original', exact: true }).getAttribute('href');
  await expect(graph.locator(`[id="${target.slice(1)}"]`)).toBeVisible();
  await page.setViewportSize({ width: 320, height: 720 });
  await expect.poll(() => page.evaluate(() => globalThis.document.documentElement.scrollWidth <= 320)).toBe(true);
  await graph.getByRole('button', { name: 'Refresh evidence graph', exact: true }).click();
  await expect(graph).toContainText('insufficient_evidence');
  expect(state.graphRequests).toBe(3);
  expect(state.mutations).toEqual([]);
  expect(errors).toEqual([]);
});

test('a delayed evidence graph cannot populate a different form', async ({ page }) => {
  const { state, errors } = await setup(page, { readOnly: true });
  let release;
  state.graphWait = new Promise(resolve => { release = resolve; });
  await openInspection(page);
  await page.getByRole('button', { name: 'Load evidence graph', exact: true }).click();
  await expect.poll(() => state.graphRequests).toBe(1);
  await page.locator('#review-form').selectOption('nutrition');
  const response = page.waitForResponse(r => new URL(r.url()).pathname.endsWith('/graph'));
  release();
  await response;
  await expect(page.locator('.evidence-graph')).toHaveCount(0);
  await expect(page.getByText('No open claim review cases for this form.')).toBeVisible();
  expect(errors).toEqual([]);
});

const taskId = '66666666-6666-4666-8666-666666666666';
const observationId = '77777777-7777-4777-8777-777777777777';
const seedTask = (state) => {
  state.assets.push({ id: '55555555-5555-4555-8555-555555555555', name: 'Water point', externalId: 'WP-01', assetType: 'water-point', revision: 3 });
  state.assetTasks.push({ id: taskId, predicate: 'condition', status: 'queued', dueAt: '2026-01-11T00:00:00Z' });
  state.task = { id: taskId, status: 'queued', revision: 1, predicate: 'condition', dueAt: '2026-01-11T00:00:00Z',
    assignee: null, visitBy: null, dispatchedAt: null, overdue: false, closureObservationId: null };
  state.taskEvents = [];
  state.taskCandidates = [{ claimVersionId: versionId, instanceId: 'visit-1', receivedAt: '2026-10-09T10:30:00Z', capturedAt: null }];
  state.taskWrites = [];
  state.taskConflict = false;
  state.proofRejection = null;
  state.assetHistory.push({ id: observationId, predicate: 'condition', state: 'known', value: 'needs repair', actorId: 1,
    validFrom: '2026-10-09T10:45:00Z', recordedAt: '2026-10-09T11:00:00Z', integrityStatus: 'verified',
    sourceUrl: `/v1/field-data/claim-versions/${versionId}`,
    freshness: { status: 'fresh', dueAt: '2027-01-01T00:00:00Z', expiresAt: '2027-01-01T00:00:00Z', limitations: 'Supervisor-defined age policy.' } });
};
const openTask = async (page, state) => {
  await openInspection(page);
  const assets = page.getByRole('region', { name: 'Asset passports and re-verification' });
  await assets.getByRole('button', { name: 'Load assets', exact: true }).click();
  await assets.getByLabel('Asset', { exact: true }).selectOption(state.assets[0].id);
  await assets.getByRole('button', { name: 'Manage' }).click();
  return assets;
};

test('supervisors dispatch a task, see why a closure is refused, and close it on collector evidence', async ({ page }) => {
  const { state, errors } = await setup(page, { canOverride: true });
  seedTask(state);
  const assets = await openTask(page, state);
  await expect(assets.getByRole('group', { name: 'Dispatch to a collector' })).toBeVisible();
  await assets.getByLabel('App User').selectOption('42');
  await assets.getByLabel('Instruction shown to the collector').fill('Check the pump handle. <img src=x onerror=alert(1)>');
  await assets.getByRole('button', { name: 'Dispatch task' }).click();
  await expect(assets).toContainText('Assignment saved');
  expect(state.taskWrites[0].path).toMatch(/\/dispatch$/);
  expect(state.taskWrites[0].headers['if-match']).toBe('"task-1"');
  expect(state.taskWrites[0].data.assigneeId).toBe(42);
  await expect(assets).toContainText('Assigned to Collector');
  await expect(assets.locator('img')).toHaveCount(0);
  await expect(assets).toContainText('visit-1');

  // A refusal explains itself and leaves the task dispatched; the retry reuses its request ID.
  state.proofRejection = 'The linked observation is not acceptable field evidence for this task: received-before-dispatch.';
  await assets.getByLabel('Observation recorded from that submission').selectOption(observationId);
  await assets.getByLabel('Closing note').fill('Collector visit received.');
  await assets.getByRole('button', { name: 'Close task' }).click();
  await expect(assets.getByRole('alert')).toContainText('received-before-dispatch');
  await expect(assets).toContainText('Status: dispatched');
  state.proofRejection = null;
  await assets.getByRole('button', { name: 'Close task' }).click();
  await expect(assets).toContainText('Closed by a collector visit');
  const closes = state.taskWrites.filter(write => write.path.endsWith('/close'));
  expect(closes).toHaveLength(2);
  expect(closes[0].data.requestId).toBe(closes[1].data.requestId);
  await expect(assets.getByRole('group', { name: 'Close with visit evidence' })).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 720 });
  await expect.poll(() => page.evaluate(() => globalThis.document.documentElement.scrollWidth <= 320)).toBe(true);
  expect(errors).toEqual([]);
});

test('task stale-write recovery reloads the revision, and cancellation claims no visit', async ({ page }) => {
  const { state, errors } = await setup(page, { canOverride: true });
  seedTask(state);
  const assets = await openTask(page, state);
  state.taskConflict = true;
  await assets.getByLabel('App User').selectOption('42');
  await assets.getByLabel('Instruction shown to the collector').fill('Visit the site.');
  await assets.getByRole('button', { name: 'Dispatch task' }).click();
  await expect(assets.getByRole('alert')).toContainText('Another supervisor changed this task');
  await assets.getByRole('button', { name: 'Dispatch task' }).click();
  await expect(assets).toContainText('Assignment saved');
  expect(state.taskWrites.map(write => write.headers['if-match'])).toEqual(['"task-1"', '"task-2"']);
  await assets.locator('select').filter({ hasText: 'Site not reachable' }).selectOption('access-blocked');
  await assets.getByLabel('Note', { exact: true }).fill('Road washed out.');
  await assets.getByRole('button', { name: 'Cancel task' }).click();
  await expect(assets).toContainText('Cancelled without a visit');
  await expect(assets).toContainText('does not show the asset was checked');
  expect(state.taskWrites[state.taskWrites.length - 1].data).toMatchObject({ reasonCode: 'access-blocked' });
  expect(errors).toEqual([]);
});

test('viewers can read a task but cannot dispatch, close or cancel it', async ({ page }) => {
  const { state, errors } = await setup(page, { readOnly: true });
  seedTask(state);
  const assets = await openTask(page, state);
  await expect(assets).toContainText('Status: queued');
  await expect(assets.getByRole('group', { name: 'Dispatch to a collector' })).toHaveCount(0);
  await expect(assets.getByRole('button', { name: 'Cancel task' })).toHaveCount(0);
  expect(state.taskWrites).toEqual([]);
  expect(errors).toEqual([]);
});

const queueTask = (over) => ({ id: crypto.randomUUID(), status: 'queued', revision: 1, reason: 'age-policy-review-due',
  dueAt: '2026-01-11T00:00:00Z', visitBy: null, dispatchedAt: null, closedAt: null, assetId: '55555555-5555-4555-8555-555555555555',
  assetName: 'Water point', externalId: 'WP-01', assetType: 'water-point', predicate: 'condition', xmlFormId: 'health',
  assignee: null, overdue: false, closureObservationId: null, ...over });
const seedQueue = (state, { paged = false } = {}) => {
  state.queueCalls = [];
  state.queueFailures_ = 0;
  state.queueGate = null;
  state.assetGate = null;
  state.queuePaged = paged;
  state.queueTasks = [
    queueTask({ id: 'a1111111-1111-4111-8111-111111111111', externalId: 'WP-01' }),
    queueTask({ id: 'a2222222-2222-4222-8222-222222222222', status: 'dispatched', externalId: 'WP-02', assignee: { id: 42, displayName: 'Collector' },
      visitBy: '2026-09-01T00:00:00Z', overdue: true }),
    queueTask({ id: 'a3333333-3333-4333-8333-333333333333', status: 'dispatched', externalId: 'PU-07', assetName: 'Pump', xmlFormId: 'nutrition',
      assetId: '66666666-6666-4666-8666-666666666667', assignee: { id: 42, displayName: 'Collector' }, visitBy: '2027-01-01T00:00:00Z' }),
    queueTask({ id: 'a4444444-4444-4444-8444-444444444444', status: 'dispatched', externalId: 'WP-04', assignee: { id: 43, displayName: 'Second collector' },
      visitBy: '2027-01-01T00:00:00Z' }),
    queueTask({ id: 'a5555555-5555-4555-8555-555555555555', status: 'cancelled', externalId: 'WP-05',
      assignee: { id: 44, displayName: 'Retired collector' } })
  ];
};
const queuePanel = page => page.getByRole('region', { name: 'Re-verification queue' });
// The panel loads when the page opens, before a test can seed data, so seed and then refresh.
const showSeededQueue = async (page, state, options) => {
  seedQueue(state, options);
  await queuePanel(page).getByRole('button', { name: 'Refresh queue' }).click();
  return queuePanel(page);
};

test('project queue shows counts and workload, and its filters ask the server for exactly what was chosen', async ({ page }) => {
  const { state, errors } = await setup(page, { canOverride: true });
  const queue = await showSeededQueue(page, state);
  await expect(queue).toContainText('1 waiting for dispatch');
  await expect(queue).toContainText('3 dispatched');
  await expect(queue).toContainText('1 overdue');
  await expect(queue.getByText('Collector — 2 open (1 overdue)')).toBeVisible();
  await expect(queue.getByText('Second collector — 1 open')).toBeVisible();
  await expect(queue).toContainText('not a measure of performance');
  await expect(queue.locator('.queue-items li')).toHaveCount(5);

  await queue.getByLabel('Overdue only').check();
  await expect(queue.locator('.queue-items li')).toHaveCount(1);
  await expect(queue).toContainText('WP-02');
  expect(state.queueCalls.filter(call => call.path === '/').at(-1)).toMatchObject({ overdue: 'true' });
  await queue.getByLabel('Overdue only').uncheck();

  await queue.getByLabel('Collector').selectOption('43');
  await expect(queue.locator('.queue-items li')).toHaveCount(1);
  await expect(queue).toContainText('WP-04');
  expect(state.queueCalls.filter(call => call.path === '/').at(-1)).toMatchObject({ assigneeId: '43' });
  await queue.getByLabel('Collector').selectOption('');

  await queue.getByLabel('Status').selectOption('cancelled');
  await expect(queue.locator('.queue-items li')).toHaveCount(1);
  expect(state.queueCalls.filter(call => call.path === '/').at(-1)).toMatchObject({ status: 'cancelled' });
  await queue.getByLabel('Status').selectOption('');
  await expect(queue.locator('.queue-items li')).toHaveCount(5);
  expect(errors).toEqual([]);
});

test('queue explains an empty result, pages on request, and retries a failed load', async ({ page }) => {
  const { state, errors } = await setup(page, { canOverride: true });
  const queue = await showSeededQueue(page, state, { paged: true });
  await expect(queue.locator('.queue-items li')).toHaveCount(1);
  await queue.getByRole('button', { name: 'Load more' }).click();
  await expect(queue.locator('.queue-items li')).toHaveCount(5);
  await expect(queue.getByRole('button', { name: 'Load more' })).toHaveCount(0);
  expect(state.queueCalls.filter(call => call.cursor === 'page-2')).toHaveLength(1);
  expect(state.queueCalls.filter(call => call.path === '/summary')).toHaveLength(1);

  state.queueTasks = [];
  await queue.getByRole('button', { name: 'Refresh queue' }).click();
  await expect(queue).toContainText('No tasks match these filters.');

  state.queueFailures_ = 2;
  await queue.getByRole('button', { name: 'Refresh queue' }).click();
  await expect(queue.getByRole('alert')).toContainText('could not be loaded');
  state.queueTasks = [queueTask({})];
  await queue.getByRole('button', { name: 'Retry' }).click();
  await expect(queue.locator('.queue-items li')).toHaveCount(1);
  await expect(queue.getByRole('alert')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a slow answer to an old filter cannot replace the rows for the current one', async ({ page }) => {
  const { state, errors } = await setup(page, { canOverride: true });
  const queue = await showSeededQueue(page, state);
  await expect(queue.locator('.queue-items li')).toHaveCount(5);
  let release;
  state.queueGate = new Promise((resolve) => { release = resolve; });
  await queue.getByLabel('Status').selectOption('cancelled'); // this answer is held back
  await expect.poll(() => state.queueCalls.filter(call => call.status === 'cancelled').length).toBe(1);
  await queue.getByLabel('Status').selectOption('dispatched'); // this one answers at once
  await expect(queue.locator('.queue-items li')).toHaveCount(3);
  release();
  await page.waitForTimeout(300);
  await expect(queue.locator('.queue-items li')).toHaveCount(3);
  await expect(queue).not.toContainText('WP-05');
  expect(errors).toEqual([]);
});

test('opening a task from the queue shows its asset on the right form, ready to manage', async ({ page }) => {
  const { state, errors } = await setup(page, { canOverride: true });
  const queue = await showSeededQueue(page, state);
  state.assets.push({ id: '66666666-6666-4666-8666-666666666667', name: 'Pump', externalId: 'PU-07', assetType: 'pump', revision: 2, xmlFormId: 'nutrition' });
  state.assetTasks.push({ id: 'a3333333-3333-4333-8333-333333333333', predicate: 'condition', status: 'dispatched', dueAt: '2026-01-11T00:00:00Z' });
  await expect(page.locator('#review-form')).toHaveValue('health');
  await queue.locator('.queue-items li', { hasText: 'PU-07' }).getByRole('button', { name: 'Open asset' }).click();
  await expect(page.locator('#review-form')).toHaveValue('nutrition');
  const assets = page.getByRole('region', { name: 'Asset passports and re-verification' });
  await expect(assets.getByRole('heading', { name: 'Pump · PU-07' })).toBeVisible();
  await expect(assets.getByRole('button', { name: 'Manage' })).toBeVisible();
  // A later, manual change of form does not keep trying to open that asset.
  await page.locator('#review-form').selectOption('health');
  await expect(assets.getByRole('heading', { name: 'Pump · PU-07' })).toHaveCount(0);
  await expect(assets.getByRole('alert')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a queue answer in an unexpected shape shows a retryable error instead of breaking the page', async ({ page }) => {
  const { state, errors } = await setup(page, { canOverride: true });
  const queue = await showSeededQueue(page, state);
  await expect(queue.locator('.queue-items li')).toHaveCount(5);
  state.queueMalformed = true;
  await queue.getByRole('button', { name: 'Refresh queue' }).click();
  await expect(queue.getByRole('alert')).toContainText('could not be loaded');
  await expect(page.getByRole('heading', { name: 'Re-verification queue' })).toBeVisible();
  state.queueMalformed = false;
  await queue.getByRole('button', { name: 'Retry' }).click();
  await expect(queue.locator('.queue-items li')).toHaveCount(5);
  expect(errors).toEqual([]);
});

test('opening a task from the queue shows the current state even after an earlier dated-facts query', async ({ page }) => {
  const { state, errors } = await setup(page, { canOverride: true });
  const queue = await showSeededQueue(page, state);
  state.assets.push({ id: '55555555-5555-4555-8555-555555555555', name: 'Water point', externalId: 'WP-01', assetType: 'water-point', revision: 2 });
  state.assetTasks.push({ id: 'a2222222-2222-4222-8222-222222222222', predicate: 'condition', status: 'dispatched', dueAt: '2026-01-11T00:00:00Z' });
  const assets = page.getByRole('region', { name: 'Asset passports and re-verification' });
  await queue.locator('.queue-items li', { hasText: 'WP-01' }).getByRole('button', { name: 'Open asset' }).click();
  await expect(assets.getByRole('button', { name: 'Manage' })).toBeVisible();
  // Ask what was known at an earlier time: the server then shows only tasks that already existed.
  await assets.getByLabel('Known at (optional ISO date and time)').fill('2026-01-01T00:00:00Z');
  await assets.getByRole('button', { name: 'Query dated facts' }).click();
  await expect(assets.getByRole('button', { name: 'Manage' })).toHaveCount(0);
  // Navigating from the queue is a request for the present, not for that old view.
  await queue.locator('.queue-items li', { hasText: 'WP-02' }).getByRole('button', { name: 'Open asset' }).click();
  await expect(assets.getByRole('button', { name: 'Manage' })).toBeVisible();
  await expect(assets.getByLabel('Known at (optional ISO date and time)')).toHaveValue('');
  expect(errors).toEqual([]);
});

test('a request to open an asset while the panel is busy is carried out afterwards, not lost', async ({ page }) => {
  const { state, errors } = await setup(page, { canOverride: true });
  const queue = await showSeededQueue(page, state);
  state.assets.push({ id: '55555555-5555-4555-8555-555555555555', name: 'Water point', externalId: 'WP-01', assetType: 'water-point', revision: 2 },
    { id: '77777777-7777-4777-8777-777777777777', name: 'Borehole', externalId: 'BH-09', assetType: 'borehole', revision: 2 });
  state.queueTasks.push(queueTask({ id: 'a6666666-6666-4666-8666-666666666666', externalId: 'BH-09', assetName: 'Borehole',
    assetId: '77777777-7777-4777-8777-777777777777' }));
  await queue.getByRole('button', { name: 'Refresh queue' }).click();
  const assets = page.getByRole('region', { name: 'Asset passports and re-verification' });
  let release;
  state.assetGate = new Promise((resolve) => { release = resolve; });
  await queue.locator('.queue-items li', { hasText: 'WP-01' }).getByRole('button', { name: 'Open asset' }).click();
  await expect(assets.getByText('Loading or saving asset records…')).toBeVisible();
  // The panel is still loading the first asset when the second request arrives.
  await queue.locator('.queue-items li', { hasText: 'BH-09' }).getByRole('button', { name: 'Open asset' }).click();
  release();
  await expect(assets.getByRole('heading', { name: 'Borehole · BH-09' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('the collector filter offers collectors whose work is all closed or cancelled', async ({ page }) => {
  const { state, errors } = await setup(page, { canOverride: true });
  const queue = await showSeededQueue(page, state);
  await expect(queue.getByText('Retired collector —')).toHaveCount(0); // no open work, so not in the workload list
  await queue.getByLabel('Status').selectOption('cancelled');
  await queue.getByLabel('Collector').selectOption({ label: 'Retired collector' });
  await expect(queue.locator('.queue-items li')).toHaveCount(1);
  await expect(queue).toContainText('WP-05');
  expect(state.queueCalls.filter(call => call.path === '/').at(-1)).toMatchObject({ status: 'cancelled', assigneeId: '44' });
  expect(errors).toEqual([]);
});

const finding = (id, extra) => ({ id, xmlFormId: 'health', formName: 'Health survey', rule: 'implausible-travel', family: 'travel',
  ruleVersion: 1, instanceId: `uuid:${id}`, relatedInstanceId: null, outcome: 'concern', status: 'open', decision: null, note: null,
  decidedAt: null, decidedByName: null, createdAt: '2026-10-09T10:00:00Z', title: null, kind: null, ...extra });

test('findings inbox lists findings across forms, filters them and links to the Verification page', async ({ page }) => {
  const { state, errors } = await setup(page);
  state.findings.push(
    finding(1, { rule: 'contradiction:abc', family: 'contradiction', title: 'No electricity but a fridge' }),
    finding(2, { xmlFormId: 'nutrition', formName: 'Nutrition survey', rule: 'identity-reused:k1', family: 'identity', title: 'Household code', kind: 'reused', relatedInstanceId: 'uuid:first', status: 'investigating' }),
    finding(3, { rule: 'outside-project-area', family: 'location', status: 'resolved', decision: 'explained', note: 'Border village' })
  );
  const inbox = page.locator('.findings-inbox');
  await inbox.getByRole('button', { name: 'Refresh findings' }).click();
  await expect(inbox.locator('.counts')).toContainText('2 open');
  await expect(inbox.locator('.counts')).toContainText('1 contradictions · 1 identity');
  const items = inbox.locator('.findings-items li');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('Contradiction: No electricity but a fridge');
  await expect(items.nth(0)).toContainText('Worth a look · Not yet reviewed');
  await expect(items.nth(1)).toContainText('Repeated identity: Household code');
  await expect(items.nth(1)).toContainText('Nutrition survey');
  await expect(items.nth(1).getByRole('link', { name: 'Open on the Verification page' })).toHaveAttribute('href', '/projects/7/forms/nutrition/verification');
  await expect(items.nth(1).getByRole('link', { name: 'Related submission' })).toHaveAttribute('href', '/projects/7/forms/nutrition/submissions/uuid%3Afirst');

  await inbox.getByLabel('Show').selectOption('resolved');
  await expect(items).toHaveCount(1);
  await expect(items.nth(0)).toContainText('Outside the project area');
  await expect(items.nth(0)).toContainText('Reviewed · Explained — Border village');
  expect(state.findingsCalls.at(-2)).toMatchObject({ status: ['resolved'], outcome: ['concern', 'inconclusive', 'withdrawn'] });

  await inbox.getByLabel('Show').selectOption('open');
  await inbox.getByLabel('Check').selectOption('identity');
  await expect(items).toHaveCount(1);
  await inbox.getByLabel('Form').selectOption('health');
  await expect(inbox.getByText('No findings match these filters.')).toBeVisible();
  expect(errors).toEqual([]);
});

test('findings inbox pages, recovers from a failure, and fits a narrow screen', async ({ page }) => {
  const { state, errors } = await setup(page);
  state.findingsPaged = true;
  state.findings.push(finding(1), finding(2), finding(3));
  state.findingsFailures = 1;
  const inbox = page.locator('.findings-inbox');
  await inbox.getByRole('button', { name: 'Refresh findings' }).click();
  await expect(inbox.getByRole('alert')).toContainText('The findings could not be loaded');
  await inbox.getByRole('button', { name: 'Retry' }).click();
  await expect(inbox.locator('.findings-items li')).toHaveCount(2);
  await inbox.getByRole('button', { name: 'Load more' }).click();
  await expect(inbox.locator('.findings-items li')).toHaveCount(3);
  await expect(inbox.getByRole('button', { name: 'Load more' })).toHaveCount(0);
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= 360)).toBe(true);
  expect(errors).toEqual([]);
});

test('collector groups show who keeps matching whom, with links to the findings', async ({ page }) => {
  const { state, errors } = await setup(page);
  state.collectorGroups.push({
    members: [{ actorId: 42, displayName: 'Bockarie', links: 6 }, { actorId: 41, displayName: 'Aminata', links: 3 }, { actorId: 43, displayName: 'Christiana', links: 3 }],
    connections: [
      { a: 41, b: 42, links: 3, byRule: { 'near-duplicate': 2, identity: 1 } },
      { a: 42, b: 43, links: 3, byRule: { 'repeated-location': 3 } }
    ],
    forms: [{ xmlFormId: 'health', formName: 'Health survey' }],
    findings: [{ id: 1, xmlFormId: 'health', rule: 'identity-reused:k1', instanceId: 'uuid:copy', relatedInstanceId: 'uuid:orig', relatedXmlFormId: 'nutrition' }],
    findingsShown: 1, findingsTotal: 6
  });
  const section = page.locator('.collector-groups');
  await expect(section).toContainText('not a finding against anyone');
  await expect(section.locator('.collector-groups-empty')).toContainText('No collectors are linked by 3 or more findings');
  await section.getByRole('button', { name: 'Refresh' }).click();
  const group = section.locator('.collector-group');
  await expect(group).toHaveCount(1);
  await expect(group.locator('.collector-group-head')).toContainText('Bockarie, Aminata, Christiana · 6 linking findings · Health survey');
  await expect(group.locator('.collector-group-connections li').nth(0)).toContainText('Aminata and Bockarie: 3 (2 near-duplicate answers, 1 shared identity key)');
  await expect(group.locator('.collector-group-connections li').nth(1)).toContainText('Bockarie and Christiana: 3 (3 identical location)');
  await group.getByText('Findings (1 of 6)').click();
  const item = group.locator('.collector-group-findings li');
  await expect(item).toContainText('Shared identity key');
  await expect(item.getByRole('link', { name: 'uuid:copy' })).toHaveAttribute('href', '/projects/7/forms/health/submissions/uuid%3Acopy');
  await expect(item.getByRole('link', { name: 'uuid:orig' })).toHaveAttribute('href', '/projects/7/forms/nutrition/submissions/uuid%3Aorig');
  await expect(item.getByRole('link', { name: 'Verification' })).toHaveAttribute('href', '/projects/7/forms/health/verification');

  // A higher minimum leaves no group, and says so.
  await section.getByLabel('Connect collectors linked by at least').selectOption('4');
  await expect(section.locator('.collector-groups-empty')).toContainText('No collectors are linked by 4 or more findings');
  expect(state.collectorCalls.at(-1)).toBe(4);
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= 360)).toBe(true);
  expect(errors).toEqual([]);
});

test('the back-check request shows each collector\'s open work and preselects the least loaded', async ({ page }) => {
  const { state, errors } = await setup(page);
  state.workload = true;
  await page.getByRole('button', { name: 'Assign to me' }).click();
  await page.getByRole('button', { name: 'In review', exact: true }).click();
  await openInspection(page);
  const select = page.getByLabel('App User', { exact: true });
  await expect(select.locator('option:checked')).toHaveText('Replacement collector — 0 open (suggested)');
  await expect(select.locator('option[value="42"]')).toHaveText('Second collector — 2 open, 1 overdue');
  await expect(select.locator('option[value="41"]')).toHaveText('First collector (collected this submission)');
  await expect(select.locator('option[value="41"]')).toBeDisabled();
  await expect(page.getByText('Suggested: the collector with the fewest open back-checks. You can choose another.')).toBeVisible();
  // Another form has other collectors: its own suggestion is preselected.
  await page.getByLabel('Back-check form', { exact: true }).selectOption('verification');
  await expect(select.locator('option:checked')).toHaveText('Second collector — 2 open, 1 overdue (suggested)');
  await page.getByLabel('Back-check form', { exact: true }).selectOption('health');
  await page.getByLabel('What should they verify?').fill('Verify the visit independently.');
  await page.getByRole('button', { name: 'Request back-check', exact: true }).click();
  await expect.poll(() => state.backchecks.length).toBe(1);
  expect(state.backchecks[0].assignedTo).toBe(43);
  expect(errors).toEqual([]);
});

test('searching the project records shows each kind with its citation', async ({ page }) => {
  const { state, errors } = await setup(page, { canOverride: true });
  const assetId = '55555555-5555-4555-8555-555555555555';
  state.assets.push({ id: assetId, name: 'Kissy water point', externalId: 'WP-01', assetType: 'water-point', revision: 2 });
  state.assetTasks.push({ id: 'a2222222-2222-4222-8222-222222222222', predicate: 'condition', status: 'dispatched', dueAt: '2026-01-11T00:00:00Z' });
  const section = page.getByRole('region', { name: "Search the project's records" });
  await expect(section).toContainText('Submission answers are not searched');

  // Nothing found, then a failure, each said plainly.
  await section.getByLabel('Search for').fill('  nowhere ');
  await section.getByRole('button', { name: 'Search' }).click();
  await expect(section.locator('.project-search-empty')).toHaveText("Nothing in this project's records matches “nowhere”.");
  expect(state.searchCalls).toEqual(['nowhere']);
  state.searchFailures = 1;
  await section.getByRole('button', { name: 'Search' }).click();
  await expect(section.getByRole('alert')).toHaveText('The search could not be completed. Try again.');
  await expect(section.locator('.project-search-empty')).toHaveCount(0);

  state.search = {
    assets: [{ id: assetId, name: 'Kissy water point', externalId: 'WP-01', assetType: 'water-point',
      match: { field: 'name', excerpt: 'Kissy water point' }, source: { xmlFormId: 'health' } }],
    facts: [{ id: 'f1', assetId, assetName: 'Kissy water point', assetXmlFormId: 'health', predicate: 'condition', state: 'known', value: 'broken at Kissy',
      match: { field: 'value', excerpt: 'broken at Kissy' }, source: { xmlFormId: 'nutrition', instanceId: 'uuid:fact', claimVersionId: 'c1' } }],
    findings: [{ id: 9, rule: 'near-duplicate', title: 'Same household at Kissy', outcome: 'inconclusive', status: 'open',
      match: { field: 'title', excerpt: 'Same household at Kissy' }, source: { xmlFormId: 'health', instanceId: 'uuid:a', relatedInstanceId: 'uuid:b' } }],
    decisions: [{ id: 'd1', caseId: 'c', outcome: 'needs-evidence', reasonCode: 'provenance-degraded',
      match: { field: 'note', excerpt: '…shared phone at Kissy market…' }, source: { xmlFormId: 'health', instanceId: 'uuid:dec', claimVersionId: 'c2' } }]
  };
  state.searchMore = { findings: 3 };
  await section.getByLabel('Search for').fill('kissy');
  await section.getByRole('button', { name: 'Search' }).click();
  await expect(section.getByRole('alert')).toHaveCount(0);
  await expect(section.locator('.project-search-assets h3')).toHaveText('Assets (1)');
  await expect(section.locator('.project-search-assets li')).toContainText('Kissy water point · water-point · WP-01');
  const fact = section.locator('.project-search-facts li');
  await expect(fact).toContainText('Kissy water point: condition broken at Kissy');
  await expect(fact).toContainText('Matched in value: “broken at Kissy”');
  await expect(fact.getByRole('link', { name: 'uuid:fact' })).toHaveAttribute('href', '/projects/7/forms/nutrition/submissions/uuid%3Afact');
  const finding = section.locator('.project-search-findings');
  await expect(finding.locator('h3')).toHaveText('Findings (4)');
  await expect(finding.getByRole('link', { name: 'uuid:b' })).toHaveAttribute('href', '/projects/7/forms/health/submissions/uuid%3Ab');
  await expect(finding.getByRole('link', { name: 'Verification' })).toHaveAttribute('href', '/projects/7/forms/health/verification');
  await expect(finding.locator('.project-search-more')).toHaveText('3 more not shown, newest first. Add words to narrow the search.');
  const decision = section.locator('.project-search-decisions li');
  await expect(decision).toContainText('needs-evidence · provenance-degraded');
  await expect(decision).toContainText('Matched in note: “…shared phone at Kissy market…”');
  await expect(decision.getByRole('link', { name: 'uuid:dec' })).toHaveAttribute('href', '/projects/7/forms/health/submissions/uuid%3Adec');

  // Opening the asset from a fact shows it in the asset panel.
  await fact.getByRole('button', { name: 'Open asset' }).click();
  const assets = page.getByRole('region', { name: 'Asset passports and re-verification' });
  await expect(assets.getByRole('button', { name: 'Manage' })).toBeVisible();

  // Too short a query is not sent.
  await section.getByLabel('Search for').fill(' k ');
  await section.getByRole('button', { name: 'Search' }).click();
  await expect(section.getByRole('alert')).toHaveText('Enter 2 to 100 characters to search for.');
  expect(state.searchCalls).toEqual(['nowhere', 'nowhere', 'kissy']);
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= 360)).toBe(true);
  expect(errors).toEqual([]);
});

test('asset status shows one fact for every asset, counting only current values', async ({ page }) => {
  const { state, errors } = await setup(page, { canOverride: true });
  const assetId = '55555555-5555-4555-8555-555555555555';
  state.assets.push({ id: assetId, name: 'Kissy water point', externalId: 'WP-01', assetType: 'water-point', revision: 2 });
  state.assetTasks.push({ id: 'a2222222-2222-4222-8222-222222222222', predicate: 'condition', status: 'dispatched', dueAt: '2026-01-11T00:00:00Z' });
  const fresh = { status: 'fresh', dueAt: '2026-12-01T00:00:00Z', expiresAt: '2026-12-11T00:00:00Z' };
  state.projection = {
    predicates: ['condition', 'depth'],
    assets: [
      { id: assetId, name: 'Kissy water point', externalId: 'WP-01', assetType: 'water-point', xmlFormId: 'health',
        fact: { value: 'broken', state: 'known', validFrom: '2026-09-01T00:00:00.000Z', freshness: fresh } },
      { id: 'b1', name: 'Lumley school', externalId: 'SC-02', assetType: 'school', xmlFormId: 'health',
        fact: { value: 'operating', state: 'known', validFrom: '2026-01-01T00:00:00.000Z', freshness: { ...fresh, status: 'expired' } } },
      { id: 'b2', name: 'Wellington pump', externalId: 'WP-03', assetType: 'water-point', xmlFormId: 'health', fact: null }
    ],
    summary: { byValue: [{ value: 'broken', count: 1 }], byStatus: { fresh: 1, 'review-due': 0, expired: 1, unknown: 0, 'source-unverified': 0, 'not-yet-valid': 0, none: 1 } },
    excluded: { notReadable: 0, sourceDeleted: 2 },
    truncated: false
  };
  state.projectionCalls = [];
  await page.reload();
  const section = page.getByRole('region', { name: 'Asset status across the project' });
  await expect(section.locator('.asset-status-summary')).toHaveText('Current: 1 broken. Also: 1 expired, 1 with no fact.');
  await expect(section.locator('.asset-status-excluded')).toHaveText('Not shown: 2 resting on a deleted Submission.');
  expect(state.projectionCalls).toEqual(['', '?predicate=condition']);
  const rows = section.locator('tbody tr');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('broken');
  await expect(rows.nth(0)).toContainText('Fresh');
  await expect(rows.nth(0)).toContainText('2026-09-01');
  await expect(rows.nth(1)).toContainText('Expired');
  await expect(rows.nth(2)).toContainText('No fact');

  // Filters go to the server; "as of" is the end of that day.
  await section.getByLabel('Asset type (optional)').fill('water-point');
  await section.getByLabel('As of (optional)').fill('2026-10-01');
  await section.getByRole('button', { name: 'Show' }).click();
  await expect(rows).toHaveCount(2);
  expect(state.projectionCalls.at(-1)).toBe('?predicate=condition&assetType=water-point&at=2026-10-01T23%3A59%3A59Z');

  // A failure says so and keeps the form.
  state.projectionFailures = 1;
  await section.getByRole('button', { name: 'Show' }).click();
  await expect(section.getByRole('alert')).toHaveText('Asset status could not be loaded. Try again.');
  await expect(section.locator('table')).toHaveCount(0);
  await section.getByRole('button', { name: 'Show' }).click();
  await expect(section.getByRole('alert')).toHaveCount(0);

  await rows.nth(0).getByRole('button', { name: 'Open asset' }).click();
  const assets = page.getByRole('region', { name: 'Asset passports and re-verification' });
  await expect(assets.getByRole('button', { name: 'Manage' })).toBeVisible();
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= 360)).toBe(true);
  expect(errors).toEqual([]);
});

test('asset status says when no asset has a recorded fact', async ({ page }) => {
  const { state, errors } = await setup(page);
  const section = page.getByRole('region', { name: 'Asset status across the project' });
  await expect(section.locator('.asset-status-empty')).toHaveText('No asset in this project has a recorded fact yet.');
  await expect(section.locator('form')).toHaveCount(0);
  expect(state.projectionCalls).toEqual(['']);
  expect(errors).toEqual([]);
});
