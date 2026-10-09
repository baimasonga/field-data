// Copyright 2019 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

// here we provide a very thin wrapper around a simple node http request to
// abstract away xlsform communication, mostly for the purpose of being able to
// put it in the container as a provider rather than directly use config somewhere.

const http = require('http');
const https = require('https');
const { pipeline } = require('stream');
const { rejectIfError } = require('../util/promise');
const { isBlank } = require('../util/util');
const Problem = require('../util/problem');

const mock = () => Promise.reject(Problem.internal.xlsformNotConfigured());

const convert = (protocol, host, port) => (stream, formIdFallback = '') => new Promise((resolve, reject) => {
  const headers = { 'X-XlsForm-FormId-Fallback': formIdFallback };
  const { request } = protocol === 'https' ? https : http;
  const req = request({ host, port, headers, method: 'POST', path: '/api/v1/convert' }, (res) => {
    const resData = [];
    res.on('data', (d) => { resData.push(d); });
    res.on('error', reject); // this only occurs if something unexpected happens to the request.
    res.on('end', () => {
      let body;
      try { body = JSON.parse(Buffer.concat(resData)); } catch (ex) { return reject(ex); }
      if (res.statusCode === 200) resolve({ xml: body.result, itemsets: body.itemsets, warnings: body.warnings });
      // a validator that cannot run is a broken deployment, not a broken spreadsheet:
      // keep the two apart so neither the API nor the browser blames the author.
      else if (body.errorCode === 'validator-unavailable') reject(Problem.internal.xlsformValidatorUnavailable({ error: body.error }));
      // `kind` says whether the spreadsheet itself is wrong ('invalid-xlsform') or the
      // generated XForm was rejected ('compile-failed'). Older compilers omit it.
      else reject(Problem.user.xlsformNotValid({ error: body.error, warnings: body.warnings, kind: body.errorCode ?? undefined }));
    });
  });

  req.on('error', (error) => { reject(Problem.internal.xlsformNotAvailable({ error })); });
  pipeline(stream, req, rejectIfError(reject));
});


// sorts through config and returns either a stub or a real function for xlsform
// conversion.
const init = (config) => {
  if (config == null) return mock;
  const port = parseInt(config.port, 10);
  if (isBlank(config.host) || Number.isNaN(port)) return mock;
  const protocol = config.protocol === 'https' ? 'https' : 'http';
  return convert(protocol, config.host, port);
};

module.exports = { init };
