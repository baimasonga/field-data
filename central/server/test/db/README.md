# Tests that need a real database

Three kinds live here: the permission tests organizations rest on, the
end-to-end check that the Field Data queries return the right numbers, and
`submission-def-join.sql`, which shows what a mock cannot: that form_defs and
submission_defs have independent id sequences, so comparing one table's id to
the other's id column matches only where the numbers coincide. That shipped
once already, in the Google Sheets target, and looked like it worked because a
fresh deployment's first submission happens to line up.

These exercise the one property organizations rest on: that a role granted on
an organization reaches the projects it owns, that it reaches nothing else,
and that adopting a project into an organization cannot take away a grant
somebody already had.

They are SQL rather than mocha because the thing under test is Central's own
`can()` query — the recursive walk over `actees.parent` and `actees.species`
in `lib/model/query/auth.js`. Reimplementing that in a mock would test the
reimplementation. `can.sql` copies it verbatim into a function so the
assertions run against the real thing.

To run them, against a throwaway database you do not mind writing to:

```
createdb odktest
NODE_CONFIG_DIR=path/to/config npx knex migrate:latest --knexfile lib/model/knexfile.js
psql -d odktest -f test/db/can.sql
psql -d odktest -f test/db/perm_test.sql
psql -d odktest -f test/db/monotonic.sql
```

Every row printed has a `got` and a `want`. They must match.

`effective-grants.sql` is the one to run around the organizations migration
itself, which is the riskiest part of that feature:

```
psql -d odktest -f test/db/effective-grants.sql > before.txt
npx knex migrate:latest --knexfile lib/model/knexfile.js
psql -d odktest -f test/db/effective-grants.sql > after.txt
diff before.txt after.txt     # must be empty
```

"The table was created" says nothing about a permission migration. "Nobody
gained or lost access" is the whole claim, and this is how to check it.

These are not in CI: the deploy has no database of its own to write to, and
pointing them at the live one would be a poor idea. They were run by hand against PostgreSQL 16 on 2026-09-20, after all 224
migrations, and all assertions passed -- including a before/after diff of
every effective grant across the organizations migration's data path, with
projects and grants already present. That diff was empty.


## Tenancy: does an organization's role reach its Projects and nothing else?

`seed-two-tenants.js` builds two organizations, each owning a Project with a
Form and Submissions, and five people: a site administrator, an organization's
owner and viewer, the other organization's manager, and somebody with no grant
at all. `tenant-isolation.sql` then asks Central's own `can()` about eighteen
combinations of person, Project and verb.

```
NODE_PATH=node_modules node test/db/seed-two-tenants.js   # writes /tmp/tenants.json
psql -d odktest -f test/db/can.sql
psql -d odktest -f test/db/tenant-isolation.sql
```

Run 2026-09-20 against PostgreSQL 16 with all 227 migrations: eighteen of
eighteen matched.

**But `can()` being right does not mean the routes ask it.** The sessions in
`/tmp/tenants.json` exist so the real server can be driven as each person:

```
NODE_CONFIG_DIR=<config pointing at odktest> node lib/bin/run-server.js
curl -H "Authorization: Bearer <token from /tmp/tenants.json>" localhost:8383/v1/projects
```

That is what found the two things below, neither of which any SQL assertion or
mocked test could reach.

**`GET /v1/projects` shows an organization's members nothing.** The listing in
`lib/model/query/projects.js` authorises with a flat match —

```sql
on assignment."acteeId" in ('*', 'project', projects."acteeId")
```

— which is the site-wide grant, the species, or the Project's own actee. It
never walks `actees.parent`, so a grant on an organization does not appear.
Every per-Project route uses `can()` and is correct, so an organization's
Projects are reachable by direct link and invisible in the list. `/v1/field-data/stats`
inherits it through `Projects.getAllByAuth` and shows those members zero
Projects.

**Administrators had lost the organization routes entirely**, fixed in
`20260920-09`. Moving those routes onto `organization.read` and friends left
the verbs only on the owner role, so the administrator — who holds `config.set`
and not these — got 403 on every organization they had not created themselves.

## End-to-end: do the queries return the right numbers?

`seed-real-form.js` builds a real form from `forms/avdp_tree_crops_survey.xml`
using ODK's own XForm parser, so `form_fields` is exactly what an upload
produces, and inserts 400 submissions with deterministic values. It writes
every value it used to `expected-source.json`.

The discipline that makes this worth anything: **compute the expected answers
independently**, in a different language, from that source file — never by
re-running the query under test. A query compared against itself proves
nothing.

```
createdb realdata
NODE_CONFIG_DIR=path/to/config npx knex migrate:latest --knexfile lib/model/knexfile.js
NODE_PATH=node_modules SD=/tmp/scratch node test/db/seed-real-form.js
# then compute expectations from expected-source.json in Python,
# boot the server, and compare the endpoints against them.
```

Run on 2026-09-20 against PostgreSQL 16 with 400 submissions. It found four
bugs that fixtures could not, all of them in code that had already shipped:

- `jsonb_build_object` is variadic `"any"`, so a bare parameter as a key is
  rejected with "could not determine data type of parameter". This broke
  filtered datasets, widgets and merged datasets alike. Every parameter
  reaching it now carries an explicit cast.
- `container.db.maybeOne` returns a row; `container.maybeOne` returns an
  Option. Four helpers paired the former with `getOrNotFound`, which needs
  the latter, so every one of those routes threw whenever the row existed.
  The hardening mocks had hidden it by returning an Option from `db.maybeOne`
  — a mock that was wrong in exactly the way the code was.
- A widget's coverage line counted non-empty answers while its rows counted
  values that parsed as numbers, so the denominator disagreed with the chart
  by one wherever somebody typed a word into a number field.
- `mergedDatasetShape` passed a `{formId}` object where `{id}` was expected,
  binding undefined.

None of these were test failures. Three of them were 500s.
