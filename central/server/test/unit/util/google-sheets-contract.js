const Should = require('should'); // eslint-disable-line no-unused-vars
const googleSheets = require('../../../lib/util/rest-targets/google-sheets');
const contract = require('../../fixtures/google-sheets-v4-contract.json');

/*
What Google says its API is, checked against what we build.

Until now every claim about this integration rested on our own reading. The
requests had never left the process, and a test that asserts our URL looks
like the URL we decided to write proves only that we have not changed our
minds.

`test/fixtures/google-sheets-v4-contract.json` is an extract of Google's own
machine-readable discovery document, so the path templates, the parameter
names and the permitted values below are theirs rather than ours. Refresh it
with:

  curl -s 'https://sheets.googleapis.com/$discovery/rest?version=v4'

The observed error bodies in that fixture were captured by sending these exact
requests to the live endpoints with deliberately invalid credentials.

What this still cannot show: whether an authorised request does what the
document says. Google checks credentials before it validates a range -- a
deliberately malformed range answers 401 exactly as a good one does -- so no
unauthenticated probe can confirm our ranges are acceptable. Only a real
spreadsheet can.
*/

const config = {
  spreadsheetId: '1abcDEF_ghi-JKL',
  sheetName: "Today's data",
  clientId: 'cid', clientSecret: 'secret', refreshToken: 'refresh'
};
const payload = {
  instanceId: 'uuid:1',
  headers: ['_instance_id', '/district'],
  row: ['uuid:1', 'Bombali']
};

// Turn Google's path template into something a built URL can be matched with.
const pathMatcher = (template) => new RegExp(`^${template
  .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  .replace(/\\\{spreadsheetId\\\}/, '[^/]+')
  .replace(/\\\{range\\\}/, '[^/?]+')}`);

const parse = (request) => {
  const url = new URL(request.url);
  return {
    method: request.method,
    path: url.pathname.replace(/^\//, ''),
    query: url.searchParams,
    body: request.body == null ? null : JSON.parse(request.body.toString())
  };
};

describe('(util) Google Sheets against the published contract', () => {
  it('reads the column with the method and parameters Google documents', () => {
    const spec = contract.methods.get;
    const request = parse(googleSheets.buildLookupRequest(config, 'token'));
    request.method.should.equal(spec.httpMethod);
    request.path.should.match(pathMatcher(spec.path));
    // COLUMNS is what makes values[0] the instance-ID column analyseLookup reads.
    request.query.get('majorDimension').should.equal('COLUMNS');
    spec.parameters.majorDimension.enum.should.containEql('COLUMNS');
  });

  it('appends with the method, the :append suffix and the parameters Google documents', () => {
    const spec = contract.methods.append;
    const request = parse(googleSheets.buildRequest(payload, config,
      { accessToken: 'token', lookup: { empty: true, rowNumber: null } }));
    request.method.should.equal(spec.httpMethod);
    request.path.should.match(pathMatcher(spec.path.replace(':append', '')));
    // The colon is a method separator, so it must survive un-encoded after an
    // encoded range.
    request.path.should.endWith(':append');
    spec.parameters.insertDataOption.enum.should.containEql('INSERT_ROWS');
    request.query.get('insertDataOption').should.equal('INSERT_ROWS');
  });

  it('updates an existing row with the method Google documents', () => {
    const spec = contract.methods.update;
    const request = parse(googleSheets.buildRequest(payload, config,
      { accessToken: 'token', lookup: { empty: false, rowNumber: 4 } }));
    request.method.should.equal(spec.httpMethod);
    request.path.should.match(pathMatcher(spec.path));
    request.path.should.not.containEql(':append');
  });

  /*
  The one parameter that decides whether a Submission can become a formula.

  RAW stores what it is given. USER_ENTERED parses it as though a person had
  typed it, which turns an answer of "=HYPERLINK(...)" into a live formula in
  somebody's spreadsheet -- the CSV-injection problem, arriving through a
  format that does not otherwise have it. Both are valid values of the same
  parameter, and USER_ENTERED is the one a change wanting prettier dates would
  reach for.
  */
  it('never asks Google to interpret an answer as though it were typed', () => {
    for (const lookup of [{ empty: true, rowNumber: null }, { empty: false, rowNumber: 4 }]) {
      const request = parse(googleSheets.buildRequest(payload, config,
        { accessToken: 'token', lookup }));
      request.query.get('valueInputOption').should.equal('RAW');
    }
    // Both spellings are accepted by the API, so this is a choice and not a
    // constraint, which is exactly why it is pinned here.
    contract.methods.append.parameters.valueInputOption.enum.should.containEql('USER_ENTERED');
    contract.methods.update.parameters.valueInputOption.enum.should.containEql('USER_ENTERED');
  });

  it('sends a body shaped like the ValueRange Google expects', () => {
    const request = parse(googleSheets.buildRequest(payload, config,
      { accessToken: 'token', lookup: { empty: true, rowNumber: null } }));
    contract.methods.append.request.should.equal('ValueRange');
    for (const key of Object.keys(request.body)) contract.schemas.ValueRange.should.containEql(key);
    request.body.values.should.eql([payload.headers, payload.row]);
  });

  it('reads the column out of the ValueRange shape Google returns', () => {
    contract.schemas.ValueRange.should.containEql('values');
    // majorDimension COLUMNS puts the first column at values[0].
    const body = JSON.stringify({
      range: "'Today''s data'!A1:A3", majorDimension: 'COLUMNS',
      values: [['_instance_id', 'uuid:a', 'uuid:b']]
    });
    googleSheets.analyseLookup(body, 'uuid:b', { offset: 0, limit: 10 })
      .rowNumber.should.equal(3);
  });

  it('posts the token request in the form the live endpoint accepts', () => {
    const request = googleSheets.buildTokenRequest(config);
    request.headers['Content-Type'].should.equal('application/x-www-form-urlencoded');
    const params = new URLSearchParams(request.body.toString());
    params.get('grant_type').should.equal('refresh_token');
    // Sent live with invalid credentials, this is answered "invalid_client",
    // a credential complaint. A malformed body answers "invalid_request"
    // instead, so the shape is what the endpoint expects.
    contract.observedErrors.token.body.error.should.equal('invalid_client');
  });
});
