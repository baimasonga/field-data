# Permission tests that need a real database

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
