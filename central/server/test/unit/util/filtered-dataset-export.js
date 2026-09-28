const Should = require('should'); // eslint-disable-line no-unused-vars
const ExcelJS = require('exceljs');
const { csvExport, xlsxExport, _csvSafe, _assertBounded } =
  require('../../../lib/util/filtered-dataset-export');
const { MAX_REPORT_ROWS } = require('../../../lib/util/xls-reports');

const source = {
  fields: [
    { path: '/data/name' },
    { path: '/data/cases' }
  ]
};
const rows = [{
  instanceId: 'uuid:one',
  submittedAt: new Date('2026-09-21T12:00:00.000Z'),
  data: { '/data/name': '=HYPERLINK("bad")', '/data/cases': 17 }
}];

describe('(util) filtered dataset export', () => {
  it('writes metadata and visible columns to CSV without formula injection', () => {
    const csv = csvExport(source, rows).toString('utf8');
    csv.should.startWith('\uFEFF_instance_id,_submitted_at,/data/name,/data/cases\r\n');
    csv.should.containEql("'=HYPERLINK");
    csv.should.containEql(',17\r\n');
  });

  it('neutralizes every spreadsheet formula prefix', () => {
    ['=x', '+x', '-x', '@x', '\tx', '\rx'].forEach(value =>
      _csvSafe(value).should.equal(`'${value}`));
    _csvSafe('ordinary').should.equal('ordinary');
  });

  it('writes a readable XLSX with a frozen, filtered header', async () => {
    const buffer = await xlsxExport(source, rows);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet('Filtered data');
    sheet.getRow(1).values.slice(1).should.eql([
      '_instance_id', '_submitted_at', '/data/name', '/data/cases'
    ]);
    sheet.getRow(2).getCell(1).value.should.equal('uuid:one');
    sheet.getRow(2).getCell(4).value.should.equal(17);
    sheet.views[0].ySplit.should.equal(1);
    sheet.autoFilter.should.be.ok();
  });

  it('refuses an unbounded export', () => {
    (() => _assertBounded(Array(MAX_REPORT_ROWS + 1)))
      .should.throw(/Add filters/);
  });
});
