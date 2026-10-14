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

  it('keeps a form\'s active rules within 200 KB, and an export\'s rules within 2 MB', testService(async (service, c) => {
    const alice = await service.login('alice');
    await twoVersions(alice);
    // 200 values of 200 characters each: about 80 KB per rule.
    const big = (prefix) => Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`${prefix}${i}`.padEnd(200, 'x'), `${prefix}${i}`.padEnd(200, 'y')]));
    const rule = (path, values) => alice.post(`${base}/recodes`).send({ kind: 'value', path, versions: ['1'], values, reason: 'Big' });
    await rule('/water', big('a')).expect(201);
    await rule('/lights', big('b')).expect(201);
    const refused = (await rule('/kids/kid_water', big('c')).expect(400)).body;
    refused.code.should.equal(400.64);
    refused.message.should.match(/200 KB/);
    await rule('/kids/kid_water', { borehole: 'bh' }).expect(201);

    // Rules written another way are still bounded at export time.
    const id = await formId(c);
    const huge = JSON.stringify(Object.fromEntries(Array.from({ length: 12000 }, (_, i) => [`k${i}`.padEnd(100, 'x'), `v${i}`.padEnd(100, 'y')])));
    await c.db.query(sql`INSERT INTO field_data_export_recodes ("projectId", "formId", kind, path, versions, "values", reason)
      VALUES (1, ${id}, 'value', '/age', ARRAY['1'], ${huge}, 'Huge')`);
    const tooBig = (await alice.post('/v1/projects/1/analysis/export/csv').send({ source: { kind: 'form', id }, columns: ['/water'] }).expect(400)).body;
    tooBig.message.should.match(/exceed 2 MB/);
    await binary(alice.post('/v1/projects/1/analysis/export/csv').send({ source: { kind: 'form', id }, columns: ['/water'], recodes: false })).expect(200);
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
  it('recodes screen rows, numeric charts and repeat rows once while filters keep stored semantics', testService(async (service, c) => {
    const alice = await service.login('alice'); await twoVersions(alice); const id = await formId(c);
    await submit(alice, 'both', '1', '<water>borehole</water><age>55</age><old_age>40</old_age>');
    const rule = body => alice.post(`${base}/recodes`).send({ reason: 'Approved version alignment', versions: ['1'], ...body }).expect(201);
    const water = (await rule({ kind: 'value', path: '/water', values: { borehole: 'bh', bh: 'different' } })).body;
    await rule({ kind: 'value', path: '/lights', values: { torch: 'battery_torch' } });
    await rule({ kind: 'path', path: '/age', fromPath: '/old_age' }); await rule({ kind: 'value', path: '/age', values: { 40: '41' } });
    await rule({ kind: 'value', path: '/kids/kid_water', values: { borehole: 'bh' } });
    const definition = { source: { kind: 'form', id }, columns: ['/water', '/lights', '/age'], recodes: true,
      chart: { column: '/age', groupBy: '/water', aggregation: 'sum' } };
    const query = body => alice.post('/v1/projects/1/analysis/query').send(body).expect(200);
    const screen = (await query(definition)).body; const rows = Object.fromEntries(screen.rows.map(row => [row.instanceId, row.data]));
    rows['uuid:old'].should.containEql({ '/water': 'bh', '/lights': 'solar battery_torch', '/age': '41' });
    rows['uuid:both']['/age'].should.equal('55'); rows['uuid:new']['/age'].should.equal('31');
    screen.chart.rows.should.eql([{ key: 'bh', count: 3, value: 127 }]); screen.recodes.applied.should.equal(true);
    screen.recodes.rules.length.should.equal(4); should.not.exist(screen.definition._recodeRuleIds);
    const stored = (await query({ ...definition, recodes: false })).body;
    should(stored.rows.find(row => row.instanceId === 'uuid:old').data['/age']).equal(null);
    stored.recodes.applied.should.equal(false);
    const filtered = (await query({ ...definition, query: [{ column: '/water', filter: '=', value: 'borehole' }] })).body;
    filtered.total.should.equal(2); filtered.chart.rows.should.eql([{ key: 'bh', count: 2, value: 96 }]);
    const repeat = (await query({ ...definition, columns: ['/kids/kid_water'], repeatPath: '/kids', chart: { column: '/kids/kid_water', aggregation: 'count' } })).body;
    repeat.rows[0].data['/kids/kid_water'].should.equal('bh'); repeat.rows[0].repeatIndex.should.equal(1);
    const csv = await unzip((await binary(alice.post('/v1/projects/1/analysis/export/csv').send(definition)).expect(200)).body);
    table(csv['submissions.csv']).find(row => row.instance_id === 'uuid:old')['/water'].should.equal('bh');
    await alice.post(`${base}/recodes/${water.id}/retire`).send({ reason: 'Retire test rule' }).expect(200);
    (await query(definition)).body.rows.find(row => row.instanceId === 'uuid:old').data['/water'].should.equal('borehole');
    await alice.post('/v1/projects/1/analysis/query').send({ ...definition, recodes: 'yes' }).expect(400);
  }));

  it('keeps moved source paths outside delegated datasets while recoding visible values', testService(async (service, c) => {
    const alice = await service.login('alice'); await twoVersions(alice); const id = await formId(c);
    await alice.post(`${base}/recodes`).send({ kind: 'value', path: '/water', versions: ['1'], values: { borehole: 'bh' }, reason: 'Code alignment' }).expect(201);
    await alice.post(`${base}/recodes`).send({ kind: 'path', path: '/age', fromPath: '/old_age', versions: ['1'], reason: 'Moved question' }).expect(201);
    const dataset = await c.db.one(sql`INSERT INTO field_data_filtered_datasets (name, "projectId", "formId", columns, query)
      VALUES ('Delegated current questions', 1, ${id}, '["/water", "/age"]', '[]') RETURNING id`);
    const screen = (await alice.post('/v1/projects/1/analysis/query').send({ source: { kind: 'filtered', id: dataset.id }, columns: ['/water', '/age'], recodes: true }).expect(200)).body;
    const old = screen.rows.find(row => row.instanceId === 'uuid:old'); old.data['/water'].should.equal('bh'); should(old.data['/age']).equal(null);
    screen.recodes.skippedPathRules.should.equal(1); screen.recodes.rules.length.should.equal(1);
    JSON.stringify(screen).should.not.containEql('/old_age');
    const files = await unzip((await binary(alice.post('/v1/projects/1/analysis/export/csv').send({ source: { kind: 'filtered', id: dataset.id }, columns: ['/water', '/age'], recodes: true })).expect(200)).body);
    const exported = table(files['submissions.csv']).find(row => row.instance_id === 'uuid:old');
    exported['/water'].should.equal('bh'); exported['/age'].should.equal('');
    JSON.stringify(JSON.parse(files['manifest.json'])).should.not.containEql('/old_age');

  }));

  it('recodes moved locations for the full map selection without requiring a visible geometry column', testService(async (service, c) => {
    const alice = await service.login('alice');
    const geo = v => form(v).replace(v === '1' ? '<old_age/>' : '<age/>', `${v === '1' ? '<old_age/>' : '<age/>'}<${v === '1' ? 'old_point' : 'point'}/>`)
      .replace('<bind nodeset="/data/lights"', `<bind nodeset="/data/${v === '1' ? 'old_point' : 'point'}" type="geopoint"/><bind nodeset="/data/lights"`);
    await xml(alice.post('/v1/projects/1/forms?publish=true'), geo('1')).expect(200);
    await submit(alice, 'oldgeo', '1', '<water>borehole</water><old_point>8.4 -13.2 0 4</old_point>');
    await xml(alice.post(`${base}/draft?ignoreWarnings=true`), geo('2')).expect(200); await alice.post(`${base}/draft/publish`).expect(200);
    await submit(alice, 'newgeo', '2', '<water>bh</water><point>8.5 -13.1 0 4</point>');
    await alice.post(`${base}/recodes`).send({ kind: 'path', path: '/point', fromPath: '/old_point', versions: ['1'], reason: 'Location moved' }).expect(201);
    const definition = { source: { kind: 'form', id: await formId(c) }, columns: ['/water'], geometry: '/point', recodes: true };
    const mapped = (await alice.post('/v1/projects/1/analysis/query').send(definition).expect(200)).body;
    mapped.map.features.length.should.equal(2); mapped.map.features.find(f => f.properties.instanceId === 'uuid:oldgeo').geometry.coordinates.should.eql([-13.2, 8.4]);
    mapped.rows[0].data.should.not.have.property('/point');
    (await alice.post('/v1/projects/1/analysis/query').send({ ...definition, recodes: false }).expect(200)).body.map.features.length.should.equal(1);
  }));

  it('reads XML text as plain stored answers so entity-containing codes and filters align with exports', testService(async (service, c) => {
    const alice = await service.login('alice'); await twoVersions(alice); const id = await formId(c);
    await submit(alice, 'entities', '1', '<water>a&amp;b</water><lights>torch</lights>');
    await alice.post(`${base}/recodes`).send({ kind: 'value', path: '/water', versions: ['1'], values: { 'a&b': 'bh' }, reason: 'Align entity-containing code' }).expect(201);
    const definition = { source: { kind: 'form', id }, columns: ['/water'], query: [{ column: '/water', filter: '=', value: 'a&b' }] };
    const stored = (await alice.post('/v1/projects/1/analysis/query').send(definition).expect(200)).body;
    stored.total.should.equal(1); stored.rows[0].data['/water'].should.equal('a&b');
    (await alice.post('/v1/projects/1/analysis/query').send({ ...definition, recodes: true }).expect(200)).body.rows[0].data['/water'].should.equal('bh');
  }));

});
