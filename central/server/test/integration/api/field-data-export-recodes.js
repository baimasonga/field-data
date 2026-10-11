// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// S4 recode rules for exports through the real routes and the real export
// writer: docs/field-intelligence/S4-export-recodes.md

const should = require('should');
const yauzl = require('yauzl');
const { sql } = require('slonik');
const { testService } = require('../setup');
const { runExports } = require('../../../lib/worker/field-data-exports');

/* eslint-disable no-await-in-loop */

// Version 1 stored water as "borehole" and age at /old_age; version 2 uses
// "bh" and /age. /lights is a multiple choice in both; /kids a repeat.
const form = (version) => `<?xml version="1.0"?>
<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa">
  <h:head><h:title>Recoded</h:title><model>
    <instance><data id="recoded" version="${version}"><water/><lights/>${version === '1' ? '<old_age/>' : '<age/>'}<kids><kid_water/></kids><meta><instanceID/></meta></data></instance>
    <bind nodeset="/data/water" type="string"/>
    <bind nodeset="/data/lights" type="string"/>
    <bind nodeset="/data/${version === '1' ? 'old_age' : 'age'}" type="int"/>
    <bind nodeset="/data/kids/kid_water" type="string"/>
    <bind nodeset="/data/meta/instanceID" type="string" readonly="true()" calculate="concat('uuid:', uuid())"/>
  </model></h:head>
  <h:body>
    <select1 ref="/data/water"><label>Water</label><item><label>Borehole</label><value>${version === '1' ? 'borehole' : 'bh'}</value></item><item><label>Tap</label><value>tap</value></item></select1>
    <select ref="/data/lights"><label>Lights</label><item><label>Solar</label><value>solar</value></item><item><label>Torch</label><value>torch</value></item></select>
    <input ref="/data/${version === '1' ? 'old_age' : 'age'}"><label>Age</label></input>
    <group ref="/data/kids"><label>Kids</label><repeat nodeset="/data/kids"><input ref="/data/kids/kid_water"><label>Kid water</label></input></repeat></group>
  </h:body>
</h:html>`;
const base = '/v1/projects/1/forms/recoded';
const xml = (request, body) => request.send(body).set('Content-Type', 'application/xml');
const submit = (user, id, version, answers) => xml(user.post(`${base}/submissions`),
  `<data id="recoded" version="${version}"><meta><instanceID>uuid:${id}</instanceID></meta>${answers}</data>`).expect(200);
const binary = (request) => request.buffer(true).parse((res, callback) => {
  const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => callback(null, Buffer.concat(chunks))); res.on('error', callback);
});
const unzip = (buffer) => new Promise((resolve, reject) => {
  yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
    if (error) { reject(error); return; }
    const files = {};
    zip.on('entry', (entry) => zip.openReadStream(entry, (e, stream) => {
      if (e) { reject(e); return; }
      const chunks = []; stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => { files[entry.fileName] = Buffer.concat(chunks).toString('utf8'); zip.readEntry(); });
    }));
    zip.on('end', () => resolve(files)); zip.on('error', reject); zip.readEntry();
  });
});
// A CSV of simple values (no commas or quotes in this test's answers).
const table = (csv) => {
  const [header, ...lines] = csv.trim().split(/\r?\n/).map((l) => l.split(','));
  return lines.map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i]])));
};

const twoVersions = async (alice) => {
  await xml(alice.post('/v1/projects/1/forms?publish=true'), form('1')).expect(200);
  await submit(alice, 'old', '1', '<water>borehole</water><lights>solar torch</lights><old_age>40</old_age><kids><kid_water>borehole</kid_water></kids>');
  await xml(alice.post(`${base}/draft?ignoreWarnings=true`), form('2')).expect(200);
  await alice.post(`${base}/draft/publish`).expect(200);
  await submit(alice, 'new', '2', '<water>bh</water><lights>torch</lights><age>31</age>');
  return (await alice.get(base).expect(200)).body.id ?? null;
};
const formId = (c) => c.db.oneFirst(sql`SELECT id FROM forms WHERE "xmlFormId" = 'recoded'`);

describe('api: S4 recode rules for exports', () => {
  it('creates, lists and retires rules, refusing what cannot be applied', testService(async (service) => {
    const alice = await service.login('alice');
    await twoVersions(alice);
    const rule = (body, status) => alice.post(`${base}/recodes`).send({ reason: 'Code renamed in v2', ...body }).expect(status);
    const refused = async (body) => { (await rule(body, 400)).body.code.should.equal(400.64); };

    const value = (await rule({ kind: 'value', path: '/water', versions: ['1'], values: { borehole: 'bh' } }, 201)).body;
    value.should.containEql({ kind: 'value', path: '/water', fromPath: null, versions: ['1'], values: { borehole: 'bh' }, reason: 'Code renamed in v2' });
    const moved = (await rule({ kind: 'path', path: '/age', fromPath: '/old_age', versions: ['1'] }, 201)).body;

    await refused({ kind: 'value', path: '/old_age', versions: ['1'], values: { a: 'b' } }); // not in the current version
    await refused({ kind: 'value', path: '/kids', versions: ['1'], values: { a: 'b' } }); // a repeat
    await refused({ kind: 'value', path: '/water', versions: ['2'], values: { tap: 'pipe' } }); // the current version
    await refused({ kind: 'value', path: '/water', versions: ['9'], values: { tap: 'pipe' } }); // unknown version
    await refused({ kind: 'value', path: '/water', versions: [], values: { tap: 'pipe' } });
    await refused({ kind: 'value', path: '/water', versions: ['1', '1'], values: { tap: 'pipe' } });
    await refused({ kind: 'value', path: '/lights', versions: ['1'], values: { torch: 'torch' } }); // to itself
    await refused({ kind: 'value', path: '/lights', versions: ['1'], values: { 'battery torch': 'torch' } }); // a space
    await refused({ kind: 'value', path: '/lights', versions: ['1'], values: {} });
    await refused({ kind: 'value', path: '/lights', versions: ['1'] });
    await refused({ kind: 'value', path: '/lights', versions: ['1'], values: { a: 'b' }, fromPath: '/old_age' });
    await refused({ kind: 'path', path: '/age', fromPath: '/age', versions: ['1'] });
    await refused({ kind: 'path', path: '/age', fromPath: '/missing', versions: ['1'] });
    await refused({ kind: 'path', path: '/kids/kid_water', fromPath: '/water', versions: ['1'] }); // inside a repeat
    await refused({ kind: 'path', path: '/age', fromPath: '/old_age', versions: ['1'], values: { a: 'b' } });
    await refused({ kind: 'other', path: '/water', versions: ['1'], values: { a: 'b' } });
    await refused({ kind: 'value', path: '/water', versions: ['1'], values: { a: 'b' }, extra: true });
    (await alice.post(`${base}/recodes`).send({ kind: 'value', path: '/lights', versions: ['1'], values: { a: 'b' } }).expect(400)).body.code.should.equal(400.64); // no reason

    // One active rule of a kind per question and version.
    (await rule({ kind: 'value', path: '/water', versions: ['1'], values: { tap: 'pipe' } }, 409)).body.code.should.equal(409.42);

    const listed = (await alice.get(`${base}/recodes`).expect(200));
    listed.headers['cache-control'].should.equal('private, no-store');
    listed.body.active.map((r) => r.id).should.eql([moved.id, value.id]);
    listed.body.active[0].actorName.should.equal('Alice');
    listed.body.versions.map((v) => [v.version, v.current]).should.eql([['2', true], ['1', false]]);

    await alice.post(`${base}/recodes/${value.id}/retire`).send({}).expect(400);
    const retired = (await alice.post(`${base}/recodes/${value.id}/retire`).send({ reason: 'Wrong code' }).expect(200)).body;
    retired.retireReason.should.equal('Wrong code');
    (await alice.post(`${base}/recodes/${value.id}/retire`).send({ reason: 'Again' }).expect(409)).body.code.should.equal(409.42);
    await alice.post(`${base}/recodes/00000000-0000-4000-8000-000000000000/retire`).send({ reason: 'x' }).expect(404);
    const after = (await alice.get(`${base}/recodes`).expect(200)).body;
    after.active.map((r) => r.id).should.eql([moved.id]);
    after.retired.map((r) => r.id).should.eql([value.id]);
    // Retired, the question and version are free again.
    await rule({ kind: 'value', path: '/water', versions: ['1'], values: { borehole: 'bh' } }, 201);
  }));

  it('keeps rules append-only in the database', testService(async (service, c) => {
    const alice = await service.login('alice');
    await twoVersions(alice);
    const created = (await alice.post(`${base}/recodes`).send({ kind: 'value', path: '/water', versions: ['1'], values: { borehole: 'bh' }, reason: 'r' }).expect(201)).body;
    await c.db.query(sql`SAVEPOINT s`);
    await c.db.query(sql`UPDATE field_data_export_recodes SET "values" = '{"borehole":"x"}' WHERE id = ${created.id}`).should.be.rejected();
    await c.db.query(sql`ROLLBACK TO SAVEPOINT s`);
    await c.db.query(sql`DELETE FROM field_data_export_recodes WHERE id = ${created.id}`).should.be.rejected();
    await c.db.query(sql`ROLLBACK TO SAVEPOINT s`);
    await c.db.query(sql`UPDATE field_data_export_recodes SET "retiredAt" = now(), "retireReason" = 'x' WHERE id = ${created.id}`);
    await c.db.query(sql`UPDATE field_data_export_recodes SET "retireReason" = 'y' WHERE id = ${created.id}`).should.be.rejected();
    await c.db.query(sql`ROLLBACK TO SAVEPOINT s`);
  }));

  it('lets readers see rules and only managers change them', testService(async (service) => {
    const alice = await service.login('alice');
    const chelsea = await service.login('chelsea');
    const chelseaId = (await chelsea.get('/v1/users/current').expect(200)).body.id;
    await twoVersions(alice);
    await chelsea.get(`${base}/recodes`).expect(403);
    await alice.post(`/v1/projects/1/assignments/viewer/${chelseaId}`).expect(200);
    await chelsea.get(`${base}/recodes`).expect(200);
    await chelsea.post(`${base}/recodes`).send({ kind: 'value', path: '/water', versions: ['1'], values: { borehole: 'bh' }, reason: 'r' }).expect(403);
    await alice.get('/v1/projects/1/forms/nothing/recodes').expect(404);
  }));

  it('applies active rules to exports by version, states them in the manifest, and exports as stored on request', testService(async (service, c) => {
    const alice = await service.login('alice');
    await twoVersions(alice);
    const id = await formId(c);
    await alice.post(`${base}/recodes`).send({ kind: 'value', path: '/water', versions: ['1'], values: { borehole: 'bh' }, reason: 'Renamed' }).expect(201);
    await alice.post(`${base}/recodes`).send({ kind: 'value', path: '/lights', versions: ['1'], values: { torch: 'battery_torch' }, reason: 'Renamed' }).expect(201);
    await alice.post(`${base}/recodes`).send({ kind: 'path', path: '/age', fromPath: '/old_age', versions: ['1'], reason: 'Moved' }).expect(201);
    await alice.post(`${base}/recodes`).send({ kind: 'value', path: '/kids/kid_water', versions: ['1'], values: { borehole: 'bh' }, reason: 'Renamed' }).expect(201);
    const selection = { source: { kind: 'form', id }, columns: ['/water', '/lights', '/age'] };

    const files = await unzip((await binary(alice.post('/v1/projects/1/analysis/export/csv').send(selection)).expect(200)).body);
    const rows = Object.fromEntries(table(files['submissions.csv']).map((r) => [r.instance_id, r]));
    rows['uuid:old'].should.containEql({ '/water': 'bh', '/lights': 'solar battery_torch', '/age': '40' });
    rows['uuid:new'].should.containEql({ '/water': 'bh', '/lights': 'torch', '/age': '31' });
    table(Object.entries(files).find(([name]) => name.startsWith('repeat_'))[1])[0]['/kids/kid_water'].should.equal('bh');
    const manifest = JSON.parse(files['manifest.json']);
    manifest.recodes.applied.should.equal(true);
    manifest.recodes.rules.map((r) => [r.path, r.changed]).should.eql([['/water', 1], ['/lights', 1], ['/age', 1], ['/kids/kid_water', 1]]);

    const stored = await unzip((await binary(alice.post('/v1/projects/1/analysis/export/csv').send({ ...selection, recodes: false })).expect(200)).body);
    table(stored['submissions.csv']).find((r) => r.instance_id === 'uuid:old').should.containEql({ '/water': 'borehole', '/age': '' });
    JSON.parse(stored['manifest.json']).recodes.should.eql({ applied: false, rules: [] });
    (await alice.post('/v1/projects/1/analysis/export/csv').send({ ...selection, recodes: 'no' }).expect(400)).body.message.should.match(/true or false/);
  }));

  it('freezes the rules into a queued export', testService(async (service, c) => {
    const alice = await service.login('alice');
    await twoVersions(alice);
    const id = await formId(c);
    const rule = (await alice.post(`${base}/recodes`).send({ kind: 'value', path: '/water', versions: ['1'], values: { borehole: 'bh' }, reason: 'Renamed' }).expect(201)).body;
    const { body: job } = await alice.post('/v1/projects/1/analysis/jobs').send({ source: { kind: 'form', id }, columns: ['/water'], format: 'csv' }).expect(200);
    // Retired after the job was queued: the job keeps the rule it was created with.
    await alice.post(`${base}/recodes/${rule.id}/retire`).send({ reason: 'Later change' }).expect(200);
    const payloads = [];
    const write = async (payload) => { payloads.push(payload); return { buffer: Buffer.from('part'), type: 'text/csv' }; };
    const objects = new Map();
    const storage = { putStream: async (key, stream) => { const chunks = []; for await (const chunk of stream) chunks.push(chunk); objects.set(key, Buffer.concat(chunks)); }, delete: async () => {} };
    await runExports({ connect: (work) => work(c.db) }, { write, storage });
    (await c.db.oneFirst(sql`SELECT status FROM field_data_export_jobs WHERE id = ${job.id}`)).should.equal('Success');
    payloads.length.should.equal(1);
    payloads[0].recodes.rules.map((r) => r.id).should.eql([rule.id]);
    payloads[0].rows.map((r) => [r.instanceId, r.formVersion]).sort().should.eql([['uuid:new', '2'], ['uuid:old', '1']]);
    should.exist(objects.get(`exports/${job.id}.zip`));
  }));
});
