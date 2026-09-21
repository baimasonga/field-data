const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { Readable } = require('node:stream');
const dns = require('node:dns').promises;
const http = require('node:http');
const crypto = require('node:crypto');
process.env.NODE_ENV = 'test';
process.env.FIELD_DATA_STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'field-data-test-'));
// A fixed throwaway key so the secret round-trip can be exercised here. Not a
// credential: it never leaves this process and encrypts only test fixtures.
process.env.FIELD_DATA_WEBHOOK_ENCRYPTION_KEY =
  process.env.FIELD_DATA_WEBHOOK_ENCRYPTION_KEY ?? '0'.repeat(64);
const { isBlockedAddress, resolveWebhookUrl } = require('../../lib/util/safe-webhook-url');
const { deliver, _googleSheetPayload, _findSheetRow, _appendWithVerification } =
  require('../../lib/worker/webhooks');
const { BATCH_SIZE: SHEET_SYNC_BATCH_SIZE } =
  require('../../lib/worker/field-data-google-sheets');

test('historical Sheet synchronization is bounded to a small resumable batch', () => {
  assert.ok(SHEET_SYNC_BATCH_SIZE > 0 && SHEET_SYNC_BATCH_SIZE <= 25);
  const migration = fs.readFileSync(path.join(__dirname,
    '../../lib/model/migrations/20260920-07-add-google-sheet-sync-jobs.js'), 'utf8');
  assert.match(migration, /UNIQUE \("syncId", "submissionId"\)/);
  assert.match(migration, /WHERE status IN \('Pending', 'Running'\)/);
});

test('XLS reports have one source, one active run, and bounded output', () => {
  const migration = fs.readFileSync(path.join(__dirname,
    '../../lib/model/migrations/20260920-08-add-xls-reports.js'), 'utf8');
  assert.match(migration,
    /num_nonnulls\("formId", "filteredDatasetId", "mergedDatasetId"\) = 1/);
  assert.match(migration, /WHERE status IN \('Pending', 'Running'\)/);

  const reports = require('../../lib/util/xls-reports');
  assert.ok(reports.MAX_TEMPLATE_BYTES <= 10 * 1024 * 1024);
  assert.ok(reports.MAX_REPORT_ROWS > 0 && reports.MAX_REPORT_ROWS <= 10000);

  const resource = fs.readFileSync(path.join(__dirname,
    '../../lib/resources/field-data.js'), 'utf8');
  assert.match(resource,
    /const reportProject[\s\S]*?'project\.read'[\s\S]*?'submission\.list'[\s\S]*?'submission\.read'/);
  assert.match(resource, /if \(write\) await auth\.canOrReject\('project\.update'/);
});

test('rejects private addresses in dotted, compressed and expanded mapped IPv6', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '::1', '::ffff:127.0.0.1',
    '::ffff:7f00:1', '0:0:0:0:0:ffff:0a00:0001', '::ffff:a9fe:a9fe']) {
    assert.equal(isBlockedAddress(ip), true, ip);
  }
  assert.equal(isBlockedAddress('2606:4700:4700::1111'), false);
  assert.equal(isBlockedAddress('::ffff:808:808'), false);
  await assert.rejects(resolveWebhookUrl('http://[::ffff:127.0.0.1]/'), /private/);
});

test('delivers through a DNS hostname on Node 24 with a pinned address', async () => {
  const previous = dns.lookup;
  const previousAgent = http.globalAgent;
  http.globalAgent = new http.Agent({ proxyEnv: {} });
  dns.lookup = async () => [{ address: '127.0.0.1', family: 4 }];
  let body;
  const server = http.createServer((req, res) => {
    body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => { res.end('ok'); });
  });
  await new Promise(resolve => { server.listen(0, '127.0.0.1', resolve); });
  try {
    const result = await deliver(`http://webhook.test:${server.address().port}/`, Buffer.from('payload'), {});
    assert.equal(result.success, true, JSON.stringify(result));
    assert.equal(body, 'payload');
  } finally {
    dns.lookup = previous;
    http.globalAgent.destroy();
    http.globalAgent = previousAgent;
    await new Promise(resolve => { server.close(resolve); });
  }
});

const supabaseStore = fetch => {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../lib/external/field-data-storage.js'), 'utf8'), {
    require: name => (name === 'config' ? { has: () => false } : require(name)), module,
    Buffer, URL, AbortController, AbortSignal, fetch,
    process: { env: {
      SUPABASE_S3_ENDPOINT: 'https://storage.test/storage/v1/s3', SUPABASE_REGION: 'test',
      SUPABASE_STORAGE_BUCKET: 'test', SUPABASE_S3_ACCESS_KEY_ID: 'fixture',
      SUPABASE_S3_SECRET_ACCESS_KEY: 'fixture', FIELD_DATA_STORAGE_MODE: 'object'
    } }
  });
  return module.exports.storage;
};

test('Supabase upload rejects a source failure instead of hanging', { timeout: 2000 }, async () => {
  const store = supabaseStore(async (_, options) => {
    for await (const chunk of options.body) { assert.ok(chunk); }
    return { ok: true };
  });
  const source = new Readable({ read() { this.destroy(new Error('dump failed')); } });
  await assert.rejects(store.putStream('backup', source), /dump failed/);
  assert.equal(source.destroyed, true);
});

test('Supabase upload cancels the producer after a remote rejection', async () => {
  const store = supabaseStore(async () => ({ ok: false, status: 403, text: async () => 'denied' }));
  const source = new Readable({ read() { this.push(Buffer.alloc(8192)); } });
  await assert.rejects(store.putStream('backup', source), /403/);
  assert.equal(source.destroyed, true);
});

const routes = new Map();
const service = Object.fromEntries(['get', 'post', 'put', 'patch', 'delete'].map(method => [method,
  (url, ...handlers) => routes.set(`${method} ${url}`, handlers.at(-1))]));
require('../../lib/resources/field-data')(service, handler => handler);

test('dashboard submission queries exclude projects without both read and list permissions', async () => {
  const submissionQueries = [];
  const projects = [{ id: 1, acteeId: 'one' }, { id: 2, acteeId: 'two' }];
  const result = await routes.get('get /field-data/stats')({
    Projects: { getAllByAuth: async () => projects },
    db: {
      oneFirst: async query => {
        if (query.sql.includes('from submissions')) submissionQueries.push(query);
        return 0;
      },
      any: async query => { submissionQueries.push(query); return []; }
    }
  }, { auth: { can: async (verb, project) => verb.startsWith('submission.') && project.id === 2 } });
  assert.equal(result.kpi.submissions, 0);
  assert.equal(submissionQueries.length, 4);
  for (const query of submissionQueries) assert.deepEqual(query.values.find(Array.isArray), [2]);
  assert.equal(submissionQueries.some(query => query.sql.includes('forms.name')), false);
  assert.equal(submissionQueries.filter(query => query.sql.includes('form_defs.name')).length, 2);
  assert.equal(submissionQueries.filter(query =>
    query.sql.includes('form_defs.id = forms."currentDefId"')).length, 2);
});

// Three separate 500s shipped because a query named a column that the schema
// does not have, and none of them could fail until a real database saw them.
// A source scan is crude, but it catches the whole class in the one file where
// this project writes raw SQL, and it costs nothing to run.
/*
Every file where Field Data writes raw SQL, found rather than listed.

Three of these scans existed as a hand-kept list of two files, and two more
files with raw SQL arrived without being added to it -- which is the same way
the mistakes below arrived in the first place. A Field Data file is one
carrying this project's copyright header, so a new one is covered the day it
is written.

Upstream ODK files are deliberately out of scope: they alias tables by other
conventions, and `f.name` is perfectly correct where `f` is a form_defs.
*/
const fieldDataSqlFiles = () => {
  const root = path.join(__dirname, '..', '..', 'lib');
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.js')) continue;
      const text = fs.readFileSync(full, 'utf8');
      if (!text.includes('Field Data Developers')) continue;
      if (!/\bsql`/.test(text)) continue;
      found.push({
        file: path.relative(path.join(__dirname, '..', '..'), full),
        // Comments here explain these very mistakes, so strip both comment
        // styles before scanning or the explanation trips the test.
        source: text.split('\n').filter(line => !/^\s*(\/\/|--)/.test(line)).join('\n')
      });
    }
  };
  walk(root);
  return found;
};

test('the schema scan looks at every Field Data file that writes SQL', () => {
  const files = fieldDataSqlFiles().map(entry => entry.file);
  // A discovery that quietly finds nothing would make every scan below pass
  // without reading a line, so it has to prove it found the known ones.
  for (const expected of [
    'lib/resources/field-data.js',
    'lib/worker/webhooks.js',
    'lib/worker/field-data-google-sheets.js',
    'lib/util/xls-report-data.js',
    'lib/util/filtered-datasets.js'
  ]) assert.ok(files.includes(expected), `${expected} missing from ${files.join(', ')}`);
  assert.ok(files.length >= 5);
});

test('field-data queries do not name columns the schema dropped or never had', () => {
  for (const { file, source } of fieldDataSqlFiles()) {
    // forms.name was dropped in migration 20210423-02. A form's title lives on
    // its current definition, so these have to go through form_defs.
    const formsName = source.match(/\b(?:forms|f)\.name\b/g) || [];
    assert.deepEqual(formsName, [], `${file}: forms has no name column (${formsName.join(', ')})`);

    // submissions has no currentDefId. The current version of a submission is
    // the submission_defs row flagged current.
    const submissionDef = source.match(/\bs\."currentDefId"/g) || [];
    assert.deepEqual(submissionDef, [],
      `${file}: submissions has no currentDefId; join submission_defs on current = true`);

    const formFieldDef = source.match(/\bff\."formDefId"/g) || [];
    assert.deepEqual(formFieldDef, [],
      `${file}: form_fields has schemaId, not formDefId; join through form_defs.schemaId`);
  }
});

// The same family, one table over, and the fourth bug of this shape here: an
// id from one table bound to another table's id column. form_defs and
// submission_defs have independent sequences, so the comparison matches only
// where the numbers coincide -- which they do early in a fresh deployment,
// long enough to look like it works.
test('field-data queries do not bind one table id to another table id column', () => {
  for (const { file, source } of fieldDataSqlFiles()) {
    // A submission version's id reaches form_defs through
    // submission_defs."formDefId", never by being compared to form_defs.id.
    const direct = source.match(/form_defs\s+\w+\s+on\s+\w+\.id\s*=\s*\$\{\s*submission\w*/gi) || [];
    assert.deepEqual(direct, [],
      `${file}: a submission_defs id is not a form_defs id; join through submission_defs."formDefId" (${direct.join(', ')})`);

    // And the mirror of it: a form def id standing in for a submission version.
    const mirror = source.match(/submission_defs\s+\w+\s+on\s+\w+\.id\s*=\s*\$\{\s*(?:form|current)\w*Def/gi) || [];
    assert.deepEqual(mirror, [],
      `${file}: a form_defs id is not a submission_defs id (${mirror.join(', ')})`);
  }
});

test('filtered dataset readers receive only declared columns without source-form access', async () => {
  const project = { id: 9 };
  const option = value => ({ isDefined: () => true, get: () => value });
  const permissions = [];
  const result = await routes.get('get /projects/:projectId/filtered-datasets/:id/data')({
    Projects: { getById: async () => option(project) },
    Forms: { getByProjectAndXmlFormId: async () => assert.fail('must not check source form') },
    // container.maybeOne returns an Option; container.db.maybeOne returns a row.
    maybeOne: async () => option({
      id: 3, projectId: 9, formId: 7, currentDefId: 12,
      columns: ['/data/district'],
      query: [{ column: '/data/name', filter: '<>', value: '', condition: 'AND' }]
    }),
    db: {
      any: async query => (query.sql.includes('from form_fields')
        ? [
          { path: '/data/district', name: 'district', type: 'string', binary: false, order: 1 },
          { path: '/data/name', name: 'name', type: 'string', binary: false, order: 2 }
        ]
        : [{ data: { '/data/district': 'Bombali' } }]),
      one: async () => ({ total: 1, valid: 1 }),
      oneFirst: async () => 1
    }
  }, {
    params: { projectId: '9', id: '3' }, query: { limit: '10', offset: '0' },
    auth: { canOrReject: async (verb, target) => permissions.push([verb, target]) }
  });
  assert.deepEqual(permissions.map(([verb]) => verb), [
    'project.read', 'submission.list', 'submission.read'
  ]);
  assert.deepEqual(result.columns, ['/data/district']);
  assert.deepEqual(Object.keys(result.data[0]), ['/data/district']);
  assert.equal('/data/name' in result.data[0], false);

  permissions.length = 0;
  const definition = await routes.get('get /projects/:projectId/filtered-datasets/:id')({
    Projects: { getById: async () => option(project) },
    Forms: { getByProjectAndXmlFormId: async () => assert.fail('must not check source form') },
    maybeOne: async () => option({
      id: 3, projectId: 9, formId: 7, columns: ['/data/district'],
      query: [{ column: '/data/name', filter: '<>', value: '', condition: 'AND' }]
    }),
    db: {}
  }, {
    params: { projectId: '9', id: '3' },
    auth: { canOrReject: async (verb, target) => permissions.push([verb, target]) }
  });
  assert.deepEqual(permissions.map(([verb]) => verb), [
    'project.read', 'submission.list', 'submission.read'
  ]);
  assert.equal(definition.query, undefined);
  assert.equal(definition.filterCount, 1);
});

// A saved dataset outlives the form it was built on. When a republished form
// no longer has a field the dataset filters on, the filter was the thing
// keeping this reader's rows narrow, so serving the rows without it would
// disclose what the dataset was set up to hide. It fails closed instead, and
// still without reaching for the source form.
test('filtered dataset serves nothing when a republished form dropped its filter field', async () => {
  const option = value => ({ isDefined: () => true, get: () => value });
  const permissions = [];
  const result = await routes.get('get /projects/:projectId/filtered-datasets/:id/data')({
    Projects: { getById: async () => option({ id: 9 }) },
    Forms: { getByProjectAndXmlFormId: async () => assert.fail('must not check source form') },
    maybeOne: async () => option({
      id: 3, projectId: 9, formId: 7, currentDefId: 12,
      columns: ['/data/district'],
      query: [{ column: '/data/name', filter: '<>', value: '', condition: 'AND' }]
    }),
    db: {
      // The form was republished without /data/name.
      any: async query => (query.sql.includes('from form_fields')
        ? [{ path: '/data/district', name: 'district', type: 'string', binary: false, order: 1 }]
        : assert.fail('must not query submissions once the filter cannot be applied')),
      one: async () => assert.fail('must not count rows it cannot filter'),
      oneFirst: async () => assert.fail('must not count rows it cannot filter')
    }
  }, {
    params: { projectId: '9', id: '3' }, query: { limit: '10', offset: '0' },
    auth: { canOrReject: async (verb, target) => permissions.push([verb, target]) }
  });

  assert.equal(result.usable, false);
  assert.deepEqual(result.data, []);
  assert.equal(result.total, 0);
  assert.deepEqual(result.missingFilters, ['/data/name']);
});

// Losing a visible column is cosmetic, not a disclosure, so the dataset keeps
// working with one fewer field rather than refusing the reader entirely.
test('filtered dataset keeps serving the columns that survive a republished form', async () => {
  const option = value => ({ isDefined: () => true, get: () => value });
  const result = await routes.get('get /projects/:projectId/filtered-datasets/:id/data')({
    Projects: { getById: async () => option({ id: 9 }) },
    Forms: { getByProjectAndXmlFormId: async () => assert.fail('must not check source form') },
    maybeOne: async () => option({
      id: 3, projectId: 9, formId: 7, currentDefId: 12,
      columns: ['/data/district', '/data/hh_size'],
      query: [{ column: '/data/district', filter: '=', value: 'Bombali', condition: 'AND' }]
    }),
    db: {
      any: async query => (query.sql.includes('from form_fields')
        ? [{ path: '/data/district', name: 'district', type: 'string', binary: false, order: 1 }]
        : [{ data: { '/data/district': 'Bombali' } }]),
      one: async () => ({ total: 1, valid: 1 }),
      oneFirst: async () => 1
    }
  }, {
    params: { projectId: '9', id: '3' }, query: { limit: '10', offset: '0' },
    auth: { canOrReject: async () => {} }
  });

  assert.equal(result.usable, true);
  assert.deepEqual(result.columns, ['/data/district']);
  assert.deepEqual(result.missingColumns, ['/data/hh_size']);
  assert.equal(result.data.length, 1);
});

// A widget over a filtered dataset must be built from that dataset's visible
// columns only. A chart leaks a hidden field as readily as a table does, and
// more quietly, because nobody reads a bar chart looking for a column name.
test('widgets on a filtered dataset can only be built from its visible columns', async () => {
  const option = value => ({ isDefined: () => true, get: () => value });
  const allFields = [
    { path: '/data/district', name: 'district', type: 'string', binary: false, order: 1 },
    { path: '/data/name', name: 'name', type: 'string', binary: false, order: 2 }
  ];
  const container = {
    Projects: { getById: async () => option({ id: 9 }) },
    Forms: { getByProjectAndXmlFormId: async () => assert.fail('dataset parent, not form') },
    // The dataset shows district only; name is deliberately hidden.
    maybeOne: async () => option({
      id: 4, projectId: 9, formId: 7, currentDefId: 12,
      columns: ['/data/district'], query: []
    }),
    db: {
      any: async () => allFields,
      one: async () => assert.fail('must not reach the data query')
    }
  };
  const context = {
    params: { projectId: '9' },
    body: { filteredDatasetId: '4', title: 'Names', column: '/data/name' },
    auth: { canOrReject: async () => {}, actor: { map: () => ({ orNull: () => 1 }) } }
  };

  await assert.rejects(
    routes.get('post /projects/:projectId/widgets')(container, context),
    error => /allowed to read/.test(error.problemDetails?.reason ?? error.message)
  );
});

// Order is contiguous from zero, and reordering takes the whole list at once
// so two widgets can never end up sharing a place.
test('widget reordering refuses a partial list', async () => {
  const option = value => ({ isDefined: () => true, get: () => value });
  const container = {
    Projects: { getById: async () => option({ id: 9 }) },
    Forms: { getByProjectAndXmlFormId: async () => option({ id: 7, xmlFormId: 'f', currentDefId: 12 }) },
    db: {
      any: async query => (query.sql.includes('from form_fields')
        ? [{ path: '/data/district', name: 'district', type: 'string', binary: false, order: 1 }]
        : [{ id: 1 }, { id: 2 }, { id: 3 }]),
      query: async () => assert.fail('must not write a partial order')
    }
  };
  const context = {
    params: { projectId: '9' },
    body: { xmlFormId: 'f', order: [2, 1] },
    auth: { canOrReject: async () => {} }
  };

  await assert.rejects(
    routes.get('patch /projects/:projectId/widgets/order')(container, context),
    error => /exactly once/.test(error.problemDetails?.reason ?? error.message)
  );
});

// A merge must never become a way to read a form you were not given. The
// check is the floor -- every source form -- not the ceiling, and it runs on
// read as well as on creation, because a grant can be withdrawn after a merge
// is saved and the merge must not outlive it.
test('merged dataset data is refused when one source form is not readable', async () => {
  const option = value => ({ isDefined: () => true, get: () => value });
  const asked = [];
  const container = {
    Projects: { getById: async () => option({ id: 9 }) },
    Forms: {
      getByProjectAndXmlFormId: async (projectId, xmlFormId) =>
        option({ id: xmlFormId === 'round1' ? 7 : 8, xmlFormId, currentDefId: 12 })
    },
    maybeOne: async () => option({ id: 3, projectId: 9, name: 'Both rounds' }),
    db: {
      any: async () => [
        { formId: 7, xmlFormId: 'round1', currentDefId: 12, formName: 'Round 1' },
        { formId: 8, xmlFormId: 'round2', currentDefId: 13, formName: 'Round 2' }
      ],
      oneFirst: async () => assert.fail('must not read rows without every grant')
    }
  };
  const context = {
    params: { projectId: '9', id: '3' }, query: {},
    auth: {
      canOrReject: async (verb, target) => {
        asked.push([verb, target?.xmlFormId ?? 'project']);
        // Readable on round1, not on round2.
        if (target?.xmlFormId === 'round2') throw new Error('insufficient rights');
        return true;
      }
    }
  };

  await assert.rejects(
    routes.get('get /projects/:projectId/merged-datasets/:id/data')(container, context),
    /insufficient rights/
  );
  assert.ok(asked.some(([, form]) => form === 'round2'), 'must have checked the second form');
});

// Two forms at minimum, and never the same form twice -- a merge of a form
// with itself doubles every row and looks like twice the fieldwork.
test('merged datasets refuse fewer than two forms or a repeated form', async () => {
  const option = value => ({ isDefined: () => true, get: () => value });
  const container = {
    Projects: { getById: async () => option({ id: 9 }) },
    Forms: { getByProjectAndXmlFormId: async () => assert.fail('must not reach the forms') },
    db: { one: async () => assert.fail('must not write') }
  };
  const auth = { canOrReject: async () => {}, actor: { map: () => ({ orNull: () => 1 }) } };

  await Promise.all([['only-one'], [], ['same', 'same']].map(xmlFormIds =>
    assert.rejects(
      routes.get('post /projects/:projectId/merged-datasets')(container, {
        params: { projectId: '9' }, body: { name: 'x', xmlFormIds }, auth
      }),
      error => /at least two forms|list a form twice/.test(
        error.problemDetails?.reason ?? error.message
      ),
      `expected ${JSON.stringify(xmlFormIds)} to be refused`
    )));
});

// Every webhook that existed before targets did is target 'json' with a null
// formId, and must keep behaving exactly as it did. A migration that quietly
// stopped somebody's integration would do it at the far end, where nobody here
// would see it.
test('an untyped site-wide webhook still delivers the same JSON it always did', async () => {
  const { dispatchWebhooks } = require('../../lib/worker/webhooks');
  const posted = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      posted.push({ type: req.headers['content-type'], body });
      res.end('ok');
    });
  });
  await new Promise(resolve => { server.listen(0, '127.0.0.1', resolve); });

  try {
    const url = `http://127.0.0.1:${server.address().port}/`;
    const queries = [];
    await dispatchWebhooks({
      all: async query => {
        queries.push(query.sql);
        // The shape the migration leaves behind: defaulted target, no config.
        return [{ id: 1, url, secret: null, target: 'json', config: {} }];
      },
      run: async () => {}
    }, { action: 'submission.create', actorId: 1, acteeId: 'a1', loggedAt: 'now', details: {} });

    assert.equal(posted.length, 1);
    assert.equal(posted[0].type, 'application/json');
    assert.equal(JSON.parse(posted[0].body).event, 'submission.create');
    // And the selection still offers the site-wide case rather than requiring
    // every row to name a form.
    assert.ok(queries[0].includes('"formId" is null'));
  } finally {
    server.close();
  }
});

// A scoped service delivers its target's body, signed over the bytes actually
// sent rather than over a JSON version of them.
test('a typed webhook sends its target body and signs those bytes', async () => {
  const { dispatchWebhooks } = require('../../lib/worker/webhooks');
  const { encryptSecret } = require('../../lib/util/field-data-secret');
  let seen;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => { seen = { headers: req.headers, body }; res.end('ok'); });
  });
  await new Promise(resolve => { server.listen(0, '127.0.0.1', resolve); });

  try {
    await dispatchWebhooks({
      all: async () => [{
        id: 2, url: `http://127.0.0.1:${server.address().port}/`,
        secret: encryptSecret('shhh'), target: 'xml', config: { rootElement: 'submission' }
      }],
      run: async () => {}
    }, { action: 'submission.create', actorId: 1, acteeId: 'a1', loggedAt: 'now', details: {} });

    assert.equal(seen.headers['content-type'], 'application/xml');
    assert.ok(seen.body.startsWith('<?xml'), seen.body);
    assert.ok(seen.body.includes('<submission>'), seen.body);

    const expected = crypto.createHmac('sha256', 'shhh').update(Buffer.from(seen.body)).digest('hex');
    assert.equal(seen.headers['x-fielddata-signature'], `sha256=${expected}`);
  } finally {
    server.close();
  }
});

// Moving a project between tenants changes who can read it, so it takes
// authority over the project and not only the site-wide config right. A
// deployment where config.set alone could reparent a project would let one
// administrator hand another organization's data to their own.
test('adopting a project into an organization requires rights on that project', async () => {
  const option = value => ({ isDefined: () => true, get: () => value });
  const asked = [];
  await assert.rejects(
    routes.get('post /field-data/organizations/:slug/projects')({
      Projects: { getById: async () => option({ id: 4, acteeId: 'proj-actee' }) },
      maybeOne: async () => option({ id: 1, slug: 'agency-a', acteeId: 'org-actee' }),
      db: {
        query: async () => assert.fail('must not reparent without rights on the project')
      }
    }, {
      params: { slug: 'agency-a' }, body: { projectId: 4 },
      auth: {
        canOrReject: async (verb) => {
          asked.push(verb);
          if (verb === 'project.update') throw new Error('insufficient rights');
          return true;
        }
      }
    }),
    /insufficient rights/
  );
  // Authority over the organization is no longer the site-wide config right:
  // an owner administers their own tenant. The project half is unchanged, and
  // is what stops an owner pulling somebody else's project into their org.
  assert.ok(asked.includes('organization.update'), asked.join(', '));
  assert.ok(asked.includes('project.update'), asked.join(', '));
  assert.ok(asked.includes('project.update'), 'and the project right');
});

// Removing somebody from an organization revokes what the organization gave
// them and nothing else. A person may also hold a grant directly on one of its
// projects, and leaving the organization is not a statement about that.
test('removing an organization member revokes only the organization grant', async () => {
  const option = value => ({ isDefined: () => true, get: () => value });
  const deletes = [];
  await routes.get('delete /field-data/organizations/:slug/members/:actorId')({
    // The route reads the owner role to see whether this is the last one.
    Roles: { getBySystemName: async () => option({ id: 42, system: 'owner' }) },
    maybeOne: async () => option({ id: 1, slug: 'agency-a', acteeId: 'org-actee' }),
    db: {
      oneFirst: async () => 0,
      query: async query => { deletes.push({ sql: query.sql, values: query.values }); }
    }
  }, {
    params: { slug: 'agency-a', actorId: '11' },
    auth: { canOrReject: async () => {}, can: async () => true }
  });

  assert.equal(deletes.length, 1);
  // Scoped to this organization's actee, not to the actor generally.
  assert.ok(deletes[0].sql.includes('"acteeId"'), deletes[0].sql);
  assert.ok(deletes[0].values.includes('org-actee'), JSON.stringify(deletes[0].values));
  assert.ok(deletes[0].values.includes(11), JSON.stringify(deletes[0].values));
});

test('backup routes require backup.run rather than project creation rights', async () => {
  await Promise.all([
    'get /field-data/backups',
    'post /field-data/backups',
    'get /field-data/backups/:id/download'
  ].map(route => assert.rejects(routes.get(route)({}, { auth: { canOrReject: async verb => {
    assert.equal(verb, 'backup.run');
    throw new Error('forbidden');
  } } }), /forbidden/)));
});

test('webhook creation rejects malformed and unsupported event settings before insertion', async () => {
  const previous = dns.lookup;
  dns.lookup = async () => [{ address: '8.8.8.8', family: 4 }];
  try {
    await Promise.all([{}, 'submission.create', ['unknown.event']].map(events =>
      assert.rejects(routes.get('post /field-data/webhooks')({}, {
        auth: { canOrReject: async () => {} }, body: { name: 'test', url: 'https://example.test/', events }
      }), /supported webhook/)));
  } finally { dns.lookup = previous; }
});

test('schema-scoped deployments refuse the destructive legacy restore helper', () => {
  process.env.FIELD_DATA_DB_SCHEMA = 'field_data';
  try {
    assert.throws(() => require('../../lib/util/backup').restoreBackupFromRestoreStream(Readable.from([])),
      /Whole-database restore is disabled/);
  } finally { delete process.env.FIELD_DATA_DB_SCHEMA; }
});

const { runBackups } = require('../../lib/worker/field-data-backups');
const backupConnection = ({ locked = true, interrupted = [], pending = { id: 7 } } = {}) => {
  const queries = [];
  const connection = {
    oneFirst: async () => locked,
    any: async () => interrupted,
    maybeOne: async () => pending,
    query: async query => { queries.push(query); }
  };
  return { queries, db: { connect: callback => callback(connection) } };
};

test('backup worker skips execution when another runner owns the lock', async () => {
  const { db, queries } = backupConnection({ locked: false });
  await runBackups(db, { dump: () => assert.fail('must not dump') });
  assert.equal(queries.length, 0);
});

test('backup worker records success only after upload and releases its lock', async () => {
  const previous = process.env.FIELD_DATA_BACKUP_PASSPHRASE;
  process.env.FIELD_DATA_BACKUP_PASSPHRASE = 'test-passphrase-long-enough';
  const { db, queries } = backupConnection();
  try {
    await runBackups(db, {
      dump: async () => Readable.from(['encrypted fixture']),
      storage: {
        putStream: async (key, input) => {
          assert.equal(key, 'backups/manual-backup-7.pgdump.enc.bin');
          assert.equal(queries.some(q => q.sql.includes("status='Success'")), false);
          let bytes = 0;
          for await (const chunk of input) bytes += Buffer.byteLength(chunk);
          return bytes;
        },
        delete: async () => assert.fail('successful upload must be retained')
      }
    });
    assert.ok(queries.some(q => q.sql.includes("status='Success'")));
    assert.match(queries.at(-1).sql, /pg_advisory_unlock/);
  } finally {
    if (previous === undefined) delete process.env.FIELD_DATA_BACKUP_PASSPHRASE;
    else process.env.FIELD_DATA_BACKUP_PASSPHRASE = previous;
  }
});

test('backup worker persists failure and unlocks even if cleanup fails', async () => {
  const { db, queries } = backupConnection();
  await assert.rejects(runBackups(db, {
    dump: async () => { throw new Error('dump failure'); },
    storage: { delete: async () => { throw new Error('storage unavailable'); } }
  }), /storage unavailable/);
  assert.ok(queries.some(q => q.sql.includes("status='Failed'")));
  assert.match(queries.at(-1).sql, /pg_advisory_unlock/);
});

test('backup worker cleans an interrupted upload before starting a pending job', async () => {
  const { db, queries } = backupConnection({ interrupted: [{ storageKey: 'interrupted' }], pending: null });
  const removed = [];
  await runBackups(db, { storage: { delete: async key => removed.push(key) } });
  assert.deepEqual(removed, ['interrupted']);
  assert.match(queries.at(-1).sql, /pg_advisory_unlock/);
});

// Revocation. Creating a share takes both sides -- form.update on the source
// form, project.update on the destination project -- but before this, so did
// ending one. A form's administrator whose form was being served into a
// project they hold no rights in had no way to stop it short of deleting or
// unpublishing the form. Deleting only ever takes access away, so either side
// may do it, and neither side may be told which ids exist when they hold
// nothing at all.
const shareContainer = (deletes, { sourceFormAdmin, destinationAdmin }) => {
  const option = value => ({ isDefined: () => true, get: () => value });
  return {
    container: {
      Projects: { getById: async () => option({ id: 9 }) },
      Forms: {
        getByProjectAndXmlFormId: async () => option({ id: 7, projectId: 4, xmlFormId: 'survey' })
      },
      maybeOne: async () => option({
        id: 3, projectId: 9, formId: 7, sourceProjectId: 4, xmlFormId: 'survey',
        currentDefId: 12, columns: ['/district'], query: []
      }),
      db: { query: async query => { deletes.push(query.sql); } }
    },
    context: {
      params: { projectId: '9', id: '3' },
      auth: {
        can: async (verb) => (verb === 'project.update' ? destinationAdmin : sourceFormAdmin)
      }
    }
  };
};

test("a source form's administrator can revoke a share into a project they cannot read", async () => {
  const deletes = [];
  const { container, context } = shareContainer(deletes,
    { sourceFormAdmin: true, destinationAdmin: false });
  await routes.get('delete /projects/:projectId/filtered-datasets/:id')(container, context);
  assert.equal(deletes.length, 1);
  assert.match(deletes[0], /delete from field_data_filtered_datasets/);
});

test("a destination project's administrator can revoke a share of a form they cannot edit", async () => {
  const deletes = [];
  const { container, context } = shareContainer(deletes,
    { sourceFormAdmin: false, destinationAdmin: true });
  await routes.get('delete /projects/:projectId/filtered-datasets/:id')(container, context);
  assert.equal(deletes.length, 1);
});

test('somebody with a stake in neither side gets notFound, not a refusal', async () => {
  const deletes = [];
  const { container, context } = shareContainer(deletes,
    { sourceFormAdmin: false, destinationAdmin: false });
  // notFound rather than insufficientRights: a refusal would confirm the id.
  await assert.rejects(
    routes.get('delete /projects/:projectId/filtered-datasets/:id')(container, context),
    error => error.problemCode === 404.1
  );
  assert.equal(deletes.length, 0);
});

test("a source form's administrator can read what a share exposes", async () => {
  const { container, context } = shareContainer([],
    { sourceFormAdmin: true, destinationAdmin: false });
  const definition = await routes.get(
    'get /projects/:projectId/filtered-datasets/:id/definition')(container, context);
  // The filter is the point: you cannot decide whether to revoke a share
  // without seeing which columns and which rows it hands over.
  assert.deepEqual(definition.columns, ['/district']);
  assert.deepEqual(definition.query, []);
});

test('the definition is not readable by somebody with a stake in neither side', async () => {
  const { container, context } = shareContainer([],
    { sourceFormAdmin: false, destinationAdmin: false });
  await assert.rejects(
    routes.get('get /projects/:projectId/filtered-datasets/:id/definition')(container, context),
    error => error.problemCode === 404.1
  );
});

test("a form's shares are listed to the form's administrator, wherever they serve", async () => {
  const option = value => ({ isDefined: () => true, get: () => value });
  const permissions = [];
  let listed;
  const shares = await routes.get(
    'get /projects/:projectId/forms/:xmlFormId/filtered-datasets')({
    Forms: { getByProjectAndXmlFormId: async () => option({ id: 7 }) },
    db: { any: async query => { listed = query; return [{ id: 3, projectId: 9 }]; } }
  }, {
    params: { projectId: '4', xmlFormId: 'survey' },
    auth: { canOrReject: async (verb, target) => permissions.push([verb, target]) }
  });
  // The same right that authorises creating one. Anything weaker and this is
  // a way to learn which projects hold a form's data.
  assert.deepEqual(permissions.map(([verb]) => verb), ['form.update']);
  // Keyed on the form, not on the project, or it would miss exactly the
  // shares that are hard to find: the ones serving somewhere else.
  assert.match(listed.sql, /where d\."formId" =/);
  assert.equal(/d\."projectId" = /.test(listed.sql), false);
  assert.deepEqual(shares, [{ id: 3, projectId: 9 }]);
});

// Organization verbs. The owner role has carried organization.read,
// organization.update and organization.member.manage since 20260920-05, and
// nothing checked them: every route demanded the site-wide config right, so
// the role promised in the interface to run the organization while only an
// administrator could do any of it.
const orgContainer = (verbs, { calls = [], assignRole = true } = {}) => ({
  container: {
    Roles: {
      // Echo what was asked for. A mock that hands back the same role whatever
      // the name would have hidden which role the route actually granted.
      getBySystemName: async (system) => ({
        isDefined: () => true,
        get: () => ({ id: system === 'owner' ? 42 : 43, system })
      })
    },
    Actors: {
      getById: async () => ({ isDefined: () => true, get: () => ({ id: 77, displayName: 'Aminata' }) })
    },
    Assignments: { grant: async (...args) => { calls.push(['grant', args[1].system]); } },
    maybeOne: async () => ({
      isDefined: () => true,
      get: () => ({ id: 1, slug: 'bombali', name: 'Bombali', acteeId: 'org-actee', archivedAt: null })
    }),
    db: {
      any: async () => [],
      one: async () => ({ id: 1, slug: 'bombali', name: 'Bombali', acteeId: 'org-actee' }),
      oneFirst: async () => 0,
      query: async query => { calls.push(['sql', query.sql]); }
    }
  },
  context: {
    params: { slug: 'bombali', actorId: '77' },
    body: { actorId: 77, role: 'manager', name: 'Renamed' },
    auth: {
      isAuthenticated: true,
      can: async (verb) => verbs.includes(verb),
      canOrReject: async (verb) => {
        if (!verbs.includes(verb)) throw Object.assign(new Error('forbidden'), { problemCode: 403.1 });
        return true;
      },
      canAssignRole: async () => assignRole,
      verbsOn: async () => verbs,
      actor: { isDefined: () => false, map: () => ({ orNull: () => null }) }
    }
  }
});

test('an organization owner can rename and manage members without the site-wide config right', async () => {
  const owner = ['organization.read', 'organization.update', 'organization.member.manage'];
  const calls = [];
  const { container, context } = orgContainer(owner, { calls });

  await routes.get('patch /field-data/organizations/:slug')(container, context);
  await routes.get('post /field-data/organizations/:slug/members')(container, context);
  assert.deepEqual(calls.filter(([kind]) => kind === 'grant'), [['grant', 'manager']]);
});

test('an organization manager, holding none of the three verbs, can do none of it', async () => {
  // The project-manager verbs reach the organization's projects. They do not
  // reach the organization itself, which is the distinction the owner role
  // exists to draw.
  const manager = ['project.update', 'form.update', 'assignment.create'];
  for (const route of [
    'patch /field-data/organizations/:slug',
    'post /field-data/organizations/:slug/members',
    'delete /field-data/organizations/:slug/members/:actorId',
    'get /field-data/organizations/:slug/members'
  ]) {
    const { container, context } = orgContainer(manager);
    // eslint-disable-next-line no-await-in-loop
    await assert.rejects(routes.get(route)(container, context),
      error => error.problemCode === 403.1, route);
  }
});

test('nobody grants a role carrying more than they hold themselves', async () => {
  // canAssignRole is Central's own check. Using it rather than a rule written
  // here is what stops an organization owner being a way around the site's
  // answer to that question.
  const calls = [];
  const { container, context } = orgContainer(
    ['organization.member.manage'], { calls, assignRole: false });
  await assert.rejects(
    routes.get('post /field-data/organizations/:slug/members')(container, context),
    error => error.problemCode === 403.1);
  assert.deepEqual(calls.filter(([kind]) => kind === 'grant'), []);
});

test('the last owner is not removable by an owner, and is by a site administrator', async () => {
  const withOwners = (verbs, { remaining, targetIsOwner }) => {
    const made = orgContainer(verbs);
    let call = 0;
    made.container.db.oneFirst = async () => {
      call += 1;
      return call === 1 ? remaining : (targetIsOwner ? 1 : 0);
    };
    return made;
  };

  // Removing yourself as the only owner leaves an organization nobody but a
  // site administrator can run, so it is refused with the remedy in the text.
  const alone = withOwners(['organization.member.manage'],
    { remaining: 0, targetIsOwner: true });
  await assert.rejects(
    routes.get('delete /field-data/organizations/:slug/members/:actorId')(
      alone.container, alone.context),
    error => /only owner/.test(error.problemDetails?.reason ?? error.message));

  // A site administrator is the escape hatch. Blocking them is the one way
  // this guard could do harm, so it does not.
  const admin = withOwners(
    ['organization.member.manage', 'config.set'], { remaining: 0, targetIsOwner: true });
  await routes.get('delete /field-data/organizations/:slug/members/:actorId')(
    admin.container, admin.context);

  // Removing somebody who is not an owner is never the last-owner case.
  const other = withOwners(['organization.member.manage'],
    { remaining: 0, targetIsOwner: false });
  await routes.get('delete /field-data/organizations/:slug/members/:actorId')(
    other.container, other.context);
});

test('the organization list shows each caller only what they may read', async () => {
  const rows = [
    { id: 1, slug: 'bombali', acteeId: 'a' },
    { id: 2, slug: 'kambia', acteeId: 'b' }
  ];
  const listFor = (verbsByActee) => routes.get('get /field-data/organizations')({
    db: { any: async () => rows }
  }, {
    auth: { verbsOn: async (org) => verbsByActee[org.acteeId] ?? [] }
  });

  const owner = await listFor({ a: ['organization.read', 'organization.update'] });
  assert.deepEqual(owner.map(org => org.slug), ['bombali']);
  // The rights travel with the row, because the interface can no longer work
  // them out from a site-wide permission that no longer governs.
  assert.equal(owner[0].canUpdate, true);
  assert.equal(owner[0].canManageMembers, false);

  const admin = await listFor({
    a: ['organization.read'], b: ['organization.read', 'organization.member.manage']
  });
  assert.deepEqual(admin.map(org => org.slug), ['bombali', 'kambia']);

  // Somebody with a grant on no organization sees none of them, rather than
  // the whole tenant list.
  assert.deepEqual(await listFor({}), []);
});

// The system status block is the one part of the dashboard that does something
// rather than counting something: it writes and deletes an object in storage
// and makes an outbound request to Enketo and to pyxform. Running it for every
// project member on every load handed them a map of what this deployment runs,
// and let any of them drive real infrastructure as fast as they could refresh.
const statsContainer = (isAdmin, probes) => ({
  container: {
    Projects: { getAllByAuth: async () => [{ id: 1, acteeId: 'one' }] },
    db: {
      oneFirst: async (query) => {
        if (String(query.sql).trim() === 'select 1') probes.push('database');
        return 0;
      },
      any: async () => []
    }
  },
  context: {
    auth: {
      can: async (verb) => (verb === 'user.list' ? isAdmin : true)
    }
  }
});

test('the system status probes do not run for somebody who is not an administrator', async () => {
  const probes = [];
  const { container, context } = statsContainer(false, probes);
  const result = await routes.get('get /field-data/stats')(container, context);

  // Null, not a row of false: never asked is not the same as down, and a row
  // of false would read as an outage.
  assert.equal(result.systemStatus, null);
  assert.deepEqual(probes, []);
  // The rest of the dashboard is untouched -- this is about the probes, not
  // about withholding somebody's own numbers.
  assert.equal(result.kpi.projects, 1);
});

test('a project member with no projects is not a way to reach the probes either', async () => {
  const probes = [];
  const { container, context } = statsContainer(false, probes);
  container.Projects.getAllByAuth = async () => [];
  const result = await routes.get('get /field-data/stats')(container, context);
  // This branch used to return five hardcoded values claiming the database and
  // storage were up, without having asked either.
  assert.equal(result.systemStatus, null);
  assert.deepEqual(probes, []);
});

// Depends on being the first test in this file to reach the probe, because the
// cache is module-level and its window is 30 seconds. Every other stats test
// here is a non-administrator, which never probes. Add an administrator case
// above this one and it will start measuring a warm cache instead.
test('the probes run once for a burst of administrators, not once each', async () => {
  const probes = [];
  const made = [0, 1, 2, 3].map(() => statsContainer(true, probes));
  const results = await Promise.all(made.map(({ container, context }) =>
    routes.get('get /field-data/stats')(container, context)));

  for (const result of results) assert.equal(typeof result.systemStatus.database, 'boolean');
  // Four requests arriving together share one probe: the promise is cached,
  // not the value, so the second caller waits on the first rather than
  // starting a second write against storage.
  assert.deepEqual(probes, ['database']);

  // And a later request inside the window reuses it rather than probing again.
  const { container, context } = statsContainer(true, probes);
  await routes.get('get /field-data/stats')(container, context);
  assert.deepEqual(probes, ['database']);
});

// A submission_defs id is not a form_defs id. The two tables have independent
// sequences, so joining form_defs.id to a submission version's id matches only
// where the numbers happen to coincide -- which they do for the first
// submission of a fresh deployment and for nothing after it. Shipped that way,
// Google Sheets synchronized one row and then failed every delivery with "The
// Form has no fields that can be synchronized."
//
// This mock keeps the two id spaces deliberately apart, the way a real
// database does: the form's definition is form_defs 4, and its submissions are
// submission_defs 11, 12 and 13.
const sheetDatabase = () => {
  const FORM_DEF = { id: 4, schemaId: 9 };
  const SUBMISSION_DEFS = new Map([
    [11, { formDefId: 4, instanceId: 'uuid:one' }],
    [12, { formDefId: 4, instanceId: 'uuid:two' }],
    [13, { formDefId: 4, instanceId: 'uuid:three' }]
  ]);
  const FIELDS = [
    { schemaId: 9, path: '/district' },
    { schemaId: 9, path: '/hh_size' }
  ];

  return async (query) => {
    // The first bound value is the submission version id in either shape of
    // this query. What differs -- and what is under test -- is which table's
    // id column it gets compared against, so that is read off the SQL rather
    // than guessed from the number. A mock that decides for itself what an
    // integer means is a mock that can be wrong in the same way as the code,
    // and then it agrees with the bug instead of catching it.
    const bound = query.values[0];
    if (query.sql.includes('from form_fields')) {
      const comparedToSubmissionDefs =
        /join\s+submission_defs\s+\w+\s+on\s+\w+\."?id"?\s*=\s*\$/.test(query.sql);
      // Either resolve through the real FK or reproduce the old, incorrect
      // comparison straight to form_defs.id.
      const formDefId = comparedToSubmissionDefs
        ? SUBMISSION_DEFS.get(bound)?.formDefId
        : bound;
      return formDefId === FORM_DEF.id
        ? FIELDS.filter(field => field.schemaId === FORM_DEF.schemaId)
          .map(({ path: fieldPath }) => ({ path: fieldPath }))
        : [];
    }
    const submissionDefId = query.values.find(value => SUBMISSION_DEFS.has(value));
    if (submissionDefId == null) return [];
    return [{
      instanceId: SUBMISSION_DEFS.get(submissionDefId).instanceId,
      createdAt: new Date('2026-09-20T08:00:00.000Z'),
      answers: { '/district': 'Bombali', '/hh_size': '6' }
    }];
  };
};

test('Google Sheets resolves a form version through formDefId, not by id collision', async () => {
  const all = sheetDatabase();
  const hook = { formId: 7 };

  // Every submission, not just the one whose id happens to match a form_defs
  // row. The second and third are the ones the shipped join lost.
  for (const submissionDefId of [11, 12, 13]) {
    // eslint-disable-next-line no-await-in-loop
    const payload = await _googleSheetPayload(all,
      { action: 'submission.create', details: { submissionDefId } }, hook);
    assert.deepEqual(payload.headers,
      ['_instance_id', '_submitted_at', '_event', '/district', '/hh_size']);
    assert.equal(payload.row[0], `uuid:${{ 11: 'one', 12: 'two', 13: 'three' }[submissionDefId]}`);
    assert.deepEqual(payload.row.slice(3), ['Bombali', '6']);
  }
});

test('a Submission event with no version to synchronize is refused, not guessed at', async () => {
  const all = sheetDatabase();
  await Promise.all([undefined, {}, { submissionDefId: 'not-a-number' }].map(details =>
    assert.rejects(
      _googleSheetPayload(all, { action: 'submission.create', details }, { formId: 7 }),
      /does not identify a version/)));
});

// The instance-ID column used to be fetched whole, as A:A, on every delivery,
// against a worker that keeps at most a megabyte of any response. At about 46
// bytes per quoted ID that was a hard stop near 22,000 rows: truncated JSON,
// a parse error, and every later delivery failing for good with a message
// that said nothing about size.
//
// These drive the real loops through the real deliver(), with a stub target
// pointing at a local server. The loops are target-agnostic; google-sheets.js
// builds the URLs and has its own tests for that.
const sheetServer = async (handler) => {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url });
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => handler(req, res, seen.length, body));
  });
  await new Promise(resolve => { server.listen(0, '127.0.0.1', resolve); });
  const { port } = server.address();
  return {
    seen,
    port,
    close: () => new Promise(resolve => { server.close(resolve); })
  };
};

// Only the URL building differs from the real target, and only so the requests
// land on a local plain-HTTP server instead of Google over TLS.
const stubTarget = (port) => ({
  LOOKUP_BATCH: 4,
  buildLookupRequest: (config, accessToken, { offset = 0, limit = 4 } = {}) => ({
    method: 'GET',
    url: `http://127.0.0.1:${port}/values?offset=${offset}&limit=${limit}`,
    headers: {},
    body: null
  }),
  analyseLookup: require('../../lib/util/rest-targets/google-sheets').analyseLookup
});

test('the instance-ID column is read in windows until the row turns up', async () => {
  const previousAgent = http.globalAgent;
  http.globalAgent = new http.Agent({ proxyEnv: {} });
  // Six IDs in windows of four: the wanted one is the second of the second
  // window, so it is row six and it takes two requests to reach.
  const ids = ['uuid:a', 'uuid:b', 'uuid:c', 'uuid:d', 'uuid:e', 'uuid:wanted'];
  const srv = await sheetServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const offset = Number(url.searchParams.get('offset'));
    const limit = Number(url.searchParams.get('limit'));
    res.end(JSON.stringify({ values: [ids.slice(offset, offset + limit)] }));
  });
  try {
    const found = await _findSheetRow(stubTarget(srv.port), {}, 'tok', 'uuid:wanted',
      { search: true });
    assert.deepEqual(found.lookup, { empty: false, rowNumber: 6 });
    assert.equal(srv.seen.length, 2, JSON.stringify(srv.seen));
    assert.match(srv.seen[1].url, /offset=4/);
  } finally {
    http.globalAgent.destroy();
    http.globalAgent = previousAgent;
    await srv.close();
  }
});

test('an integration that does not sync updates reads one cell, not the column', async () => {
  const previousAgent = http.globalAgent;
  http.globalAgent = new http.Agent({ proxyEnv: {} });
  const srv = await sheetServer((req, res) => {
    res.end(JSON.stringify({ values: [['uuid:a']] }));
  });
  try {
    const found = await _findSheetRow(stubTarget(srv.port), {}, 'tok', 'uuid:new',
      { search: false });
    // Nothing to search for: every event carries an ID the sheet has not seen.
    // The one question left is whether the header row still has to be written.
    assert.deepEqual(found.lookup, { empty: false, rowNumber: null });
    assert.equal(srv.seen.length, 1);
    assert.match(srv.seen[0].url, /limit=1/);
  } finally {
    http.globalAgent.destroy();
    http.globalAgent = previousAgent;
    await srv.close();
  }
});

// Appending is not idempotent, and the retry exists for lost responses --
// exactly the case where Google may already have committed the row. The
// lookup that would catch a duplicate runs before the append, so it cannot.
// The same question one level up, where it decides how much of the sheet a
// routine Submission costs to deliver.
test('only an actual update walks the column; a new Submission does not', async () => {
  const searchFor = (syncUpdates, action) => (syncUpdates === true && action !== 'submission.create');

  // An ID that a Form has already issued cannot arrive again as a create, so
  // there is nothing to look for and no reason to read the column.
  assert.equal(searchFor(true, 'submission.create'), false);
  assert.equal(searchFor(false, 'submission.create'), false);
  assert.equal(searchFor(false, 'submission.update.version'), false);
  // A new version of a Submission the sheet already holds is the one case
  // that has to find the existing row.
  assert.equal(searchFor(true, 'submission.update.version'), true);

  // And the rule the worker uses is that rule, read out of the source rather
  // than restated here, so the two cannot drift apart.
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'lib', 'worker', 'webhooks.js'), 'utf8');
  assert.match(source,
    /search:\s*openedConfig\.syncUpdates === true\s*\n\s*&& event\.action !== 'submission\.create'/);
});

test('a lost append response is verified against the sheet, not repeated', async () => {
  const previousAgent = http.globalAgent;
  http.globalAgent = new http.Agent({ proxyEnv: {} });
  let appends = 0;
  const srv = await sheetServer((req, res) => {
    if (req.method === 'POST') {
      appends += 1;
      // The row lands, and then the connection dies before the response.
      res.destroy();
      return;
    }
    res.end(JSON.stringify({ values: [['uuid:landed']] }));
  });
  try {
    const built = {
      method: 'POST', url: `http://127.0.0.1:${srv.port}/append`, headers: {},
      body: Buffer.from('{}')
    };
    const outcome = await _appendWithVerification(stubTarget(srv.port), {}, 'tok',
      'uuid:landed', built);
    assert.equal(outcome.success, true, JSON.stringify(outcome));
    assert.equal(outcome.verified, true);
    // The row was there, so it was never sent a second time.
    assert.equal(appends, 1);
  } finally {
    http.globalAgent.destroy();
    http.globalAgent = previousAgent;
    await srv.close();
  }
});

test('an append that genuinely did not land is sent again', async () => {
  const previousAgent = http.globalAgent;
  http.globalAgent = new http.Agent({ proxyEnv: {} });
  let appends = 0;
  const srv = await sheetServer((req, res) => {
    if (req.method === 'POST') {
      appends += 1;
      if (appends === 1) { res.destroy(); return; }
      res.end('{}');
      return;
    }
    // The verification finds nothing, so the first attempt really was lost.
    res.end(JSON.stringify({ values: [['uuid:other']] }));
  });
  try {
    const built = {
      method: 'POST', url: `http://127.0.0.1:${srv.port}/append`, headers: {},
      body: Buffer.from('{}')
    };
    const outcome = await _appendWithVerification(stubTarget(srv.port), {}, 'tok',
      'uuid:missing', built);
    assert.equal(outcome.success, true, JSON.stringify(outcome));
    assert.equal(outcome.verified, undefined);
    assert.equal(appends, 2);
  } finally {
    http.globalAgent.destroy();
    http.globalAgent = previousAgent;
    await srv.close();
  }
});

// googleSheetPayload used to destructure `all` off whatever it was handed.
// The live dispatch path hands it a container, whose query method is all();
// the backfill worker hands it a slonik connection, whose method is any().
// So `all` came back undefined, every historical item failed with "all is not
// a function", and the sync reported every row Failed with a message nobody
// could act on. A parameter cannot go missing by accident the way a property
// can, so it takes one now.
test('the Sheets payload takes a query function, from either kind of caller', async () => {
  const rows = [{ path: '/district' }];
  const submission = [{
    instanceId: 'uuid:1', createdAt: new Date('2026-09-20T00:00:00Z'),
    answers: { '/district': 'Bombali' }
  }];
  const answer = async query => (query.sql.includes('from form_fields') ? rows : submission);
  const event = { action: 'submission.backfill', details: { submissionDefId: 12 } };

  // What the worker container offers.
  const viaContainer = await _googleSheetPayload(answer, event, { formId: 7 });
  assert.deepEqual(viaContainer.row.slice(3), ['Bombali']);

  // What a slonik connection offers, adapted at the call site the way
  // lib/worker/field-data-google-sheets.js does it.
  const connection = { any: answer, one: async () => ({}), query: async () => ({}) };
  assert.equal(typeof connection.all, 'undefined');
  const viaConnection = await _googleSheetPayload(s => connection.any(s), event, { formId: 7 });
  assert.deepEqual(viaConnection, viaContainer);

  // And handing it an object, as both callers used to, says so rather than
  // failing one row at a time inside a catch.
  await assert.rejects(_googleSheetPayload(connection, event, { formId: 7 }),
    error => error instanceof TypeError && /needs a query function/.test(error.message));
});

test('the backfill worker adapts the connection rather than hoping it matches', () => {
  const source = fs.readFileSync(path.join(__dirname,
    '../../lib/worker/field-data-google-sheets.js'), 'utf8');
  assert.match(source, /googleSheetPayload\(s => connection\.any\(s\)/);
  assert.equal(/googleSheetPayload\(connection,/.test(source), false);
});

// The template size limit counts compressed bytes, which is not what costs
// memory: a valid 0.32 MB workbook expanded to 92.7 MB of XML and 735 MB of
// resident memory, from three per cent of the allowance. Uploading takes
// project.update, so this was a project manager away from an out-of-memory
// server, with nothing to rate-limit it.
test('a template is measured by what it becomes, not by what was uploaded', () => {
  const reports = require('../../lib/util/xls-reports');
  assert.ok(reports.MAX_TEMPLATE_INFLATED_BYTES > 0);
  assert.ok(reports.MAX_TEMPLATE_INFLATED_BYTES <= 64 * 1024 * 1024);
  assert.ok(reports.MAX_TEMPLATE_PARTS > 0 && reports.MAX_TEMPLATE_PARTS <= 4096);

  // The bound runs before ExcelJS is given the buffer, which is the whole
  // point: ExcelJS decompresses the package to decide it is too big.
  const source = fs.readFileSync(path.join(__dirname,
    '../../lib/util/xls-reports.js'), 'utf8');
  assert.match(source, /await assertBoundedArchive\([\s\S]{0,200}?\n\s*const workbook = new ExcelJS\.Workbook\(\)/);
});

/*
A round trip through the real target.

Everything above tests a loop or a URL in isolation. This runs the sequence the
worker actually performs -- exchange the refresh token, find the row, write it
-- using lib/util/rest-targets/google-sheets.js unmodified, against a server
that answers the way Google's published contract says it does.

One substitution, and only one: the origin is rewritten to the local server,
because the target's URLs point at Google over TLS and there are no
credentials here. The paths, the query parameters, the bodies and the parsing
are the real ones, and test/unit/util/google-sheets-contract.js is what pins
those paths to Google's own discovery document.

The response shapes below are ValueRange, AppendValuesResponse and
UpdateValuesResponse as that document defines them; the 401 bodies are the
ones the live endpoints returned to these exact requests.
*/
const realTarget = require('../../lib/util/rest-targets/google-sheets');

const fakeGoogle = async (sheet, { tokenStatus = 200 } = {}) => {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      requests.push({ method: req.method, path: url.pathname, query: url.searchParams });

      if (url.pathname === '/token') {
        if (tokenStatus !== 200) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_client', error_description: 'The OAuth client was not found.' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ access_token: 'ya29.fake', expires_in: 3599, token_type: 'Bearer' }));
        return;
      }

      if (req.headers.authorization !== 'Bearer ya29.fake') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 401, status: 'UNAUTHENTICATED', message: 'Request had invalid authentication credentials.' } }));
        return;
      }

      const range = decodeURIComponent(url.pathname.split('/values/')[1] ?? '');
      if (req.method === 'GET') {
        const [from, to] = range.split('!')[1].split(':').map(cell => Number(cell.slice(1)));
        const column = sheet.slice(from - 1, to).map(row => row[0]);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ range, majorDimension: 'COLUMNS', values: column.length === 0 ? [] : [column] }));
        return;
      }
      const sent = JSON.parse(body).values;
      if (req.method === 'POST') { // :append
        sheet.push(...sent);
        res.end(JSON.stringify({ spreadsheetId: 'x', tableRange: range, updates: { updatedRows: sent.length } }));
        return;
      }
      const row = Number(range.split('!')[1].split(':')[0].slice(1)); // PUT, one row
      sheet[row - 1] = sent[0];
      res.end(JSON.stringify({ spreadsheetId: 'x', updatedRange: range, updatedRows: 1, updatedCells: sent[0].length }));
    });
  });
  await new Promise(resolve => { server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const local = (request) => ({ ...request, url: request.url.replace(/^https:\/\/[^/]+/, origin) });
  return {
    requests,
    sheet,
    close: () => new Promise(resolve => { server.close(resolve); }),
    // The real target, with its origin pointed here.
    target: {
      ...realTarget,
      buildTokenRequest: config => local({ ...realTarget.buildTokenRequest(config), url: `${origin}/token` }),
      buildLookupRequest: (...args) => local(realTarget.buildLookupRequest(...args)),
      buildRequest: (...args) => local(realTarget.buildRequest(...args))
    }
  };
};

const sheetsConfig = { spreadsheetId: 'sheet-id', sheetName: 'Submissions' };

// The worker's sequence, kept in one place so the tests below read as the
// story rather than as plumbing.
const runDelivery = async (google, payload, { search }) => {
  const tokenRequest = google.target.buildTokenRequest({ ...sheetsConfig, clientId: 'c', clientSecret: 's', refreshToken: 'r' });
  const tokenOutcome = await deliver(tokenRequest.url, tokenRequest.body, tokenRequest.headers, tokenRequest.method);
  const token = tokenOutcome.success ? JSON.parse(tokenOutcome.responseBody).access_token : null;
  if (token == null) return { token: null, tokenOutcome };

  const found = await _findSheetRow(google.target, sheetsConfig, token, payload.instanceId, { search });
  if (found.failure != null) return { token, failure: found.failure };
  const built = google.target.buildRequest(payload, sheetsConfig,
    { accessToken: token, lookup: found.lookup });
  const outcome = found.lookup.rowNumber == null
    ? await _appendWithVerification(google.target, sheetsConfig, token, payload.instanceId, built)
    : await deliver(built.url, built.body, built.headers, built.method);
  return { token, found, outcome };
};

const rowFor = (id, district) => ({
  instanceId: id,
  headers: ['_instance_id', '_submitted_at', '_event', '/district'],
  row: [id, '2026-09-20T00:00:00.000Z', 'submission.create', district]
});

test('a first Submission writes the header row and its own row', async () => {
  const previousAgent = http.globalAgent;
  http.globalAgent = new http.Agent({ proxyEnv: {} });
  const google = await fakeGoogle([]);
  try {
    const result = await runDelivery(google, rowFor('uuid:1', 'Bombali'), { search: false });
    assert.equal(result.outcome.success, true, JSON.stringify(result.outcome));
    assert.deepEqual(google.sheet[0], ['_instance_id', '_submitted_at', '_event', '/district']);
    assert.deepEqual(google.sheet[1][3], 'Bombali');
    // One cell read, then the append: no column scan for a new Submission.
    assert.deepEqual(google.requests.map(r => r.method), ['POST', 'GET', 'POST']);
  } finally {
    http.globalAgent.destroy(); http.globalAgent = previousAgent; await google.close();
  }
});

test('a later Submission appends without repeating the headers', async () => {
  const previousAgent = http.globalAgent;
  http.globalAgent = new http.Agent({ proxyEnv: {} });
  const google = await fakeGoogle([['_instance_id', '_submitted_at', '_event', '/district'],
    ['uuid:1', '2026-09-20T00:00:00.000Z', 'submission.create', 'Bombali']]);
  try {
    await runDelivery(google, rowFor('uuid:2', 'Kono'), { search: false });
    assert.equal(google.sheet.length, 3);
    assert.deepEqual(google.sheet[2][3], 'Kono');
  } finally {
    http.globalAgent.destroy(); http.globalAgent = previousAgent; await google.close();
  }
});

test('a new version replaces the Submission’s own row rather than adding one', async () => {
  const previousAgent = http.globalAgent;
  http.globalAgent = new http.Agent({ proxyEnv: {} });
  const google = await fakeGoogle([['_instance_id', '_submitted_at', '_event', '/district'],
    ['uuid:1', '2026-09-20T00:00:00.000Z', 'submission.create', 'Bombali'],
    ['uuid:2', '2026-09-20T00:00:00.000Z', 'submission.create', 'Kono']]);
  try {
    const result = await runDelivery(google, rowFor('uuid:1', 'Bombali East'), { search: true });
    assert.equal(result.found.lookup.rowNumber, 2);
    assert.equal(google.sheet.length, 3, 'no row was added');
    assert.deepEqual(google.sheet[1][3], 'Bombali East');
    assert.deepEqual(google.sheet[2][3], 'Kono', 'the neighbouring row is untouched');
    assert.ok(google.requests.some(r => r.method === 'PUT'));
  } finally {
    http.globalAgent.destroy(); http.globalAgent = previousAgent; await google.close();
  }
});

test('an expired refresh token is reported as that, and not retried', async () => {
  const previousAgent = http.globalAgent;
  http.globalAgent = new http.Agent({ proxyEnv: {} });
  const google = await fakeGoogle([], { tokenStatus: 401 });
  try {
    const result = await runDelivery(google, rowFor('uuid:1', 'Bombali'), { search: false });
    assert.equal(result.token, null);
    // 401 is not in retryable(), so a dead credential fails once rather than
    // three times. This is the body the live endpoint actually returns.
    assert.equal(result.tokenOutcome.attempts, 1);
    assert.equal(JSON.parse(result.tokenOutcome.responseBody).error, 'invalid_client');
    assert.equal(google.requests.length, 1, 'nothing was attempted against the sheet');
  } finally {
    http.globalAgent.destroy(); http.globalAgent = previousAgent; await google.close();
  }
});

test('the cross-project listings are filtered by permission, not by hope', () => {
  const resource = fs.readFileSync(
    path.join(__dirname, '../../lib/resources/field-data.js'), 'utf8');

  // Both listings read across every project, so the only thing standing
  // between one organization and another's data is the join to `visible`.
  // Deleting it would still return rows, and every test that only checks the
  // shape of a response would still pass.
  for (const route of ['/field-data/forms', '/field-data/submissions']) {
    const start = resource.indexOf(`service.get('${route}'`);
    assert.ok(start !== -1, `${route} is missing`);
    const body = resource.slice(start, resource.indexOf('service.', start + 20));
    assert.match(body, /visibleProjects\(actorIdOf\(auth\)/,
      `${route} does not scope to the projects the actor can see`);
    assert.match(body, /join visible on visible\.id = f\."projectId"/,
      `${route} does not join the visible-project filter`);
    assert.match(body, /'project\.read'/, `${route} does not require project.read`);
  }

  const crossProject = fs.readFileSync(
    path.join(__dirname, '../../lib/util/cross-project.js'), 'utf8');
  // The walk up actees.parent is what makes a grant on an organization reach
  // its projects; a flat match on projects."acteeId" shows an organization
  // member nothing. See test/db/cross-project-visibility.sql.
  assert.match(crossProject, /unnest\(ARRAY\[actees\.parent, actees\.species\]\)/);
  // Containment, not overlap: one role supplying project.read must not let a
  // listing through that also needs submission.read.
  assert.match(crossProject, /array_agg\(distinct granted\.verb\) @>/);
  // An unauthenticated request must match no project rather than every one.
  assert.match(crossProject, /orElse\(-1\)/);
});

test('the submission listing cannot be asked for an unbounded page', () => {
  const resource = fs.readFileSync(
    path.join(__dirname, '../../lib/resources/field-data.js'), 'utf8');
  const start = resource.indexOf("service.get('/field-data/submissions'");
  const body = resource.slice(start, resource.indexOf('service.', start + 20));
  const cap = /Math\.min\(Math\.max\(intParam\(query\.limit \?\? '(\d+)'\), 1\), (\d+)\)/.exec(body);
  assert.ok(cap != null, 'the page size is not clamped');
  assert.ok(Number(cap[1]) <= 500 && Number(cap[2]) <= 500,
    'a caller could ask for more rows than the server should serialise at once');
  assert.match(body, /offset = Math\.max\(intParam\(query\.offset \?\? '0'\), 0\)/,
    'a negative offset would reach past the start of the result set');
});

test('the project listing walks the actee chain rather than matching it flatly', () => {
  const projects = fs.readFileSync(
    path.join(__dirname, '../../lib/model/query/projects.js'), 'utf8');

  // The listing used to match assignments against
  // ('*', 'project', projects."acteeId"): the two species that happen to sit
  // above a Project, and nothing in between. A role granted on an organization
  // reached none of its Projects, so its members saw an empty list while
  // Auth.can() -- which has always walked the chain -- let them open each
  // Project by URL.
  assert.doesNotMatch(projects, /in \('\*', 'project', projects\."acteeId"\)/,
    'the flat actee match is back');
  assert.match(projects, /impliedProjectActees/,
    'the project listing no longer walks the actee chain');
  assert.match(projects, /@> array\['project\.read', 'form\.list'\]/,
    'the listing no longer requires the verbs it used to');
});
