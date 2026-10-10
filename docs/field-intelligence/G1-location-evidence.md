# G1: location evidence and deterministic spatial checks

Status: contract agreed 2026-10-10 (withdrawn outcome; 100 m thresholds).

First slice of the geospatial area (row 5 of the delivery ledger). It covers the
parts that need no outside provider: breaking a submission's location into the
facts it rests on, and three deterministic checks that a reviewer can inspect.
Imagery is limited to an optional second step (G1b) that reports which satellite
scenes exist; it does not interpret pixels.

## What already exists, and is reused

- `lib/util/fieldwork-integrity.js`: geopoint parsing (`0 0` and unparseable
  values are treated as no location), haversine distance, and the
  `implausible-travel` rule (v1).
- `field_data_integrity_flags`: one row per finding, keyed by form, rule, rule
  version and submission(s); `concern` or `inconclusive`; a person moves it
  `open → investigating → resolved` with a decision (`data-error`, `explained`,
  `unresolved`, `substantiated`). Re-running refreshes evidence and never touches
  a person's decision.
- `POST/GET/PATCH /projects/:projectId/forms/:xmlFormId/integrity[/run|/:id]`
  and the Verification panel (`components/submission/verification.vue`).
- Review cases already read a submission's findings, snapshot them into a
  decision, and refuse an override when nothing is unresolved.
- Project map layers: uploaded WGS84 GeoJSON (Polygon/MultiPolygon allowed,
  closed rings, ≤ 5,000 features, ≤ 50,000 vertices), managed with
  `project.update`.

G1 adds rules to this framework and does not create a second findings store.

## Location components

For each submission the evidence read-out gains a `locationComponents` object.
Each part is a separate, named fact. There is no combined score.

| Component | Values | Source |
| --- | --- | --- |
| `present` | `yes`, `no`, `unparseable`, `null-island` | first geopoint answer |
| `field` | form path of the geopoint used | form definition |
| `reportedAccuracyM` | number or `null` ("not reported") | 4th geopoint part |
| `accuracyBand` | `≤10`, `≤30`, `≤100`, `>100`, `unknown` | from above |
| `withinProjectArea` | `inside`, `outside`, `near-edge`, `no-area-set`, `not-checked` | rule below |
| `repeatedExactly` | count of other submissions with identical coordinates | rule below |
| `captureTime` | `device-audit-log` or `unavailable` | existing evidence |

Limits, shown with the components (existing wording kept): a location shows
where a device believed it was, not that anybody was present; accuracy is the
device's own estimate.

## Rules

All three are versioned like `implausible-travel`. Thresholds are fixed per rule
version and returned in the run response; changing one means a new version, so
older findings stay readable as what they were.

### `location-accuracy` (v1), per submission

- `concern` when reported accuracy is worse than 100 m (the existing
  `maxUsableAccuracyM`).
- Not stored: accuracy within the limit; accuracy not reported; no location.
  These are counted in the run summary and shown in the components, so they are
  visible without creating a finding for every submission of a form whose
  location question is optional.
- Evidence: accuracy, field path, the threshold.

### `outside-project-area` (v1), per submission

Runs only when the project has a designated project area (below).

- Point-in-polygon on longitude/latitude, honouring holes and MultiPolygons.
- Distance to the boundary is measured with a local equirectangular
  approximation, adequate at project scale and stated in the evidence.
- The point's own uncertainty is given away first: tolerance is the reported
  accuracy, or 100 m when none is reported.
- `concern`: outside, and farther from the boundary than the tolerance.
- `inconclusive` (`near-edge`): outside, but within the tolerance.
- Inside: not stored.
- No location: not stored (counted).
- Evidence: layer ID, layer revision, SHA-256 of the area geometry, distance to
  boundary, tolerance used and why.

### `repeated-location` (v1), across submissions of one form

Identical coordinates to every digit the device reported, with at least 5
decimal places, across different submissions. That pattern is typical of a
device re-using a cached fix or of copied values.

- One finding per later submission, related to the earliest one with the same
  coordinates (`relatedInstanceId`), so a group of _n_ makes _n − 1_ findings,
  not _n²_.
- Fewer than 5 decimal places: not checked (too coarse to mean anything) and
  counted.
- Coordinates that are merely close are **not** in this rule. Neighbouring
  households are legitimately close; proximity needs per-project judgement.
- Evidence: the coordinates, both instance IDs, whether the submitters and
  devices are the same or different (recorded, not judged).
- Stated in the evidence: shared compounds, revisits and repeat interviews are
  ordinary explanations.

## Designating the project area

A project manager (`project.update`) marks one uploaded GeoJSON layer as the
project area. It is stored as `definition.role = 'project-area'` on the
existing layer. That needs no schema change, and the advisory lock already used
for layer writes enforces at most one per project.

- Only uploaded layers with at least one Polygon or MultiPolygon qualify. Remote
  WMS/tile layers are refused, because their geometry is not available.
- A layer crossing the antimeridian is refused for this role (not relevant to
  current projects, and planar containment would be wrong).
- Self-intersecting polygons are not detected by the current layer validation.
  Containment on such a polygon is undefined, so the run reports the area as
  unchecked when a ring self-intersects.
- Changing or removing the area does not delete findings. Their evidence names
  the layer revision they were computed against.

## Running and re-running

The existing `POST .../integrity/run` runs every rule, including the new ones,
and its response lists each rule with its thresholds and counts (examined,
concerns, inconclusive, not stored with reasons).

**Findings no longer observed (decided: `withdrawn`).** When a later run no longer
finds an open G1 finding's condition (for example after the area was corrected),
its outcome becomes `withdrawn` and its evidence records the run time. A person's
status, decision and note are never changed. Review cases treat a withdrawn
finding like a resolved one: it does not count as unresolved. If the condition
returns on a later run, the outcome is set back from the new evidence. This
applies to the G1 rules only; `implausible-travel` keeps its current behaviour.

## Review integration

Open G1 `concern` findings add reason codes to the submission's open review case,
using the same trigger pattern that already routes missing capture time:
`location-accuracy-poor`, `location-outside-area`, `location-repeated`.
`near-edge` (inconclusive) adds no reason code.

## API

No new routes for the checks. Additions:

- `GET .../evidence`: each submission gains `locationComponents`; `coverage`
  gains counts by accuracy band and project-area status.
- `PUT /projects/:projectId/map-layers/:id` accepts `role: 'project-area' | null`
  with the existing `If-Match` revision.
- New problem `400.54 projectAreaUnsupported` (remote layer, no polygon,
  antimeridian).

## Data and migration

- No new table. One migration adds the reason-code routing trigger for the three
  codes (same pattern as `20260924-06`), with a rollback that drops it.
- `withdrawn` needs no column change: `outcome` is text.

## Not in this slice

Geotrace/geoshape answers; second and later geopoints in a form (the existing
evidence uses the first); proximity clustering; travel between collectors; any
imagery analysis; sensitive-coordinate generalisation for broad-access maps (the
checks expose coordinates only to people who can already read the submission).

## G1b (separate PR, after G1): imagery availability, metadata only

An adapter for a public STAC catalogue (Sentinel-2 L2A via an open STAC API)
that answers, for a submission's location and capture date, which scenes exist
within ±N days, with acquisition time, tile ID, cloud cover, processing level,
licence and a link. Outcomes: `covered`, `covered-cloudy`, `not-covered`,
`provider-unavailable`. It does not support or refute any claim. Outbound calls
reuse the existing safe-URL resolver. Tests use recorded responses only; a live
call is a separate acceptance gate, as the ledger requires.

## Acceptance (G1)

Through the real API and a browser flow:

- Locations: valid; `0 0`; unparseable; missing; accuracy missing; accuracy at
  exactly 100 m and just above; form with no geopoint question.
- Area: inside; outside far; outside within accuracy; on the boundary; inside a
  hole; MultiPolygon; no area set; remote layer refused; non-polygon layer
  refused; area changed between runs (evidence names both revisions).
- Repeats: identical pair; group of three (two findings); same coordinates with
  4 decimals (not checked); same versus different collectors recorded.
- Lifecycle: re-run keeps decisions; deleted and draft submissions excluded;
  edited submissions use the current version; encrypted forms reported as
  unchecked.
- Permissions: viewers cannot run checks or set the area; other projects 404.
- Review: concern adds the reason code to the open case; resolved finding no
  longer blocks; decision snapshot includes G1 findings.
- Migration rollback and reapply.
- Known limit to state: the existing evidence query loads every submission of a
  form per run. G1 keeps that and records it; large forms are a later concern.

## Validation evidence

Locally, against real PostgreSQL 16 and the real form compiler:

- Unit: 16 tests of the pure rules (`test/unit/util/location-evidence.js`),
  including holes, MultiPolygons, the boundary itself, the antimeridian and
  self-intersection refusals, the 100 m accuracy edge, precision of repeats.
- Integration: 6 tests (`test/integration/api/field-data-location-evidence.js`)
  through the real routes: all three rules with their evidence and counts;
  location components and coverage; project-area designation (polygon only,
  role moves between layers, kept through an edit, refused for points and
  self-intersecting rings, `project.update` required); withdrawal on a later
  run, keeping the reviewer's status and note, and restoring the same row when
  the condition returns; no withdrawal when the area is removed; review routing
  of the reason code; acceptance no longer blocked by a withdrawn finding; a
  form with no location question.
- Deliberate breakages: 5 in the rules, 6 in the server wiring and 3 in the
  client; each made at least one test fail.
- Gates: the CI integration set (53 tests, now including this file and the
  migration in the claims rollback chain), the feature set (22), server unit
  (1,667 passing, 1 existing pending), hardening (62), server and client lint,
  production client build.
- Browser: 3 new tests (`e2e-tests/tests/field-data-location.spec.js`):
  rule-specific findings, withdrawn state, run report, unset area, narrow width,
  and marking a boundary as the project area with a refusal shown once. Full
  browser suite: 83 passed; the one failure (`compiled advanced form…`) fails
  identically on unmodified `main` in this sandbox and passes in CI.

Not covered by tests here: encrypted forms (handled by not reading locations, as
stated above), and deleted, draft and edited submissions (handled by the
existing evidence query, unchanged). Not run here: CI on this branch, the
client Karma suite, and any real device or field data.
