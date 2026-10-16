# Native form regression cleanup

The server's Problem declarations now retain numeric order without changing any
error code or message. This restores the existing ordering assertion.

Draft and publication tests now exercise the bundled Web Forms workflow instead
of expecting requests and retries against the removed Enketo service. They check
resolvable draft, published and once-only links; retirement of published draft
links; separation and stability of link identities; metadata consistency; missing
published-link recovery; and independence from an unavailable or stalled Enketo
service, including after worker execution. Obsolete remote-call retry cases are
consolidated into native provisioning and worker-stability checks.

The feature-capabilities CI job now runs the draft suite with its custom
assertions explicitly loaded. Other legacy suites are not declared repaired.

Local validation with Node 24.16.0 and PostgreSQL 16:

- Full server unit suite: 1,889 passing, one pending, zero failing.
- Draft, atomic revision and real XLSForm pipeline suites: 142 passing.
- Full server source lint and changed-test lint: passed.
- Field Data hardening and native-link unit checks: passed.

To reproduce the integration checks from `central/server`, start the compiler
on port 5001 and use a disposable PostgreSQL database owned by a separate test
role (the harness drops objects owned by that role). Supply PGHOST, PGUSER,
PGPASSWORD and PGDATABASE for that database, then run:

```sh
NODE_CONFIG_ENV=test BCRYPT=insecure REQUIRE_FORM_COMPILER=1 \
  FIELD_DATA_STORAGE_DIR=/tmp/field-data-test-storage \
  npx mocha --require test/integration/assertions.js --timeout 60000 \
  test/integration/api/forms/draft.js \
  test/integration/api/forms/atomic-revision.js \
  test/integration/api/field-data-xlsform-pipeline.js
```

These results establish local regression coverage, not production deployment,
full client-suite completion, or real-device acceptance.
