// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// karma.conf.js launches ChromeHeadless, which refuses to start as root: in a
// container that means the client suite cannot run at all. This adds the one
// launcher flag that fixes it and changes nothing else.
//
//   CHROME_BIN=/path/to/chrome NODE_ENV=test npx karma start karma.nosandbox.js
//
// test/run.sh copies index.html into public/ first; do the same by hand, or
// the suite reports every test as failing to load.

const base = require('./karma.conf.js');

module.exports = (config) => {
  base(config);
  config.set({
    basePath: __dirname,
    browsers: ['ChromeHeadlessNoSandbox'],
    customLaunchers: {
      ChromeHeadlessNoSandbox: {
        base: 'ChromeHeadless',
        flags: ['--no-sandbox', '--disable-dev-shm-usage']
      }
    }
  });
};
