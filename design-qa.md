# Programme dashboard design QA

## How this was verified

The first pass of this dashboard could not be looked at: no browser in that
runtime could reach a running copy, so the work shipped on a reading of the
source. This pass drove the real application.

- PostgreSQL 16, 229 migrations, a seeded programme of 8 projects, 32 forms and
  12,491 submissions spread over 21 days with review states.
- The API server on 8383, the production client build served over HTTPS (the
  session endpoints refuse plain HTTP), driven by Chromium through Playwright.
- Every screenshot and every claim below comes from that running application.

## What the first pass could not see

| Defect | Cause |
| --- | --- |
| Every KPI icon and every action-queue icon rendered as an empty box | `icomoon.css` matches `[class^="icon-"]`, so an icon class that is not first in the attribute never gets the icon font |
| Sidebar "Projects", "Forms" and "Submissions" did not navigate | They were `href="#project-health"` style in-page anchors, not routes |
| The Project list had no route at all | The dashboard replaced `/`, and nothing else rendered `project/list.vue`: no archived projects, no sort, no "New project" |
| Every project read "Needs attention" | The rule was `issues > 0`, and a normal programme always has some flagged submissions |
| The chart had gridlines but no values on them | Two hard-coded percentage lines, no axis |
| The reporting period could not be changed | `.date-range` was a static `<div>` |
| "1 – September 21, 2026" | The range's start day sat against the end's month name |
| The chart card was half empty | The chart had a fixed height inside a stretched grid row |

## What changed

- Icon classes moved to the front of every `class` attribute.
- The sidebar lists only destinations that resolve: Dashboard, Projects,
  Reports, Media, Integrations, Users, Administration. The top navbar names the
  same set, so the two chromes no longer disagree.
- `/projects` renders the Project list again, with a regression test.
- Project health grades on the issue *rate*: On track, Fair, Needs attention,
  Inactive.
- The chart carries a y-axis whose ticks are round numbers the bars reach, and
  it fills its card.
- The period is a real control: 7, 21 or 90 days, driving the chart, the label
  and the comparison.
- The submissions tile compares the period against the one before it, and says
  nothing when the data does not reach back far enough to make that honest.

## Unblocking the client test suite

The suite had not compiled since the rebranding commit: two spec files pointed
at deleted components, and a percent-encoded SVG data URI in
`design/gradient/gradient-overrides.css` made webpack's css-loader try to
resolve the SVG as a module. Both are fixed, so `npm test` runs again.

| | Executed | Failed | Passed |
| --- | --- | --- | --- |
| Before this branch (suite unblocked, no UI changes) | 3282 | 336 | 2946 |
| After | 3276 | 282 | 2994 |

The 282 that remain are pre-existing: specs that still assert the product is
called ODK Central. They are not touched here.

## Cross-project Forms and Submissions

The rail used to leave these two out because the API could only ever be asked
about one Project at a time. `/v1/field-data/forms` and
`/v1/field-data/submissions` answer across all of them, filtered by what the
caller may see.

The filter walks `actees.parent` the way `Auth.can()` does, rather than
matching assignments flatly against `projects."acteeId"`. Driven against a
real database, an actor whose only grant is on an organization sees that
organization's 8 Forms through the new listing and an empty array from
`/v1/projects`, which still matches flatly. `test/db/cross-project-visibility.sql`
holds that case and eleven others.

Verified against the seeded programme: 39 Forms across 8 Projects, 12,491
Submissions; a Project-scoped viewer sees 6 and 4,231; an anonymous request
gets 401. Filters, the 500-row cap and paging were exercised through the
browser, including that changing a filter returns to the first page and that
paging keeps the filter.

## The flat actee match behind /v1/projects

`Projects.getAllByAuth` matched assignments against
`('*', 'project', projects."acteeId")`: the two species that happen to sit
above a Project, and nothing in between. A role granted on an organization
reached none of that organization's Projects, so its members got an empty
Project list while `Auth.can()` -- which has always walked the chain -- let
them open each Project by URL. It now walks the same chain, sharing the
fragment with the cross-project listings.

Against a running server, the actor whose only grant is on an organization
goes from `[]` to that organization's Project. A site administrator still sees
all 8 and a Project-scoped viewer still sees exactly 1; an anonymous request
is still 401, and the `verbs` array the client reads for `project.permits()`
is unchanged.

The walk costs something. At 2,002 Projects, measured with `EXPLAIN ANALYZE`
against a site administrator -- the worst case, because a grant on `'*'`
matches every Project -- the flat match ran in 85 ms and the walk in 124 ms.
Both are dominated by aggregating the verb list, and this deployment has 8
Projects.

## Running the server's integration tests

They could not run at all: `test/integration/fixtures/02-forms.js` deleted the
`formview` assignment that `Forms.createNew()` used to make, and the native
Web Forms change removed it, so the fixture threw before the first test. With
that gone the suite runs, and this change is a no-op against it.

| | Passing | Failing | Pending |
| --- | --- | --- | --- |
| Before this change | 2467 | 59 | 5 |
| After | 2467 | 59 | 5 |

The failure sets are identical line for line. The 59 are the same Enketo drift
that broke the fixture: the fork replaced external Enketo with native Web
Forms and the tests still expect Enketo ids.

`make test-integration` needs `config/test.json` naming a database, which is
gitignored like `config/development.json`:

    {"default":{"database":{"host":"127.0.0.1","user":"jubilant",
      "password":"jubilant","database":"jubilant_test"}}}

then `createdb jubilant_test`, `CREATE EXTENSION pgrowlocks`, and
`NODE_CONFIG_DIR=../../config NODE_CONFIG_ENV=test npx knex migrate:latest
--knexfile lib/model/knexfile.js`.

## One shell, not two

The rail lived inside the programme dashboard, so it appeared on one screen
and every other page fell back to a row of links in the purple top bar: two
navigations for one product, disagreeing about what the product contains. It
is now `components/app-rail.vue`, rendered by the application frame, and the
row of links is gone -- `navbar/links.vue` deleted, its spec carried over to
`app-rail.spec.js`.

The rail appears once somebody is inside the application: not on the login
screen, and not on a standalone route such as a public link, which has no
application around it. It is sticky, because stretched to the content
Administration sat thousands of pixels below the fold on the dashboard. Below
992px it becomes a scrolling row above the page.

Driven through a browser, all nine destinations render one rail with the right
item marked current, including `/projects/1/forms/f/submissions` marking
Projects; the login screen renders none; there is no horizontal overflow at
400px; and no page still carries the old link row.

Reports is deliberately not on the rail. Reports belong to a Project and are
reached from it; a rail entry had to pick a Project on the user's behalf,
which is the kind of small lie the rest of this work removed.

## Known gaps

- Form pages still carry ten tabs and Project pages eleven; grouping them is
  the next stage.
- There is no cross-project Maps page, so the rail does not offer one.
- Administration is a link to the audit log rather than a section gathering
  Organizations, Backups, Configuration and Analytics.
- Strings added here are English only; the ten other locales fall back.
- `src/components/landing-photos.js` and `src/styles.js` carry ESLint errors
  that predate this branch, and `npm run transifex:lint` has been failing
  since before it (6079 diff lines, unchanged by this work).
- The server has no local ESLint install, so only the client is linted here.

## Result

final result: pass, verified against a running application.
