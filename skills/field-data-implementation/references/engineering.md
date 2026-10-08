# Field Data implementation conventions

## Establish the current state

Work from the repository root. Read applicable AGENTS.md files, `git status`,
current routes, schema and tests before editing. Do not overwrite unrelated work.
The skill bundle records an implementation direction, not a live feature audit.
Do not equate code presence, a browser fixture or a successful deploy with an
actual-device or authenticated external-service test.

The application is an ODK Central fork deployed from GitHub `main` to a
Cloudflare Worker/container, with a Python XLSForm compiler and external
PostgreSQL/object storage configuration. Use supported Node versions from the
package manifests. Inspect current configuration rather than copying stale
passwords, hostnames or runtime assumptions from prior tasks.

## Repository entry points

- Frontend: `central/client/apps/central/src/`, routes in `routes.js`, request
  builders in `util/request.js`, lazy registration in `util/load-async.js`.
- Backend: `central/server/lib/resources/`, registration in `lib/http/service.js`,
  frame/query model under `lib/model/`, and additive dated migrations.
- `field-data.js` owns restored core Field Data APIs; `field-data-workspaces.js`
  owns additional workspace features. Avoid overlapping route registration.
- Storage: existing adapters used by Field Data; do not introduce a second
  credential store or depend on disposable container files for uploaded data.
- UI regression tests: `central/client/e2e-tests/field-data.config.js` and its
  dashboard/review API fixtures. Form/compiler and backend integration tests
  provide additional coverage and are not replaced by mocked browser responses.

## Implement a coherent slice

1. Write the user journey and API/data contract before changing multiple layers.
2. Reuse current functionality, permission checks and query helpers. A hidden UI
   button is not authorization: test endpoints and field-level projections.
3. Validate input and parameterize SQL. Apply project/form/dataset permissions to
   metadata, filtered results, attachments, aggregate groups and export jobs.
4. Preserve submission/claim/evidence history and existing draft/publish behavior.
   Keep claim decisions separate from core `submissions.reviewState`.
5. Use versioned saved definitions and additive migrations. Make background jobs
   restart-safe and mutable actions idempotent; use revision checks where a stale
   client could overwrite another user's work.
6. Distinguish loading, no data, insufficient access and failure. Provide a retry
   for recoverable failures. Ignore stale requests after scope/filter changes.
7. Keep controls labeled and keyboard accessible. Do not use color alone to
   convey status. Inspect desktop and mobile renders when layout changes.
8. Add only justified dependencies and explain runtime/image implications.
   Sanitize HTML, XML, CSV formulas and user-controlled filenames as applicable.

## Verification

Choose checks appropriate to the slice rather than running every suite on each
edit. Inspect the current workflow files for required commands and services.
Use the relevant source root when running ESLint so imports resolve correctly.
Common commands (from the listed directory):

| Directory | Check |
| --- | --- |
| Repository root | `git diff --check` |
| Repository root | `node --test tests/async-component-registration.test.mjs` for lazy-loader edits |
| `central/client` | `npm run build` |
| `central/client` | `npm exec -- playwright test --config e2e-tests/field-data.config.js` |
| `central/client/apps/central` | `npx eslint <changed-source-files> --max-warnings 0` |
| `central/server` | `NODE_CONFIG_ENV=test BCRYPT=insecure npx mocha --recursive test/unit` when relevant |
| `central/server` | `NODE_CONFIG_ENV=test npx mocha test/field-data/hardening.cjs` for protected API changes |

Install Playwright Chromium or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an
installed Chromium executable. Use a dedicated disposable database for integration
checks and an isolated destination for restore tests. Format writers require
independent-reader validation; browser fixtures alone cannot verify file contents.
Do not write tests that merely repeat implementation details.

## Secrets, external services and delivery

Never log credentials, hashes used for authentication, session tokens or complete
environment dumps. Use configured secret bindings and inspect only presence when
troubleshooting. Preserve TLS validation. For external requests, use the existing
SSRF protections, timeouts and resource limits.

Follow authorization already provided in the conversation. Complete code and
verification before asking for a genuinely required external decision. Creating
an isolated test environment does not require a new confirmation. Do not send
messages to people or publish real project data without explicit authorization.

A push to `main` triggers `.github/workflows/deploy-field-data.yml`. When a push
is authorized, check the remote base, commit a coherent change and verify the
push. Report deployment as triggered until a run result proves success. Attach
any created pull request using the app artifact tool. Do not invent a successful
run when the GitHub API is inaccessible.

## Completion evidence

Report changed behavior, checks performed and remaining material limitations.
Record production acceptance separately: actual Collect offline sync,
authenticated Google/DHIS2 operations, public-data release approval, live alert
routing, restore drills and support staffing cannot be inferred from unit tests.
