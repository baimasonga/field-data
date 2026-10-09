// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
//
// XLSForm and XForms XML uploads through Central's own routes. The XLSForm
// cases run against the real form compiler (pyxform + ODK Validate), which CI
// starts on FORM_COMPILER_PORT (default 5001). Where no compiler is listening
// they are skipped, unless REQUIRE_FORM_COMPILER is set, so a missing compiler
// or a missing Java cannot pass unnoticed in CI.
const { strict: assert } = require('assert');
const http = require('http');
const ExcelJS = require('exceljs');
const xlsform = require('../../../lib/external/xlsform');
const { testServiceWith } = require('../setup');
const testData = require('../../data/xml');

const port = Number(process.env.FORM_COMPILER_PORT ?? 5001);
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const readiness = () => new Promise((resolve) => {
  http.get({ host: '127.0.0.1', port, path: '/readyz', timeout: 3000 }, (res) => {
    res.resume();
    res.on('end', () => resolve(res.statusCode));
  }).on('error', () => resolve(0)).on('timeout', function onTimeout() { this.destroy(); });
});

const workbook = async (sheets) => {
  const book = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    const sheet = book.addWorksheet(name);
    rows.forEach((row) => sheet.addRow(row));
  }
  return Buffer.from(await book.xlsx.writeBuffer());
};

const HEADER = ['type', 'name', 'label', 'relevant', 'constraint', 'constraint_message', 'required'];
const household = () => workbook({
  survey: [
    HEADER,
    ['text', 'respondent', 'Respondent name', '', '', '', 'yes'],
    ['integer', 'age', 'Age', '', '. >= 0 and . <= 120', 'Age must be between 0 and 120', ''],
    ['select_one yn', 'has_children', 'Does the household have children?', '', '', '', ''],
    // eslint-disable-next-line no-template-curly-in-string
    ['begin repeat', 'children', 'Children', '${has_children} = "yes"', '', '', ''],
    ['text', 'child_name', 'Child name', '', '', '', 'yes'],
    ['end repeat', '', '', '', '', '', ''],
    ['geopoint', 'location', 'Household location', '', '', '', '']
  ],
  choices: [['list_name', 'name', 'label'], ['yn', 'yes', 'Yes'], ['yn', 'no', 'No']],
  settings: [['form_title', 'form_id'], ['Household survey', 'household']]
});
const undefinedReference = () => workbook({
  // eslint-disable-next-line no-template-curly-in-string
  survey: [HEADER, ['text', 'respondent', 'Respondent name', "${no_such_question} = 'x'", '', '', '']],
  settings: [['form_title', 'form_id'], ['Broken', 'broken']]
});

const submission = (instanceId) => `<data id="household"><meta><instanceID>${instanceId}</instanceID></meta>`
  + '<respondent>Ada</respondent><age>34</age><has_children>yes</has_children>'
  + '<children><child_name>Bo</child_name></children><children><child_name>Cy</child_name></children>'
  + '<location>7.5 -11.7 0 5</location></data>';

const upload = (alice, path, body, type, headers = {}) => {
  let request = alice.post(path).set('Content-Type', type);
  for (const [name, value] of Object.entries(headers)) request = request.set(name, value);
  return request.send(body);
};

describe('api: XLSForm and XForms XML upload pipeline', () => {
  describe('XLSForm through the real compiler', () => {
    let real;
    before(async function waitForCompiler() {
      this.timeout(10000);
      const status = await readiness();
      if (status === 200) { real = xlsform.init({ host: '127.0.0.1', port }); return; }
      if (process.env.REQUIRE_FORM_COMPILER) {
        throw new Error(`The form compiler on port ${port} is not ready (readyz answered ${status}). `
          + 'It needs Java for ODK Validate; install it or start the compiler.');
      }
      this.skip();
    });

    const withCompiler = (test) => testServiceWith({ xlsform: (...args) => real(...args) }, test);

    it('compiles, publishes and accepts submissions for a form with skip logic, constraints, a repeat and GPS',
      withCompiler(async (service) => {
        const alice = await service.login('alice');
        const created = await upload(alice, '/v1/projects/1/forms?publish=true&ignoreWarnings=true',
          await household(), XLSX, { 'X-XlsForm-FormId-Fallback': 'household' }).expect(200);
        assert.equal(created.body.xmlFormId, 'household');
        assert.notEqual(created.body.publishedAt, null);

        const xml = (await alice.get('/v1/projects/1/forms/household.xml').expect(200)).text;
        assert.match(xml, /relevant="[^"]*has_children[^"]*yes/, 'skip logic');
        assert.match(xml, /constraint="\. &gt;= 0 and \. &lt;= 120"/, 'constraint');
        assert.match(xml, /constraintMsg="Age must be between 0 and 120"/, 'constraint message');
        assert.match(xml, /<repeat nodeset="\/data\/children"/, 'repeat group');
        assert.match(xml, /type="geopoint"/, 'GPS question');

        const fields = (await alice.get('/v1/projects/1/forms/household/fields?odata=true').expect(200)).body;
        const byPath = Object.fromEntries(fields.map((field) => [field.path, field.type]));
        assert.equal(byPath['/age'], 'int');
        assert.equal(byPath['/location'], 'geopoint');
        assert.equal(byPath['/children'], 'repeat');

        await upload(alice, '/v1/projects/1/forms/household/submissions', submission('uuid:pipeline-1'),
          'application/xml').expect(200);
        const rows = (await alice.get('/v1/projects/1/forms/household.svc/Submissions').expect(200)).body.value;
        assert.equal(rows.length, 1);
        assert.equal(rows[0].age, 34);
        assert.deepEqual(rows[0].location.coordinates.slice(0, 2), [-11.7, 7.5]);
        const children = (await alice.get('/v1/projects/1/forms/household.svc/Submissions.children').expect(200)).body.value;
        assert.deepEqual(children.map((child) => child.child_name).sort(), ['Bo', 'Cy']);
      }));

    it('creates a draft first and publishes it as a separate step', withCompiler(async (service) => {
      const alice = await service.login('alice');
      const draft = await upload(alice, '/v1/projects/1/forms?ignoreWarnings=true', await household(), XLSX,
        { 'X-XlsForm-FormId-Fallback': 'household' }).expect(200);
      assert.equal(draft.body.publishedAt, null);
      await alice.post('/v1/projects/1/forms/household/draft/publish').expect(200);
      const form = (await alice.get('/v1/projects/1/forms/household').expect(200)).body;
      assert.notEqual(form.publishedAt, null);
    }));

    it('rejects a spreadsheet with an undefined reference as an invalid XLSForm, and says what is wrong',
      withCompiler(async (service) => {
        const alice = await service.login('alice');
        const response = await upload(alice, '/v1/projects/1/forms?publish=true', await undefinedReference(), XLSX,
          { 'X-XlsForm-FormId-Fallback': 'broken' }).expect(400);
        assert.equal(response.body.code, 400.15);
        assert.equal(response.body.details.kind, 'invalid-xlsform');
        assert.match(response.body.details.error, /no_such_question/);
        await alice.get('/v1/projects/1/forms/broken').expect(404);
      }));

    it('rejects a spreadsheet with an unknown question type without creating a form', withCompiler(async (service) => {
      const alice = await service.login('alice');
      const bad = await workbook({ survey: [HEADER, ['not_a_real_type', 'q', 'Question', '', '', '', '']],
        settings: [['form_title', 'form_id'], ['Bad type', 'bad_type']] });
      const response = await upload(alice, '/v1/projects/1/forms?publish=true', bad, XLSX,
        { 'X-XlsForm-FormId-Fallback': 'bad_type' }).expect(400);
      assert.equal(response.body.code, 400.15);
      assert.equal(response.body.details.kind, 'invalid-xlsform');
      await alice.get('/v1/projects/1/forms/bad_type').expect(404);
    }));

    it('reports the compiler as ready only when it can really validate', async () => {
      assert.equal(await readiness(), 200);
    });
  });

  describe('XForms XML upload (no compiler involved)', () => {
    // The shared fixtures already own the form id `simple`, so use a fresh one.
    const xmlForm = testData.forms.simple.replace('<data id="simple">', '<data id="xml_pipeline">');
    const xmlInstance = testData.instances.simple.one.replace('id="simple"', 'id="xml_pipeline"');
    const neverCompile = () => { throw new Error('An XML upload must not call the XLSForm compiler.'); };
    const xmlOnly = (test) => testServiceWith({ xlsform: neverCompile }, test);

    it('registers, publishes and accepts submissions for a valid XForms XML file', xmlOnly(async (service) => {
      const alice = await service.login('alice');
      const created = await upload(alice, '/v1/projects/1/forms?publish=true', xmlForm, 'application/xml')
        .expect(200);
      assert.equal(created.body.xmlFormId, 'xml_pipeline');
      assert.notEqual(created.body.publishedAt, null);
      await upload(alice, '/v1/projects/1/forms/xml_pipeline/submissions', xmlInstance, 'application/xml')
        .expect(200);
      const rows = (await alice.get('/v1/projects/1/forms/xml_pipeline.svc/Submissions').expect(200)).body.value;
      assert.equal(rows.length, 1);
    }));

    it('follows the draft and publish pathway like any other form', xmlOnly(async (service) => {
      const alice = await service.login('alice');
      const draft = await upload(alice, '/v1/projects/1/forms', xmlForm, 'application/xml').expect(200);
      assert.equal(draft.body.publishedAt, null);
      await alice.post('/v1/projects/1/forms/xml_pipeline/draft/publish').expect(200);
      assert.notEqual((await alice.get('/v1/projects/1/forms/xml_pipeline').expect(200)).body.publishedAt, null);
    }));

    it('rejects malformed XML with an explanatory problem instead of storing it', xmlOnly(async (service) => {
      const alice = await service.login('alice');
      const response = await upload(alice, '/v1/projects/1/forms?publish=true', '<h:html><unclosed>', 'application/xml')
        .expect(400);
      assert.equal(typeof response.body.code, 'number');
      assert.equal(typeof response.body.message, 'string');
      assert(response.body.message.length > 0);
      assert.deepEqual((await alice.get('/v1/projects/1/forms').expect(200)).body.filter((f) => f.xmlFormId === 'unclosed'), []);
    }));

    it('rejects an XForm that declares no form id', xmlOnly(async (service) => {
      const alice = await service.login('alice');
      const noId = xmlForm.replace('<data id="xml_pipeline">', '<data>');
      const response = await upload(alice, '/v1/projects/1/forms?publish=true', noId, 'application/xml').expect(400);
      assert.equal(typeof response.body.message, 'string');
    }));

    it('refuses a duplicate form id with a conflict, not a compiler error', xmlOnly(async (service) => {
      const alice = await service.login('alice');
      await upload(alice, '/v1/projects/1/forms?publish=true', xmlForm, 'application/xml').expect(200);
      const response = await upload(alice, '/v1/projects/1/forms?publish=true', xmlForm, 'application/xml')
        .expect(409);
      assert.equal(response.body.code, 409.3);
    }));
  });

  describe('compiler failures are reported as what they are', () => {
    const stub = (reply) => new Promise((resolve) => {
      const server = http.createServer((req, res) => {
        req.resume();
        req.on('end', () => {
          res.statusCode = reply.status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(reply.body));
        });
      });
      server.listen(0, '127.0.0.1', () => resolve(server));
    });
    const sheet = () => workbook({ survey: [HEADER, ['text', 'q', 'Question', '', '', '', '']] });

    it('a validator that cannot run is a 502 about the server, never a 400 about the file', async function stubbed() {
      const server = await stub({ status: 503, body: { error: 'no java', errorCode: 'validator-unavailable' } });
      try {
        const compiler = xlsform.init({ host: '127.0.0.1', port: server.address().port });
        await testServiceWith({ xlsform: compiler }, async (service) => {
          const alice = await service.login('alice');
          const response = await upload(alice, '/v1/projects/1/forms', await sheet(), XLSX,
            { 'X-XlsForm-FormId-Fallback': 'q' }).expect(502);
          assert.equal(response.body.code, 502.4);
          assert.match(response.body.message, /Java/);
          assert.match(response.body.message, /not rejected/);
          await alice.get('/v1/projects/1/forms/q').expect(404);
        }).call(this);
      } finally { server.close(); }
    });

    it('an unreachable compiler is a 502 with its own code', async function unreachable() {
      const server = await stub({ status: 200, body: {} });
      const closedPort = server.address().port;
      await new Promise((resolve) => { server.close(resolve); });
      await testServiceWith({ xlsform: xlsform.init({ host: '127.0.0.1', port: closedPort }) }, async (service) => {
        const alice = await service.login('alice');
        const response = await upload(alice, '/v1/projects/1/forms', await sheet(), XLSX,
          { 'X-XlsForm-FormId-Fallback': 'q' }).expect(502);
        assert.equal(response.body.code, 502.2);
      }).call(this);
    });

    it('an XForm the validator rejects is reported as a compile failure with the validator output',
      async function rejected() {
        const server = await stub({ status: 400, body: { error: 'ODK Validate Errors: bad bind', errorCode: 'compile-failed' } });
        try {
          await testServiceWith({ xlsform: xlsform.init({ host: '127.0.0.1', port: server.address().port }) }, async (service) => {
            const alice = await service.login('alice');
            const response = await upload(alice, '/v1/projects/1/forms', await sheet(), XLSX,
              { 'X-XlsForm-FormId-Fallback': 'q' }).expect(400);
            assert.equal(response.body.code, 400.15);
            assert.equal(response.body.details.kind, 'compile-failed');
            assert.match(response.body.details.error, /bad bind/);
          }).call(this);
        } finally { server.close(); }
      });
  });
});
