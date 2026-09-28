// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

const ExcelJS = require('exceljs');
const Should = require('should'); // eslint-disable-line no-unused-vars
const { inspectTemplate, validateTemplate, renderTemplate } = require('../../../lib/util/xls-reports');
const { _coerceData } = require('../../../lib/util/xls-report-data');

const workbookBuffer = async (rows) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Report');
  rows.forEach(row => sheet.addRow(row));
  sheet.eachRow(row => {
    if (row.values.includes('{{/data/count}}')) Object.assign(row, { font: { bold: true } });
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
};

describe('(util) XLS reports', () => {
  it('writes declared numbers and dates as typed Excel values', () => {
    const values = _coerceData({
      '/data/count': '7', '/data/amount': '4.25', '/data/date': '2026-09-20',
      '/data/note': '007'
    }, [
      { path: '/data/count', type: 'int' },
      { path: '/data/amount', type: 'decimal' },
      { path: '/data/date', type: 'date' },
      { path: '/data/note', type: 'string' }
    ]);
    values['/data/count'].should.equal(7);
    values['/data/amount'].should.equal(4.25);
    values['/data/date'].should.be.instanceof(Date);
    values['/data/note'].should.equal('007');
  });

  it('inspects and validates scalar and detail placeholders', async () => {
    const input = await workbookBuffer([
      ['{{report_name}}'],
      ['{{#submissions}}'],
      ['{{_instance_id}}', '{{/data/district}}'],
      ['{{/submissions}}']
    ]);
    const inspection = await inspectTemplate(input);
    inspection.blocks.should.equal(1);
    inspection.placeholders.map(row => row.token).should.eql([
      'report_name', '_instance_id', '/data/district'
    ]);
    (() => validateTemplate(inspection, [{ path: '/data/district' }])).should.not.throw();
  });

  it('refuses an unknown field before storing the template', async () => {
    const input = await workbookBuffer([
      ['{{#submissions}}'], ['{{/data/secret}}'], ['{{/submissions}}']
    ]);
    const inspection = await inspectTemplate(input);
    (() => validateTemplate(inspection, [{ path: '/data/public' }]))
      .should.throw(/not a readable field/);
  });

  it('repeats one styled row and preserves typed whole-cell values', async () => {
    const input = await workbookBuffer([
      ['{{report_name}}', '{{submission_count}}'],
      ['{{#submissions}}'],
      ['{{_instance_id}}', '{{/data/count}}', 'District: {{/data/district}}'],
      ['{{/submissions}}']
    ]);
    const output = await renderTemplate(input, {
      name: 'Monthly report', sourceName: 'Survey', generatedAt: new Date('2026-09-20')
    }, [
      { instanceId: 'uuid:a', submittedAt: new Date('2026-09-18'),
        data: { '/data/count': 4, '/data/district': 'Bo' } },
      { instanceId: 'uuid:b', submittedAt: new Date('2026-09-19'),
        data: { '/data/count': 7, '/data/district': 'Kono' } }
    ]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(output);
    const sheet = workbook.getWorksheet('Report');
    sheet.getCell('A1').value.should.equal('Monthly report');
    sheet.getCell('B1').value.should.equal(2);
    sheet.getCell('A2').value.should.equal('uuid:a');
    sheet.getCell('B2').value.should.equal(4);
    sheet.getCell('C2').value.should.equal('District: Bo');
    sheet.getCell('A3').value.should.equal('uuid:b');
    sheet.getCell('B3').value.should.equal(7);
    sheet.getCell('C3').value.should.equal('District: Kono');
    sheet.getCell('A2').font.bold.should.equal(true);
    sheet.getCell('A3').font.bold.should.equal(true);
    Should(sheet.getCell('A4').value).be.null();
  });

  it('requires a single detail row between matched markers', async () => {
    const input = await workbookBuffer([
      ['{{#submissions}}'], ['one'], ['two'], ['{{/submissions}}']
    ]);
    await inspectTemplate(input).should.be.rejectedWith(/exactly one detail row/);
  });

  /*
  A Submission is allowed to contain braces, and the render used to run a
  second substitution pass over the rows it had just filled with answers. An
  unrecognised token resolves to nothing, so "Ward {{3}} clinic" came out as
  "Ward  clinic"; a recognised one substituted report metadata, so an answer
  of "{{report_name}}" came out as the report's own name. Silent both ways, in
  the one artifact where silent corruption matters most.
  */
  describe('answers that look like template tokens', () => {
    const templateWithBlock = async () => {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('R');
      sheet.getCell('A1').value = '{{report_name}}';
      sheet.getCell('A2').value = '{{#submissions}}';
      sheet.getCell('A3').value = '{{/district}}';
      sheet.getCell('B3').value = '{{_instance_id}}';
      sheet.getCell('A4').value = '{{/submissions}}';
      return Buffer.from(await workbook.xlsx.writeBuffer());
    };
    const render = async (answers) => {
      const out = await renderTemplate(await templateWithBlock(),
        { name: 'Q3 report', sourceName: 'Roster' },
        answers.map((district, index) => ({
          instanceId: `uuid:${index}`, submittedAt: new Date('2026-09-20T00:00:00Z'),
          data: { '/district': district }
        })));
      const back = new ExcelJS.Workbook();
      await back.xlsx.load(out);
      const sheet = back.getWorksheet('R');
      return answers.map((_, index) => sheet.getCell(2 + index, 1).value);
    };

    it('writes an answer containing braces exactly as it was given', async () => {
      (await render(['Ward {{3}} clinic'])).should.eql(['Ward {{3}} clinic']);
    });

    it('does not let an answer pull in the report\'s own values', async () => {
      (await render(['{{report_name}}'])).should.eql(['{{report_name}}']);
    });

    it('still fills ordinary answers, and the scalars outside the block', async () => {
      const rows = await render(['Bombali', 'Kono']);
      rows.should.eql(['Bombali', 'Kono']);
    });
  });
});
