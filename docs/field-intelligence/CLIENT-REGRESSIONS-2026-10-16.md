# Client regression cleanup

The full legacy client suite now completes with 3,311 passing tests, nine
previously skipped tests, and zero failures. CI preserves Karma's exit status,
requires a nonempty successful result, and no longer permits a failure baseline.

Permission-validation watchers now run in an explicitly owned Vue effect scope.
Navigation callbacks can otherwise inherit a stopped ambient scope, preventing
reactive permission or publication checks from redirecting. The scope follows
its parent lifetime where one exists; navigation still stops previous effects.

The welcome page's single selected photograph uses a static asset import,
supported by both Vite and the legacy Webpack test runner. Its content and
appearance are unchanged.

Test fixtures now include collector-scoped capture history, and navigation
fixtures only expect dashboard requests while that page is mounted. Assertions
follow the current welcome redirect, dashboard title, branding, hero background,
survey-doctor request, and displayed tooltip text. Modal effects are tested in
a mounted scope; popover dismissal awaits Vue's update. Recent-submission test
data no longer expires as the calendar advances. Layout checks assert growth,
containment and truncation rather than font-dependent exact measurements.

Validation from `central/client/apps/central`, after copying the client's root
`index.html` to `public/index.html`:

```sh
CHROME_BIN=/usr/bin/chromium NODE_ENV=test \
  ../../node_modules/.bin/karma start karma.nosandbox.js
```

Changed source and tests pass ESLint. No tests or permission assertions were
disabled. The existing source lint exclusions and nine pending tests are
separate maintenance work; this change does not describe them as passing.
