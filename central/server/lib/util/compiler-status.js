// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const http = require('http');
const https = require('https');

// Whether the XLSForm compiler can really validate forms, as opposed to merely
// answering. A compiler without Java is alive but cannot validate, and one run
// with validation deliberately skipped answers 200 and says `validated: false`;
// neither may be reported as healthy, or a deployment that serves unvalidated
// (or no) forms looks fine. A compiler that predates /readyz answers 404 and is
// treated as reachable, because it has no way to say more.
const compilerValidates = (url, timeout = 1500) => new Promise((resolve) => {
  try {
    const client = new URL(url).protocol === 'https:' ? https : http;
    const req = client.get(url, { timeout }, (res) => {
      if (res.statusCode === 404) { res.resume(); resolve(true); return; }
      if (res.statusCode !== 200) { res.resume(); resolve(false); return; }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')).validated === true); } catch { resolve(false); }
      });
      res.on('error', () => resolve(false));
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  } catch { resolve(false); }
});

module.exports = { compilerValidates };
