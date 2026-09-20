const Should = require('should'); // eslint-disable-line no-unused-vars
const googleSheets = require('../../../lib/util/rest-targets/google-sheets');

const config = {
  spreadsheetId: 'sheet/id',
  sheetName: "Today's data",
  clientId: 'client-id',
  clientSecret: 'client-secret',
  refreshToken: 'refresh-token'
};

describe('(util) Google Sheets target', () => {
  it('converts a column count to an A1 column name', () => {
    googleSheets._columnName(1).should.equal('A');
    googleSheets._columnName(26).should.equal('Z');
    googleSheets._columnName(27).should.equal('AA');
  });

  it('exchanges the refresh token in a form body rather than a URL', () => {
    const request = googleSheets.buildTokenRequest(config);
    request.method.should.equal('POST');
    request.url.should.equal('https://oauth2.googleapis.com/token');
    request.url.should.not.containEql(config.clientSecret);
    const params = new URLSearchParams(request.body.toString());
    params.get('client_id').should.equal(config.clientId);
    params.get('client_secret').should.equal(config.clientSecret);
    params.get('refresh_token').should.equal(config.refreshToken);
  });

  // `A:A` asks for the whole column, and the worker keeps at most a megabyte
  // of a response. At about 46 bytes per quoted instance ID that put a hard
  // stop at roughly 22,000 rows, where the JSON came back truncated and every
  // later delivery failed on a parse error that said nothing about size.
  it('reads the instance-ID column in bounded windows, not all of it', () => {
    const request = googleSheets.buildLookupRequest(config, 'access-token');
    request.method.should.equal('GET');
    request.url.should.not.containEql(encodeURIComponent('A:A'));
    request.url.should.containEql(
      encodeURIComponent(`'Today''s data'!A1:A${googleSheets.LOOKUP_BATCH}`)
    );
    request.headers.Authorization.should.equal('Bearer access-token');
    // Ten thousand IDs is about 460 KB, well inside the cap.
    (googleSheets.LOOKUP_BATCH * 46).should.be.below(1024 * 1024);
  });

  it('asks for the next window where the last one stopped', () => {
    const request = googleSheets.buildLookupRequest(config, 'access-token',
      { offset: 10000, limit: 10000 });
    request.url.should.containEql(encodeURIComponent("'Today''s data'!A10001:A20000"));
  });

  it('reads a single cell when there is nothing to search for', () => {
    // An integration that does not synchronize updates only needs to know
    // whether the worksheet is empty.
    const request = googleSheets.buildLookupRequest(config, 'access-token',
      { offset: 0, limit: 1 });
    request.url.should.containEql(encodeURIComponent("'Today''s data'!A1:A1"));
  });

  it('finds the one-based row for an existing instance', () => {
    const found = googleSheets.analyseLookup(JSON.stringify({ values: [
      ['_instance_id', 'uuid:first', 'uuid:second']
    ] }), 'uuid:second');
    found.rowNumber.should.equal(3);
    found.empty.should.equal(false);
  });

  it('counts a row in a later window from the start of the sheet', () => {
    const found = googleSheets.analyseLookup(JSON.stringify({ values: [
      ['uuid:a', 'uuid:b']
    ] }), 'uuid:b', { offset: 10000, limit: 10000 });
    // Second entry of the window that begins at row 10001.
    found.rowNumber.should.equal(10002);
    // A later window coming back short means the end of the data, never an
    // empty worksheet.
    found.empty.should.equal(false);
    found.exhausted.should.equal(true);
  });

  it('says there is another window to read when this one filled up', () => {
    const full = { values: [Array.from({ length: 4 }, (_, i) => `uuid:${i}`)] };
    const batch = googleSheets.analyseLookup(JSON.stringify(full), 'uuid:absent',
      { offset: 0, limit: 4 });
    batch.exhausted.should.equal(false);
    batch.scanned.should.equal(4);
    Should(batch.rowNumber).be.null();
  });

  it('reports an empty worksheet only from the first window', () => {
    googleSheets.analyseLookup('{}', 'uuid:x', { offset: 0, limit: 10 })
      .empty.should.equal(true);
    googleSheets.analyseLookup('{}', 'uuid:x', { offset: 10, limit: 10 })
      .empty.should.equal(false);
  });

  it('writes headers and a first row to an empty worksheet', () => {
    const request = googleSheets.buildRequest({
      headers: ['_instance_id', '/data/name'],
      row: ['uuid:first', 'Ana']
    }, config, { accessToken: 'token', lookup: { empty: true, rowNumber: null } });
    request.method.should.equal('POST');
    JSON.parse(request.body.toString()).values.should.eql([
      ['_instance_id', '/data/name'], ['uuid:first', 'Ana']
    ]);
    request.url.should.containEql(':append?');
  });

  it('replaces an existing instance row instead of duplicating it', () => {
    const request = googleSheets.buildRequest({
      headers: ['_instance_id', '/data/name'],
      row: ['uuid:first', 'Updated']
    }, config, { accessToken: 'token', lookup: { empty: false, rowNumber: 4 } });
    request.method.should.equal('PUT');
    request.url.should.containEql(encodeURIComponent("'Today''s data'!A4:B4"));
    JSON.parse(request.body.toString()).values.should.eql([['uuid:first', 'Updated']]);
  });
});
