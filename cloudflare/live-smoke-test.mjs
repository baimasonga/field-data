import assert from 'node:assert/strict';

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
};

const baseUrl = new URL(required('LIVE_BASE_URL'));
if (baseUrl.protocol !== 'https:' && process.env.LIVE_ALLOW_HTTP !== 'true') {
  throw new Error('LIVE_BASE_URL must use HTTPS.');
}
baseUrl.pathname = baseUrl.pathname.replace(/\/$/, '');

const email = required('LIVE_SMOKE_EMAIL');
const password = required('LIVE_SMOKE_PASSWORD');
const runBackup = process.env.LIVE_TEST_BACKUP === 'true';
const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const call = async (path, options = {}) => {
  const response = await fetch(new URL(path, baseUrl), {
    redirect: 'error',
    signal: AbortSignal.timeout(options.timeout || 30000),
    ...options
  });
  return response;
};

const expectStatus = async (response, expected, label) => {
  if (!expected.includes(response.status)) {
    const detail = (await response.text()).slice(0, 1000);
    throw new Error(`${label} returned HTTP ${response.status}: ${detail}`);
  }
  return response;
};

let token;
let mediaId;
try {
  const health = await expectStatus(await call('/healthz'), [200], 'Container health');
  assert.match(await health.text(), /^ok\s*$/i);

  const home = await expectStatus(await call('/'), [200], 'Frontend');
  assert.match(home.headers.get('content-type') || '', /text\/html/i);

  const login = await expectStatus(await call('/v1/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  }), [200], 'Login');
  token = (await login.json()).token;
  assert.equal(typeof token, 'string', 'Login response did not include a token.');
  const auth = { Authorization: `Bearer ${token}` };

  const statsResponse = await expectStatus(await call('/v1/field-data/stats', { headers: auth }),
    [200], 'Field Data dashboard');
  const stats = await statsResponse.json();
  assert.equal(stats.systemStatus?.database, true, 'Live PostgreSQL probe failed.');
  assert.equal(stats.systemStatus?.fileStorage, true, 'Live Supabase Storage probe failed.');

  const fixture = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cfc000000301010018dd8db10000000049454e44ae426082', 'hex');
  const form = new FormData();
  form.append('file', new Blob([fixture], { type: 'image/png' }), `live-smoke-${Date.now()}.png`);
  const upload = await expectStatus(await call('/v1/field-data/media', {
    method: 'POST', headers: auth, body: form, timeout: 60000
  }), [200, 201], 'Media upload');
  const media = await upload.json();
  mediaId = media.id;
  assert.ok(mediaId, 'Media upload did not return an id.');

  const download = await expectStatus(await call(`/v1/field-data/media/download/${mediaId}`, {
    headers: auth, timeout: 60000
  }), [200], 'Media download');
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), fixture, 'Downloaded media did not match upload.');

  if (runBackup) {
    const queued = await expectStatus(await call('/v1/field-data/backups', {
      method: 'POST', headers: auth, timeout: 60000
    }), [202], 'Backup queue');
    const job = await queued.json();
    const deadline = Date.now() + 20 * 60 * 1000;
    let backup;
    while (Date.now() < deadline) {
      const list = await expectStatus(await call('/v1/field-data/backups', { headers: auth }),
        [200], 'Backup status');
      backup = (await list.json()).find(item => item.id === job.id);
      if (backup?.status === 'Success' || backup?.status === 'Failed') break;
      await pause(15000);
    }
    assert.equal(backup?.status, 'Success', `Backup did not succeed: ${backup?.error || 'timeout'}`);
    const archive = await expectStatus(await call(`/v1/field-data/backups/${job.id}/download`, {
      headers: auth, timeout: 120000
    }), [200], 'Backup download');
    assert.ok((await archive.arrayBuffer()).byteLength > 0, 'Downloaded backup was empty.');
  }

  console.log(JSON.stringify({
    ok: true,
    database: stats.systemStatus.database,
    storage: stats.systemStatus.fileStorage,
    mediaRoundTrip: true,
    backup: runBackup ? 'success' : 'skipped'
  }));
} finally {
  if (token && mediaId) {
    const response = await call(`/v1/field-data/media/${mediaId}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) console.error(`Warning: failed to remove smoke-test media ${mediaId}.`);
  }
  if (token) {
    await call('/v1/sessions/current', {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` }
    }).catch(() => {});
  }
}
