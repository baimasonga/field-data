// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// Google Sheets' API is used directly rather than posting to an Apps Script
// somebody has to deploy and maintain. OAuth refresh credentials are stored
// encrypted by the registry; this module only ever receives them after the
// delivery worker has opened the configuration in memory.

const API = 'https://sheets.googleapis.com/v4/spreadsheets';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

const columnName = (count) => {
  let value = count;
  let result = '';
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
};

const sheetRange = (sheetName, range) =>
  `${encodeURIComponent(`'${String(sheetName).replace(/'/g, "''")}'!${range}`)}`;

const bearer = accessToken => ({ Authorization: `Bearer ${accessToken}` });

const buildTokenRequest = (config) => {
  const body = Buffer.from(new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
    grant_type: 'refresh_token'
  }).toString());
  return {
    method: 'POST',
    url: TOKEN_URL,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': body.length
    },
    body
  };
};

/*
The instance-ID column is read in bounded windows rather than as `A:A`.

`A:A` asks for the whole column, and the delivery worker keeps at most a
megabyte of any response. An instance ID is about 46 bytes once JSON has
quoted it, so a worksheet stopped syncing for good at roughly twenty-two
thousand rows: the response was truncated mid-document, JSON.parse threw, and
every later delivery failed with a parse error that said nothing about size.

Ten thousand rows is about 460 KB, comfortably inside that cap, and the worker
asks for the next window only when it has to.
*/
const LOOKUP_BATCH = 10000;

const buildLookupRequest = (config, accessToken, { offset = 0, limit = LOOKUP_BATCH } = {}) => ({
  method: 'GET',
  url: `${API}/${encodeURIComponent(config.spreadsheetId)}/values/${sheetRange(config.sheetName, `A${offset + 1}:A${offset + limit}`)}?majorDimension=COLUMNS`,
  headers: bearer(accessToken),
  body: null
});

/*
`empty` is only meaningful for the first window: a later one coming back short
means the end of the data, not an empty worksheet.

`exhausted` says there is no point asking for another window. Sheets trims
trailing blanks, so a short window can also mean somebody left gaps in the
column; stopping there costs an append that could have been an update, which
is a duplicate row rather than a row overwritten with the wrong answers.
*/
const analyseLookup = (body, instanceId, { offset = 0, limit = LOOKUP_BATCH } = {}) => {
  const parsed = JSON.parse(body || '{}');
  const column = Array.isArray(parsed.values?.[0]) ? parsed.values[0] : [];
  const index = column.findIndex(value => String(value) === String(instanceId));
  return {
    empty: offset === 0 && column.length === 0,
    rowNumber: index === -1 ? null : offset + index + 1,
    scanned: column.length,
    exhausted: column.length < limit
  };
};

const buildRequest = (payload, config, context) => {
  const { accessToken, lookup } = context;
  const lastColumn = columnName(payload.headers.length);
  const update = lookup.rowNumber != null;
  const values = lookup.empty ? [payload.headers, payload.row] : [payload.row];
  const url = update
    ? `${API}/${encodeURIComponent(config.spreadsheetId)}/values/${sheetRange(config.sheetName, `A${lookup.rowNumber}:${lastColumn}${lookup.rowNumber}`)}?valueInputOption=RAW`
    : `${API}/${encodeURIComponent(config.spreadsheetId)}/values/${sheetRange(config.sheetName, `A:${lastColumn}`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const body = Buffer.from(JSON.stringify({ majorDimension: 'ROWS', values }));
  return {
    method: update ? 'PUT' : 'POST',
    url,
    headers: {
      ...bearer(accessToken),
      'Content-Type': 'application/json',
      'Content-Length': body.length
    },
    body
  };
};

module.exports = {
  name: 'google-sheets',
  label: 'Google Sheets',
  requiresForm: true,
  managesUrl: true,
  submissionRows: true,
  signsDeliveries: false,
  configSchema: {
    spreadsheetId: {
      type: 'string', required: true, secret: false,
      describe: 'Spreadsheet ID from the Google Sheets URL.'
    },
    sheetName: {
      type: 'string', required: true, secret: false,
      describe: 'Worksheet tab name, for example Submissions.'
    },
    clientId: {
      type: 'string', required: true, secret: false,
      describe: 'Google OAuth client ID.'
    },
    clientSecret: {
      type: 'string', required: true, secret: true,
      describe: 'Google OAuth client secret.'
    },
    refreshToken: {
      type: 'string', required: true, secret: true,
      describe: 'Google OAuth refresh token with Sheets access.'
    },
    syncUpdates: {
      type: 'boolean', required: false, secret: false,
      describe: 'Update an existing row when a Submission receives a new version.'
    },
    sendExisting: {
      type: 'boolean', required: false, secret: false,
      describe: 'Queue existing Submissions for synchronization after this integration is created.'
    }
  },
  buildTokenRequest,
  deliveryUrl: () => `${API}/`,
  buildLookupRequest,
  analyseLookup,
  buildRequest,
  LOOKUP_BATCH,
  _columnName: columnName
};
