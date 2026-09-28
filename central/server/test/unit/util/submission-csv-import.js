// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

require('should');
const { Submission } = require('../../../lib/model/frames');
const { importableFields, templateCsv, validationHash, inspectCsv,
  submissionXml } = require('../../../lib/util/submission-csv-import');

const fields = [
  { path: '/name', type: 'string', binary: false },
  { path: '/age', type: 'int', binary: false },
  { path: '/visit/location', type: 'geopoint', binary: false },
  { path: '/photo', type: 'binary', binary: true },
  { path: '/household', type: 'repeat', binary: false },
  { path: '/household/member', type: 'string', binary: false },
  { path: '/meta/instanceID', type: 'string', binary: false }
];

describe('submission csv import', () => {
  it('offers only safe, non-repeat leaf fields', () => {
    importableFields(fields).map(field => field.path).should.eql([
      '/name', '/age', '/visit/location'
    ]);
    templateCsv(fields).should.match(/^\uFEFF\/name,\/age,\/visit\/location/);
  });

  it('validates rows and reports the CSV row and field', () => {
    const result = inspectCsv(Buffer.from('/name,/age,/visit/location\nAna,nope,91 2\n'), fields, 7);
    result.rows.should.equal(1);
    result.validRows.should.equal(0);
    result.errors.should.eql([
      { row: 2, field: '/age', message: 'must be a whole number' },
      { row: 2, field: '/visit/location', message: 'must contain latitude and longitude' }
    ]);
  });

  it('rejects unknown, binary, repeat, and duplicate headers', () => {
    const result = inspectCsv(Buffer.from('/name,/name,/photo,/household/member,/unknown\na,b,c,d,e\n'), fields, 7);
    result.validRows.should.equal(0);
    result.errors.map(error => error.field).should.eql([
      '/name', '/photo', '/household/member', '/unknown'
    ]);
  });

  it('binds validation to the exact bytes and Form definition', () => {
    const csv = Buffer.from('/name\nAna\n');
    validationHash(csv, 7).should.not.equal(validationHash(Buffer.from('/name\nBob\n'), 7));
    validationHash(csv, 7).should.not.equal(validationHash(csv, 8));
  });

  it('builds parseable nested submission XML and escapes values', async () => {
    const form = { xmlFormId: 'people', def: { version: 'v1' } };
    const inspected = inspectCsv(
      Buffer.from('/name,/age,/visit/location\n"A & B",12,"1.2 3.4"\n'), fields, 7
    );
    inspected.errors.should.be.empty();
    const xml = submissionXml(form, inspected.submissions[0]);
    xml.should.containEql('<name>A &amp; B</name>');
    xml.should.containEql('<visit><location>1.2 3.4</location></visit>');
    const partial = await Submission.fromXml(Buffer.from(xml));
    partial.xmlFormId.should.equal('people');
    partial.def.version.should.equal('v1');
    partial.instanceId.should.match(/^uuid:/);
  });
});
