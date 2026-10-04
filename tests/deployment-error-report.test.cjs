const { test } = require('node:test');
const assert = require('node:assert/strict');
const { summarize } = require('../tools/deployment-error-report.cjs');

test('deployment annotations retain Cloudflare errors and redact configured secrets', () => {
  const message = summarize('Build complete\n\u001b[31m[ERROR]\u001b[0m API request failed [code: 10215]\nToken synthetic-token account synthetic-account\nPassword synthetic/password\n::notice::untrusted 50%', { CLOUDFLARE_API_TOKEN: 'synthetic-token', CLOUDFLARE_ACCOUNT_ID: 'synthetic-account', PGPASSWORD: 'synthetic/password' });
  assert.match(message, /code: 10215/);
  assert.doesNotMatch(message, /synthetic|\x1b|\n/);
  assert.match(message, /%0A::notice::untrusted 50%25/);
});

test('unclassified failures provide a useful generic annotation', () => {
  assert.match(summarize('Build aborted'), /See the deployment step logs/);
});
