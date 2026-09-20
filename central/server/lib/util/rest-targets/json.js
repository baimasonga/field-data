// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// The target every webhook was before targets existed: POST the event as JSON
// to a URL. Kept exactly as it behaved, because existing integrations parse
// this shape and a migration that quietly reshaped their payload would break
// them at the far end where nobody here would see it.

module.exports = {
  name: 'json',
  label: 'JSON endpoint',
  configSchema: {},

  buildRequest: (payload) => {
    const body = Buffer.from(JSON.stringify(payload));
    return {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': body.length
      },
      body
    };
  }
};
