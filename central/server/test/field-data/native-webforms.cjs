const { test } = require('node:test');
const assert = require('node:assert/strict');

const Forms = require('../../lib/model/query/forms');

test('native Web Forms provisions draft link ids without Enketo', async () => {
  const id = await Forms.pushDraftToEnketo({ projectId: 1, xmlFormId: 'fixture' })({});
  assert.match(id, /^wd[0-9a-f]{32}$/);
});

test('native Web Forms provisions published and once-only link ids', async () => {
  const ids = await Forms.pushFormToEnketo({ projectId: 1, xmlFormId: 'fixture' })({});
  assert.match(ids.enketoId, /^wf[0-9a-f]{32}$/);
  assert.match(ids.enketoOnceId, /^wo[0-9a-f]{32}$/);
  assert.notEqual(ids.enketoId, ids.enketoOnceId);
});
