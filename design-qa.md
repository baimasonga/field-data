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

## Known gaps

- Cross-project Forms and Submissions pages do not exist, so the rail does not
  offer them.
- `src/components/landing-photos.js` and `src/styles.js` carry ESLint errors
  that predate this branch.

## Result

final result: pass, verified against a running application.
