# K6: asset status by area

Status: next slice chosen by the project owner ("focus on the features:
investigation outcomes, asset status by area, scheduled back-check samples",
2026-10-11); details open to revision.

K3 shows one fact (for example `condition`) for every asset of a project,
with a count by value of what is still current. A manager planning repairs
needs the same count for each district or chiefdom. K6 groups the K3 table
by area: the "aggregation by area" left open by K3, in the knowledge row
(decision-specific twin projections).

## What an area is

Assets have no location of their own; what they have are recorded facts. An
**area** is the value of another recorded fact of the asset, chosen by the
manager (for example `district`). Each asset's area is its current fact for
that predicate, chosen exactly as the passport chooses it (the same `at` and
`knownAt`), when its state is known and its value is not empty. Other assets
are grouped under "no area recorded", last.

An area is used whatever its freshness: a district rarely changes, and
leaving out an asset because its district fact is old would hide it.
Instead each area says how many of its assets are placed by an area fact
that is no longer fresh or due for review (`areaNotCurrent`), and the page
says so. The status counted in each area keeps the K3 rule: only fresh or
review-due facts count by value.

## API

The K3 projection takes an optional `areaPredicate`:

`GET /v1/field-data/projects/:projectId/assets/projection?predicate=&areaPredicate=&assetType=&at=&knownAt=`

With it, each asset also has `area` (its area fact, shaped like `fact`, or
null) and the response has
`byArea: [{ area, assets, areaNotCurrent, byValue, byStatus }]`, ordered by
area name with "no area" (`area: null`) last. `areaPredicate` needs a
`predicate`, must differ from it, and is at most 100 characters; otherwise
400 (the asset problem). Without it the response is as before. Permissions,
exclusions and the 1000-asset limit are those of K3; areas count only the
assets shown.

## UI

Review page, "Asset status across the project": a "By area (optional)"
picker listing the other recorded facts. With an area chosen, a table by
area (assets, current values, assets not counted by value) above the asset
table, and a note on area facts no longer current.

## Not in this slice

Areas from locations or boundaries (assets have no geometry yet), maps,
several facts at once, nested areas, export.

## Acceptance

- Unit: grouping, unknown and empty areas last, `areaNotCurrent`, per-area
  summary keeping the K3 rule.
- Integration: an area moved by a later fact, an old area fact still
  placing an asset and counted, assets without an area, earlier `at`,
  responses unchanged without `areaPredicate`, refused parameters.
- Browser: area picker without the shown fact, request, area table, note,
  back to no grouping, narrow width.

## Validation evidence

Locally, against real PostgreSQL 16:

- Unit: `test/unit/util/asset-projection.js` (3 tests; 1 new for areas).
- Integration: `test/integration/api/field-data-asset-projection.js` (3 tests; 1 new):
  - areas chosen as the passport chooses them, including a later fact moving an asset;
  - an expired area fact still placing an asset, counted in `areaNotCurrent`;
  - assets without an area, grouped last;
  - an earlier `at`;
  - the response unchanged without `areaPredicate`;
  - four refused parameter cases.
- Browser: `field-data-review.spec.js` asset status tests (3; 1 new):
  - the area picker leaves out the fact being shown;
  - the request sent;
  - the area table and the note on old area facts;
  - going back to no grouping;
  - narrow width.
- Deliberate breakages: 7 in the server and 4 in the client; each made a test fail.
