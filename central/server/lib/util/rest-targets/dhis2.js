// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// Deliver one Form Submission as a DHIS2 Data Value Set. The mapping is
// explicit: XLSForm paths never become DHIS2 data-element identifiers by
// accident, and values for unmapped questions are never transmitted.

// Built from the parsed URL rather than by concatenation. Appending to the raw
// string puts the endpoint after any query or fragment, so a serverUrl of
// "https://dhis.example.org/?x=1" would be delivered to "/?x=1/api/dataValueSets"
// and a fragment would drop the endpoint from the request altogether.
const dataValueSetUrl = (serverUrl) => {
  const url = new URL(String(serverUrl));
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/api/dataValueSets`;
  url.search = '';
  url.hash = '';
  return url.toString();
};

const parseMapping = (value) => {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (_) {
    throw new Error('Field mapping must be valid JSON.');
  }
  if (parsed == null || Array.isArray(parsed) || typeof parsed !== 'object')
    throw new Error('Field mapping must be a JSON object of Form paths to DHIS2 data element IDs.');

  const entries = Object.entries(parsed);
  if (entries.length === 0) throw new Error('Field mapping must contain at least one Form path.');
  for (const [path, dataElement] of entries) {
    if (!/^\/[A-Za-z_][A-Za-z0-9_.-]*(\/[A-Za-z_][A-Za-z0-9_.-]*)*$/.test(path))
      throw new Error(`Field mapping path "${path}" is not a safe Form path.`);
    if (!/^[A-Za-z][A-Za-z0-9]{10}$/.test(String(dataElement)))
      throw new Error(`DHIS2 data element "${dataElement}" must be an 11-character UID.`);
  }
  return entries;
};

const validateConfig = (config) => {
  let url;
  try {
    url = new URL(config.serverUrl);
  } catch (_) {
    throw new Error('DHIS2 server URL must be a valid HTTPS URL.');
  }
  if (url.protocol !== 'https:') throw new Error('DHIS2 server URL must use HTTPS.');
  if (url.search !== '' || url.hash !== '')
    throw new Error('DHIS2 server URL must not contain a query string or fragment.');
  if (!/^[A-Za-z][A-Za-z0-9]{10}$/.test(config.dataSet))
    throw new Error('DHIS2 data set must be an 11-character UID.');
  if (!/^[A-Za-z][A-Za-z0-9]{10}$/.test(config.orgUnit))
    throw new Error('DHIS2 organisation unit must be an 11-character UID.');
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(config.period))
    throw new Error('DHIS2 period contains unsupported characters.');
  parseMapping(config.mapping);
};

const buildRequest = (payload, config) => {
  const dataValues = parseMapping(config.mapping).flatMap(([path, dataElement]) => {
    const value = payload.answers?.[path];
    return value == null || value === '' ? [] : [{ dataElement, value: String(value) }];
  });
  if (dataValues.length === 0)
    throw new Error('This Submission has no values for the configured DHIS2 field mapping.');

  const body = Buffer.from(JSON.stringify({
    dataSet: config.dataSet,
    completeDate: payload.submittedAt.slice(0, 10),
    period: config.period,
    orgUnit: config.orgUnit,
    dataValues
  }));
  const authorization = Buffer.from(`${config.username}:${config.password}`).toString('base64');
  return {
    method: 'POST',
    url: dataValueSetUrl(config.serverUrl),
    headers: {
      Authorization: `Basic ${authorization}`,
      'Content-Type': 'application/json',
      'Content-Length': body.length
    },
    body
  };
};

module.exports = {
  name: 'dhis2',
  label: 'DHIS2 Data Value Set',
  requiresForm: true,
  managesUrl: true,
  submissionValues: true,
  signsDeliveries: false,
  configSchema: {
    serverUrl: {
      type: 'string', required: true, secret: false,
      describe: 'DHIS2 server URL, for example https://dhis.example.org.'
    },
    username: {
      type: 'string', required: true, secret: false,
      describe: 'DHIS2 integration username.'
    },
    password: {
      type: 'string', required: true, secret: true,
      describe: 'DHIS2 integration password.'
    },
    dataSet: {
      type: 'string', required: true, secret: false,
      describe: 'DHIS2 data set UID.'
    },
    orgUnit: {
      type: 'string', required: true, secret: false,
      describe: 'DHIS2 organisation unit UID.'
    },
    period: {
      type: 'string', required: true, secret: false,
      describe: 'DHIS2 reporting period, for example 202609.'
    },
    mapping: {
      type: 'string', required: true, secret: false,
      describe: 'JSON mapping of Form paths to DHIS2 data element UIDs.'
    }
  },
  validateConfig,
  mappedPaths: config => parseMapping(config.mapping).map(([path]) => path),
  deliveryUrl: config => dataValueSetUrl(config.serverUrl),
  buildRequest,
  _parseMapping: parseMapping
};
