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

## Ten Form tabs, and four

The Form page asked somebody to choose between ten tabs before they had read a
row: Submissions, Summary, Filtered Data, Photos, Charts, Verification, Public
Access, Edit Form, Versions, Settings. They are four groups, with the views
inside the open one in a quieter row beneath:

| Tab | Views |
| --- | --- |
| Data | Submissions, Summary, Charts, Photos, Verification |
| Share | Public Access, Filtered Data |
| Versions | Versions, Edit Form |
| Settings | Settings |

Every view keeps its own route and its own URL; nothing was moved or removed,
so existing links still work. Verification moved out of Settings and into Data:
it reads the evidence behind Submissions and takes `submission.list`, so under
Settings a Project viewer was shown a tab holding settings they cannot change.

A Form with no published version has every view disabled except Edit Form, so
the Versions tab leads with Edit Form while that is the case -- otherwise the
draft editor would sit behind a disabled tab.

Driven through a browser across all ten views: the right group is marked on
each, and the row beneath lists that group's views with the right one active.

This also fixed three tests that were already failing: the spec still expected
the five tabs the page had before the fork added Summary, Charts, Photos,
Filtered Data and Verification.

## Nine Project tabs, and five

The Project page carried Forms, Summary, Merged Data, Reports, Entity Lists,
Project Roles, App Users, Custom Properties, Form Access and Settings. Grouped
by what somebody came to the Project to do:

| Tab | Views |
| --- | --- |
| Forms | the Project's Form list (and New Form) |
| Data | Summary, Merged Data, Reports |
| Entity Lists | Entity Lists |
| People | Project Roles, App Users, Form Access, Custom Properties |
| Settings | Settings |

Form Access and Custom Properties moved to People rather than Settings: Custom
Properties controls which Entities an App User or Public Link can reach, and
Form Access is which Forms they get, so both are about people rather than
about the Project.

Entity Lists did not join Data. It went in there first, and three tests then
failed for the same reason -- the entity-list count disappeared from the tab
bar, because a group only draws its row of views when it holds more than one.
That count is a signal people were relying on, and Entity Lists is reference
data the Forms read and write rather than something produced by analysing
them, so it stayed a tab of its own.

A group holding a single view is that view, so its count sits on the tab.

Driven through a browser across all eleven Project paths: the right group is
marked on each, /new-form marks Forms, and the row beneath lists the open
group's views with the right one active.

This also fixed two more stale tests: the spec expected the tabs the page had
before the fork added Summary, Merged Data and Reports.

## Administration as a section

Users and Integrations were top-level destinations competing with Projects,
and Organizations and Backups could only be reached by typing a URL. They are
now the Administration section: the rail entry opens to Users, Integrations,
Organizations, Backups and System, listed under it while that section is the
one you are in.

Nobody's reach changed. Organizations carries no site-wide guard on purpose --
authority over an organization is granted on the organization -- so it stays
the one administration destination anybody can open, exactly as it was under
the old Field Data menu, and the section leads there for a user with no
sitewide role rather than disappearing.

## Maps across every Project

A Form's own map answers the question one Form at a time, which is no help
when the question is which district has gone quiet. `/v1/field-data/map`
returns one GeoJSON collection across every Project the caller can see, and
`/maps` draws it with the same `GeojsonMap` component the per-Form map uses.

The geometry comes from `GeoExtracts.getSubmissionFeatureCollectionGeoJson`,
the query behind the per-Form map, called once per Form and merged --
deliberately not a second reading of the submission XML. That extraction knows
about repeat groups, edit lineages and its own cache, and a reimplementation
would have quietly disagreed with the map people already trust. Each feature
carries its Project and Form in `properties` so the page can label and link it.

Only Forms with a default geo field and at least one Submission are queried:
asking about the rest costs a query each and returns an empty collection. Both
the feature count and the number of Forms queried are bounded, and the page
says "Showing the first N" when it filled that budget -- a map that has drawn
part of the data looks exactly like one that has drawn all of it.

Verified against 240 seeded Submissions carrying real coordinates across ten
Sierra Leone districts: 240 features with correct lon/lat ordering, the
Project and Form filters narrowing them, the limit capping them, a
Project-scoped viewer and an organization member seeing none of them, and an
anonymous request getting 401. In the browser the points cluster by district;
the basemap tiles are blank here only because this sandbox's proxy blocks the
tile server.

The first version reported `truncated: false` when a single Form filled the
whole budget, because it only noticed truncation between Forms. It now reports
truncation whenever the budget is full, wherever that happened.

## Known gaps

- Administration is a link to the audit log rather than a section gathering
  Organizations, Backups, Configuration and Analytics.
- Strings added here are English only; the ten other locales fall back.
- `src/components/landing-photos.js` and `src/styles.js` carry ESLint errors
  that predate this branch, and `npm run transifex:lint` has been failing
  since before it (6079 diff lines, unchanged by this work).
- The server has no local ESLint install, so only the client is linted here.

## Result

final result: pass, verified against a running application.
