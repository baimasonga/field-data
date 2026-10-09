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
  const state = { comparisonFailures: failComparison ? 1 : 0, comparisonRequests: 0, staleWrites: 0, conflictFailures: staleAssignment ? 1 : 0, status: 'open', assignedTo: null, revision: 1, backchecks: [], decisions: [], mutations: [], queueRequests: [], queueFailures: failQueue ? 1 : 0, assignmentFailures: failAssignment ? 1 : 0, metricsFailures: failMetrics ? 2 : 0 };
  await page.addInitScript(() => localStorage.setItem('sessionExpires', String(Date.now() + 3600000)));
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
    if (path === '/v1/field-data/review-queue') {
      state.queueRequests.push(Object.fromEntries(url.searchParams));
      if (state.queueFailures-- > 0) return route.fulfill({ status: 503, json: { message: 'Unavailable' } });
      if (delayOpen && url.searchParams.get('status') === 'open') await openWait;
      const matches = url.searchParams.get('projectId') === '7' && url.searchParams.get('xmlFormId') === 'health' && url.searchParams.get('status') === state.status;
      return respond({ items: matches ? [{ id: caseId, claimVersionId: versionId, revision: state.revision, status: state.status, priority: 'normal', reasonCodes: ['missing-evidence', 'provenance-degraded'], assignedTo: state.assignedTo, claim: { ordinal: 1, current: true, rootInstanceId: 'uuid:original' }, etag: etag(state.revision) }] : [], nextCursor: null });
    }
    if (path === `/v1/field-data/claim-versions/${versionId}/evidence`) return respond({ items: [{ id: 'evidence-1', sourceKind: 'submission-xml', integrityStatus: 'verified', downloadUrl: '/v1/field-data/evidence/evidence-1/content' }], nextCursor: null });
    if (path === `/v1/field-data/review-queue/${caseId}`) return respond({ claim: { id: versionId, provenance: { origin: 'collected', capturedAt: '2026-10-03T09:00:00Z', receivedAt: '2026-10-03T10:00:00Z', integrityHash: 'abcdef', degraded: null }, degraded: null }, decisions: state.decisions, reversalRequired: state.decisions.some(d => ['accepted', 'rejected'].includes(d.outcome)), overridePolicy: { allowed: canOverride, reasonCodes: canOverride ? ['verified-by-supervisor'] : [] } });
    if (path.endsWith('/comparison')) {
      state.comparisonRequests += 1;
      if (state.comparisonFailures-- > 0) return route.fulfill({ status: 503, json: { message: 'Unavailable' } });
      const source = { instanceId: 'original-version', current: true, formVersion: '1',
        provenance: { origin: 'collected', capturedAt: null, degraded: { capturedAt: 'unknown' } },
        integrityStatus: 'verified', xmlDownloadUrl: '/v1/original-version.xml' };
      return respond({ original: source, backcheck: { ...source, instanceId: 'linked-version', current: false,
        xmlDownloadUrl: '/v1/linked-version.xml' },
      ...(comparisonUnavailable ? { unavailableReason: 'source-integrity' } : {
        summary: { same: 0, changed: 1, missingOriginal: 1, missingBackcheck: 1 },
        rows: [{ path: '/name[1]', original: '<img src=x onerror=alert(1)>', backcheck: 'Corrected', status: 'changed' },
          { path: '/age[1]', original: null, backcheck: '', status: 'missingOriginal' },
          { path: '/note[1]', original: 'Observed', backcheck: null, status: 'missingBackcheck' }] }) });
    }
    if (path.endsWith('/backcheck-assignees')) return respond([{ id: 42, name: 'Second collector' }, { id: 43, name: 'Replacement collector' }]);
    if (req.method() === 'GET' && path.endsWith('/backchecks')) return respond(state.backchecks);
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
        state.backchecks.push({ id: state.backchecks.length === 0 ? backcheckId : '44444444-4444-4444-8444-444444444444', status: 'requested', assignedTo: data.assignedTo, assigneeName: data.assignedTo === 43 ? 'Replacement collector' : 'Second collector', question: data.question });
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
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= 320)).toBe(true);
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
