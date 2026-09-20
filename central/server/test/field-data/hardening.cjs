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
const { deliver } = require('../../lib/worker/webhooks');

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
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await deliver(`http://webhook.test:${server.address().port}/`, Buffer.from('payload'), {});
    assert.equal(result.success, true, JSON.stringify(result));
    assert.equal(body, 'payload');
  } finally {
    dns.lookup = previous;
    http.globalAgent.destroy();
    http.globalAgent = previousAgent;
    await new Promise(resolve => server.close(resolve));
  }
});

const supabaseStore = fetch => {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../lib/external/field-data-storage.js'), 'utf8'), {
    require: name => name === 'config' ? { has: () => false } : require(name), module,
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
    for await (const chunk of options.body) { /* consume */ }
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
const service = Object.fromEntries(['get', 'post', 'patch', 'delete'].map(method => [method,
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
test('field-data queries do not name columns the schema dropped or never had', () => {
  // Comments in that file explain these very mistakes, so strip both comment
  // styles before scanning or the explanation trips the test.
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'lib', 'resources', 'field-data.js'), 'utf8')
    .split('\n')
    .filter(line => !/^\s*(\/\/|--)/.test(line))
    .join('\n');

  // forms.name was dropped in migration 20210423-02. A form's title lives on
  // its current definition, so these have to go through form_defs.
  const formsName = source.match(/\b(?:forms|f)\.name\b/g) || [];
  assert.deepEqual(formsName, [], `forms has no name column: ${formsName.join(', ')}`);

  // submissions has no currentDefId. The current version of a submission is
  // the submission_defs row flagged current.
  const submissionDef = source.match(/\bs\."currentDefId"/g) || [];
  assert.deepEqual(submissionDef, [],
    `submissions has no currentDefId; join submission_defs on current = true`);

  const formFieldDef = source.match(/\bff\."formDefId"/g) || [];
  assert.deepEqual(formFieldDef, [],
    `form_fields has schemaId, not formDefId; join through form_defs.schemaId`);
});

test('filtered dataset readers receive only declared columns without source-form access', async () => {
  const project = { id: 9 };
  const option = value => ({ isDefined: () => true, get: () => value });
  const permissions = [];
  const result = await routes.get('get /projects/:projectId/filtered-datasets/:id/data')({
    Projects: { getById: async () => option(project) },
    Forms: { getByProjectAndXmlFormId: async () => assert.fail('must not check source form') },
    db: {
      maybeOne: async () => option({
        id: 3, projectId: 9, formId: 7, currentDefId: 12,
        columns: ['/data/district'],
        query: [{ column: '/data/name', filter: '<>', value: '', condition: 'AND' }]
      }),
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
    db: {
      maybeOne: async () => option({
        id: 3, projectId: 9, formId: 7, columns: ['/data/district'],
        query: [{ column: '/data/name', filter: '<>', value: '', condition: 'AND' }]
      })
    }
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
    db: {
      maybeOne: async () => option({
        id: 3, projectId: 9, formId: 7, currentDefId: 12,
        columns: ['/data/district'],
        query: [{ column: '/data/name', filter: '<>', value: '', condition: 'AND' }]
      }),
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
    db: {
      maybeOne: async () => option({
        id: 3, projectId: 9, formId: 7, currentDefId: 12,
        columns: ['/data/district', '/data/hh_size'],
        query: [{ column: '/data/district', filter: '=', value: 'Bombali', condition: 'AND' }]
      }),
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
    db: {
      // The dataset shows district only; name is deliberately hidden.
      maybeOne: async () => option({
        id: 4, projectId: 9, formId: 7, currentDefId: 12,
        columns: ['/data/district'], query: []
      }),
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
    db: {
      maybeOne: async () => option({ id: 3, projectId: 9, name: 'Both rounds' }),
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

  for (const xmlFormIds of [['only-one'], [], ['same', 'same']]) {
    await assert.rejects(
      routes.get('post /projects/:projectId/merged-datasets')(container, {
        params: { projectId: '9' }, body: { name: 'x', xmlFormIds }, auth
      }),
      error => /at least two forms|list a form twice/.test(
        error.problemDetails?.reason ?? error.message
      ),
      `expected ${JSON.stringify(xmlFormIds)} to be refused`
    );
  }
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
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

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
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

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
      db: {
        maybeOne: async () => option({ id: 1, slug: 'agency-a', acteeId: 'org-actee' }),
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
  assert.ok(asked.includes('config.set'), 'still takes the site-wide right');
  assert.ok(asked.includes('project.update'), 'and the project right');
});

// Removing somebody from an organization revokes what the organization gave
// them and nothing else. A person may also hold a grant directly on one of its
// projects, and leaving the organization is not a statement about that.
test('removing an organization member revokes only the organization grant', async () => {
  const option = value => ({ isDefined: () => true, get: () => value });
  const deletes = [];
  await routes.get('delete /field-data/organizations/:slug/members/:actorId')({
    db: {
      maybeOne: async () => option({ id: 1, slug: 'agency-a', acteeId: 'org-actee' }),
      query: async query => { deletes.push({ sql: query.sql, values: query.values }); }
    }
  }, {
    params: { slug: 'agency-a', actorId: '11' },
    auth: { canOrReject: async () => {} }
  });

  assert.equal(deletes.length, 1);
  // Scoped to this organization's actee, not to the actor generally.
  assert.ok(deletes[0].sql.includes('"acteeId"'), deletes[0].sql);
  assert.ok(deletes[0].values.includes('org-actee'), JSON.stringify(deletes[0].values));
  assert.ok(deletes[0].values.includes(11), JSON.stringify(deletes[0].values));
});

test('backup routes require backup.run rather than project creation rights', async () => {
  for (const route of ['get /field-data/backups', 'post /field-data/backups', 'get /field-data/backups/:id/download']) {
    await assert.rejects(routes.get(route)({}, { auth: { canOrReject: async verb => {
      assert.equal(verb, 'backup.run');
      throw new Error('forbidden');
    } } }), /forbidden/);
  }
});

test('webhook creation rejects malformed and unsupported event settings before insertion', async () => {
  const previous = dns.lookup;
  dns.lookup = async () => [{ address: '8.8.8.8', family: 4 }];
  try {
    for (const events of [{}, 'submission.create', ['unknown.event']]) {
      await assert.rejects(routes.get('post /field-data/webhooks')({}, {
        auth: { canOrReject: async () => {} }, body: { name: 'test', url: 'https://example.test/', events }
      }), /supported webhook/);
    }
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
