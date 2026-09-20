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

  it('looks up instance IDs in column A with an escaped sheet name', () => {
    const request = googleSheets.buildLookupRequest(config, 'access-token');
    request.method.should.equal('GET');
    request.url.should.containEql(encodeURIComponent("'Today''s data'!A:A"));
    request.headers.Authorization.should.equal('Bearer access-token');
  });

  it('finds the one-based row for an existing instance', () => {
    googleSheets.analyseLookup(JSON.stringify({ values: [
      ['_instance_id', 'uuid:first', 'uuid:second']
    ] }), 'uuid:second').should.eql({ empty: false, rowNumber: 3 });
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
