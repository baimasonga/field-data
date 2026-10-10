# G1b: satellite imagery availability

Status: contract decided 2026-10-10 under the project owner's delegated
authority (the owner was away and asked for the work to continue). The ledger
already selects public Sentinel-2 imagery through an open STAC catalogue. The
decisions below can be revisited; the feature is **off until an operator turns
it on**, so nothing is sent anywhere before that.

Before any satellite check can say "the satellite shows a building here", a
reviewer needs to know whether usable imagery of the place exists around the
time of the visit. G1b answers only that: for each located submission, which
Sentinel-2 scenes cover the place within a window around the capture time, and
how cloudy they were. It does not download or interpret imagery, and it makes
no finding: it is evidence beside the location components G1 already shows.

## What it does

- For a form, on request ("Check imagery availability" on the Verification
  page, for people who can change submissions: `submission.update`), each
  submission with a
  usable location is looked up in a STAC catalogue for the `sentinel-2-l2a`
  collection, within ±30 days of its capture time (receipt time when there is
  no capture time, and the report says which).
- Per submission it records: scenes found, the scene nearest in time (date,
  days from the visit, cloud cover), and the clearest scene in the window
  (date, cloud cover). Scene IDs are kept so a later slice can fetch them.
- Shown on the Verification page as a coverage line ("41 of 52 submissions
  have a scene under 30% cloud within 30 days") and per submission in the
  evidence list. It is not a finding and does not touch review cases.

## Privacy: what leaves the server

Coordinates of respondents' homes must not be sent to a third party. The
lookup sends the **centre of a 0.05° grid cell** (about 5.5 km) containing the
point, never the point itself. Sentinel-2 tiles are about 110 km across, so
availability for the cell is availability for the point; the rare point on a
tile edge is reported by the cell, and the report says coverage is by cell.
Capture times are sent rounded to the day. Nothing else about the submission
is sent.

## Operation

- Off unless `FIELD_DATA_IMAGERY_ENABLED=true`. The catalogue URL is
  configurable (`FIELD_DATA_STAC_URL`, default Earth Search
  `https://earth-search.aws.element84.com/v1`). On Cloudflare, both are Worker
  variables passed to the container (`cloudflare/worker.js`); setting
  `FIELD_DATA_IMAGERY_ENABLED` to `true` there and redeploying turns it on, and
  removing it turns it off. The cache table stays either way.
- Results are cached by (cell, day window, collection, catalogue) in
  `field_data_imagery_lookups`, so repeated checks and nearby submissions cost
  one request. A cached answer older than 7 days is refreshed when asked.
- At most 500 located submissions per request (the most recently received
  first; the answer says when it was cut short); at most 4 catalogue requests
  at a time, each with a 15 s timeout. A failed or slow catalogue marks the
  cells "unavailable, try again" without failing the request or caching the
  failure.
- Encrypted forms and submissions without a usable location are counted, not
  looked up.

## API

- `POST /v1/projects/:projectId/forms/:xmlFormId/imagery/check`
  (`submission.update`): looks up the form's located submissions; returns
  counts (`submissions`, `located`, `considered`, `truncated`, `lookups`,
  `looked`, `cached`, `unavailable`). 501.12 when the feature is off.
- `GET .../imagery` (`submission.list` and `submission.read`): whether the
  feature is on, the settings, per-submission results (`checked`,
  `not-checked`, `no-location`; for checked: scenes, scenes under 30% cloud,
  nearest and clearest scene, whether the visit is dated by capture or receipt
  time) and coverage counts. Works when the feature is off, to say so.

## Not in this slice

Fetching or showing imagery, cloud masking, change detection, other providers
or collections, automatic checks on new submissions.

## Acceptance

- Recorded catalogue responses (a real Earth Search answer for Freetown is the
  fixture): nearest and clearest scenes chosen correctly; empty results;
  catalogue errors and timeouts recorded as unavailable and not cached.
- The request sent carries the cell centre and the day window only (checked).
- Cache: two submissions in one cell and window make one request; a stale
  cache entry is refreshed.
- Off by default (503); limits; permissions as other integrity routes.
- Browser: coverage line and per-submission evidence; the button absent when
  the feature is off.
- Not part of this acceptance: a live run against the real catalogue from the
  deployed server, which needs an operator to enable it.

## Validation evidence

Locally, against real PostgreSQL 16, with the catalogue replaced by a real
Earth Search answer recorded on 2026-10-10 for the cell holding central
Freetown (15 scenes from 2026-08-23 to 2026-10-07, the clearest 41.7% cloud:
rainy season, so no scene under 30%):

- Unit: 6 tests (`test/unit/util/imagery.js`): cell centres (every point in a
  cell gives the same cell; negative coordinates), whole-day windows, the exact
  search sent, nearest and clearest scene from the real answer, empty and odd
  answers, and catalogue errors, bad answers, unreachable and timed-out
  catalogues reported rather than thrown.
- Integration: 3 tests (`test/integration/api/field-data-imagery.js`): off by
  default (501.12) while the read route says so; two submissions in one cell
  and day make one request, whose body is exactly the cell centre, whole-day
  window and fields (no coordinates, times or IDs of submissions); the second
  check is answered from the cache; coverage and per-submission results; the
  cache row holds no submission data; a failing catalogue is reported, not
  cached, and retried next time; a stale answer is refreshed; viewers read but
  cannot check; App Users refused; unknown form 404. The migration is in the
  rollback chain.
- Browser: 2 tests (`e2e-tests/tests/field-data-imagery.spec.js`): coverage
  line, check button and report (including a place the catalogue could not
  answer), scenes per submission with links, narrow width; with the feature
  off, the section says so and offers no button.
- Deliberate breakages: 8 in the server and helper (feature flag, extra data
  sent, exact point sent, failures cached, staleness ignored, no de-duplication
  by cell and day, permission check removed, cell rounding removed); each made
  a test fail (the extra-data one only after the test pinned the exact request).

- Gates: CI integration set 78, feature set 22, server unit 1,749 (1 existing
  pending), Worker tests 6, server and client lint, production build, full
  browser suite 101.

Not run here: a live check from the deployed server, which needs an operator
to set `FIELD_DATA_IMAGERY_ENABLED=true`. A single manual request from the
development container to Earth Search succeeded (the recorded fixture).
