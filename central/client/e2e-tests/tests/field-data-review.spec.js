import { expect, test } from '@playwright/test';

const appUrl = process.env.ODK_URL || 'http://127.0.0.1:8989';
const caseId = '11111111-1111-4111-8111-111111111111';
const versionId = '22222222-2222-4222-8222-222222222222';
const backcheckId = '33333333-3333-4333-8333-333333333333';
const etag = revision => `"review-case-${revision}"`;

const setup = async (page, { readOnly = false, noProjects = false, failQueue = false, failAssignment = false, manageQuality = false, delayOpen = false } = {}) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let releaseOpen;
  const openWait = delayOpen ? new Promise(resolve => { releaseOpen = resolve; }) : null;
  const state = { status: 'open', assignedTo: null, revision: 1, backchecks: [], decisions: [], mutations: [], queueRequests: [], queueFailures: failQueue ? 1 : 0, assignmentFailures: failAssignment ? 1 : 0 };
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
    if (path === '/v1/field-data/review-queue') {
      state.queueRequests.push(Object.fromEntries(url.searchParams));
      if (state.queueFailures-- > 0) return route.fulfill({ status: 503, json: { message: 'Unavailable' } });
      if (delayOpen && url.searchParams.get('status') === 'open') await openWait;
      const matches = url.searchParams.get('projectId') === '7' && url.searchParams.get('xmlFormId') === 'health' && url.searchParams.get('status') === state.status;
      return respond({ items: matches ? [{ id: caseId, claimVersionId: versionId, revision: state.revision, status: state.status, priority: 'normal', reasonCodes: ['missing-evidence', 'provenance-degraded'], assignedTo: state.assignedTo, claim: { ordinal: 1, current: true, rootInstanceId: 'uuid:original' }, etag: etag(state.revision) }] : [], nextCursor: null });
    }
    if (path === `/v1/field-data/claim-versions/${versionId}/evidence`) return respond({ items: [{ id: 'evidence-1', sourceKind: 'submission-xml', integrityStatus: 'verified', downloadUrl: '/v1/field-data/evidence/evidence-1/content' }], nextCursor: null });
    if (path === `/v1/field-data/review-queue/${caseId}`) return respond({ claim: { id: versionId, provenance: { origin: 'collected', capturedAt: '2026-10-03T09:00:00Z', receivedAt: '2026-10-03T10:00:00Z', integrityHash: 'abcdef', degraded: null }, degraded: null }, decisions: state.decisions });
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
        expect(data.override).toBe(false);
        state.decisions.push({ id: 'decision-1', outcome: data.outcome, reasonCode: data.reasonCode, note: data.note, reviewerId: 1, createdAt: '2026-10-03T11:00:00Z' });
        state.status = data.outcome === 'needs-evidence' ? 'open' : 'resolved';
      } else throw new Error(`Unexpected mutation: ${path}`);
      state.revision += 1;
      return respond({ revision: state.revision }, state.revision);
    }
    return respond([]);
  });
  await page.goto(`${appUrl}/field-data/review`);
  await expect(page.getByRole('heading', { name: 'Review Queue', exact: true })).toBeVisible();
  return { state, errors, releaseOpen };
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
  await expect(page.getByText('Cancellation reason: Collector is unavailable.')).toBeVisible();
  await expect(page.getByLabel('Synced back-check submission ID')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Request back-check', exact: true })).toBeVisible();
  await page.getByLabel('App User', { exact: true }).selectOption('43');
  await page.getByLabel('What should they verify?').fill('Arrange a replacement visit.');
  await page.getByRole('button', { name: 'Request back-check', exact: true }).click();
  await expect.poll(() => state.backchecks.length).toBe(2);
  expect(state.backchecks.map(backcheck => backcheck.assignedTo)).toEqual([42, 43]);
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
