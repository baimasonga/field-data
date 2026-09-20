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

const buildLookupRequest = (config, accessToken) => ({
  method: 'GET',
  url: `${API}/${encodeURIComponent(config.spreadsheetId)}/values/${sheetRange(config.sheetName, 'A:A')}?majorDimension=COLUMNS`,
  headers: bearer(accessToken),
  body: null
});

const analyseLookup = (body, instanceId) => {
  const parsed = JSON.parse(body || '{}');
  const firstColumn = Array.isArray(parsed.values?.[0]) ? parsed.values[0] : [];
  const index = firstColumn.findIndex(value => String(value) === String(instanceId));
  return { empty: firstColumn.length === 0, rowNumber: index === -1 ? null : index + 1 };
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
    }
  },
  buildTokenRequest,
  buildLookupRequest,
  analyseLookup,
  buildRequest,
  _columnName: columnName
};
