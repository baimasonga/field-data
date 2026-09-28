# Handing this work on

Written for the next agent — ChatGPT or otherwise — picking up stability work
before Field Data is opened to outside testers.

Read this first. The single reason the last handoff went wrong was an
environment that could not run the software, and a report written from reading
the source instead. `design-qa.md` still records that attempt: *"final result:
blocked. No browser path in this runtime can load and capture the local
application."* Everything it concluded from the source was plausible and some
of it was wrong — every KPI icon was an empty box, the Project list had no
route at all, and three sidebar links went nowhere. None of that is visible
without running it.

So: **get the stack up before writing a line.** The commands below are the ones
that actually work, with the traps that cost hours.

---

## 1. Standing up a working environment

### PostgreSQL

`initdb` refuses to run as root, so run it as the `postgres` user:

```bash
export PGBIN=/usr/lib/postgresql/16/bin PGDATA=$HOME/pgdata
mkdir -p $PGDATA /tmp/pgsock && chown -R postgres:postgres $PGDATA /tmp/pgsock
su postgres -c "$PGBIN/initdb -D $PGDATA -U postgres --auth=trust"
su postgres -c "$PGBIN/pg_ctl -D $PGDATA -l /tmp/pg.log \
  -o '-k /tmp/pgsock -p 5432 -c listen_addresses=127.0.0.1' -w start"
psql -h 127.0.0.1 -U postgres -c "create user odk with password 'odk' superuser" \
  -c "create database odk owner odk"
```

### Server config

`central/server/config/development.json` and `config/test.json` are gitignored;
create them. The database block rejects an `ssl` key — it will not start with
one.

```json
{ "default": {
  "database": { "host": "127.0.0.1", "port": 5432, "user": "odk",
                "password": "odk", "database": "odk" },
  "server": { "port": 8383 },
  "email": { "serviceAccount": "no-reply@fielddata.local", "transport": "json" },
  "xlsform": { "host": "localhost", "port": 5001 },
  "enketo": { "url": "http://localhost:8005/-", "apiKey": "enketorules" },
  "env": { "domain": "http://localhost:8383",
           "sysadminAccount": "admin@fielddata.quantixsl.com" },
  "external": { "sentry": {}, "analytics": {} } } }
```

### Migrations

The knex CLI changes directory to `lib/model`, so `NODE_CONFIG_DIR` is relative
to *that*, not to where you are standing:

```bash
cd central/server
NODE_CONFIG_DIR=../../config NODE_CONFIG_ENV=development \
  npx knex migrate:latest --knexfile lib/model/knexfile.js   # 229 migrations
```

### An administrator, and data worth looking at

```bash
cd central/server
printf 'quantix-secret-1\nquantix-secret-1\n' | NODE_CONFIG_DIR=./config \
  NODE_CONFIG_ENV=development node lib/bin/cli.js user-create -u admin@fielddata.quantixsl.com
NODE_CONFIG_DIR=./config NODE_CONFIG_ENV=development \
  node lib/bin/cli.js user-promote -u admin@fielddata.quantixsl.com

# 8 projects, 32 forms, 12,491 submissions with review states
node test/db/seed-dashboard.js
# 240 submissions carrying real coordinates across ten Sierra Leone districts
node test/db/seed-geopoints.js
```

`test/db/seed-two-tenants.js` adds the organizations and the five people the
permission tests use. All three take `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/
`PGDATABASE`.

### Running it

```bash
cd central/server
NODE_CONFIG_DIR=./config NODE_CONFIG_ENV=development node lib/bin/run-server.js &
cd ../client && npx vite build          # writes dist/
```

Then serve `central/client/dist` and proxy `/v1/*` to `127.0.0.1:8383`. **Two
traps:**

- The session endpoints reject plain HTTP (`lib/http/preprocessors.js:74`).
  Serve over HTTPS with a self-signed certificate and run the browser with
  `ignoreHTTPSErrors`, **or** have the proxy add `x-forwarded-proto: https`.
  Without this, login returns 200 and then silently fails.
- The client asks for `/client-config.json`. Return `{}` or the console fills
  with parse errors.

### A browser

Chromium is already installed. Do **not** run `playwright install`.

```js
chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
```

---

## 2. The outstanding work, in the order it is worth doing

### A. Triage the 59 failing server integration tests — do this one first

This is the only outstanding item that might mean something is actually broken
rather than merely untested.

```bash
cd central/server
npm install --include=dev --no-audit --no-fund --ignore-scripts --engine-strict=false --force
psql -h 127.0.0.1 -U postgres -c "create database jubilant_test owner jubilant"
psql -h 127.0.0.1 -U postgres -d jubilant_test -c "create extension if not exists pgrowlocks"
# config/test.json pointing at jubilant_test, then migrate it as above
NODE_CONFIG_ENV=test BCRYPT=insecure npx mocha --recursive test/integration
```

Baseline as of `6a7f702`: **2467 passing, 59 failing, 5 pending.** Every
failure clusters on Enketo, because the fork replaced external Enketo with
native Web Forms and the tests still expect Enketo ids.

The question to answer, failure by failure: **is this a stale expectation, or
is form rendering actually broken?** It matters because outside testers filling
forms in a browser exercise exactly this path. Do not assume from the names.
Open one, see what the endpoint returns now versus what the test expects, and
decide. Fix the stale ones; report the real ones before fixing.

Note the suite could not run at all until `test/integration/fixtures/02-forms.js`
stopped deleting a `formview` assignment that `Forms.createNew()` no longer
creates. If it breaks again, look there first.

### B. A smoke test of the critical path

Nothing re-proves the path the whole product exists for. It was verified by
hand, once, in September. It should run on every deploy:

1. Build a form in the browser (Project → Forms → Create Form → Build).
2. Publish it.
3. Fetch the OpenRosa form list — `GET /v1/projects/:id/formList` with an app
   user's token — and assert the form is in it with its id, name, version and
   download URL. **This is what a phone reads.** If it is absent, field staff
   see nothing, and no other test in the repo notices.
4. Submit to it over the OpenRosa endpoint.
5. Assert the submission appears in `/v1/field-data/submissions`.

Put it somewhere it runs unattended. `.github/workflows/field-data-validation.yml`
already accepts a `base_url` input and is the natural home.

### C. Make the client suite a signal again

```bash
cd central/client/apps/central
cp ../../index.html ../../public/
CHROME_BIN=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
  NODE_ENV=test npx karma start karma.nosandbox.js
rm -f ../../public/index.html
```

Baseline as of `6a7f702`: **277 failing, 3025 passing.** The ones sampled
assert the product is called "ODK Central" and are stale from the rebranding —
but only a sample was checked. While they sit there, a real regression hides
among them. Clear them, then keep the suite at zero.

The suite is also load-sensitive: a full run occasionally dies with
`Disconnected, because no message in 30000 ms`, and individual tests
occasionally time out. Re-run before believing a single new failure.

### D. Smaller, genuinely cosmetic

- `npm run transifex:lint` fails with 6079 diff lines and has since before this
  work. Regenerate `transifex/strings_en.json`.
- ESLint errors in `src/components/landing-photos.js` and `src/styles.js`.
- The deploy step "Report the accounts the database holds" logs
  `relation "field_data.bootstrap_log" does not exist`. Harmless, but the
  diagnostic it was meant to print never appears.
- `.github/workflows/deploy-field-data.yml` sets
  `concurrency: cancel-in-progress: true`. Two merges minutes apart cancel the
  first deploy mid-flight. It has already happened once. Harmless when the
  later deploy is a superset and succeeds; not harmless if it fails.

### E. Deliberately not done

New strings are English only. The other ten locales fall back. This is the
owner's decision, not an oversight.

---

## 3. How to know when you are finished

Not by reading the diff. Every defect found in this codebase over the last
several sessions was a value or an interface that two callers disagreed about —
a `submission_defs` id where a `form_defs` id belonged, a container method
where a slonik method belonged, a compressed size where an inflated one
belonged, an icon class second in an attribute where the stylesheet matched
only the first. **Mocks passed all of them.**

So:

- Run the thing. Drive the real application in a real browser against a real
  database, and look at the result.
- When you write a test, make sure the fixture is not deciding the answer. A
  regression test that passes against the buggy code is worse than no test.
  Read off the SQL or the API which id, which column, which type is meant.
- Baseline before and after. Count failures on a clean tree first, then with
  your change, and diff the failure *names* — not just the totals.
- Report what you did not check as plainly as what you did.

## 4. Schema traps that have already cost time

- `forms` has no `name` column; the title is on `form_defs.name`.
- `submission_defs.formDefId` is the only foreign key to `form_defs.id`. The
  two tables have independent sequences, so comparing a submission-def id to a
  form-def id matches only where the numbers happen to coincide. That shipped
  once.
- `submission_defs` has `submitterId`, not `actorId`. `form_defs.xml` is NOT
  NULL. `submissions` has no `currentDefId`. `form_fields` keys on `schemaId`.
- `sessions.csrf` is `varchar(64)` — and so is a session token, so prefixing
  one with the other overflows the column.
- Session tokens must match `/^[A-Za-z0-9!$]{64}$/` (`lib/util/crypto.js:51`).
  Anything else is rejected before the database is consulted, which looks
  exactly like a permission failure and is not one.
- Stock PostgreSQL has no `sha1()`.
- `container.all` is ODK's; `pool.any` is slonik's. **`pool.all` is undefined.**
