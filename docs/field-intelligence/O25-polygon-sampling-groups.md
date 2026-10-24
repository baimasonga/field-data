# O25: backcheck sampling by geographic polygon groups

Manual and daily/weekly scheduled draws can group a recorded geopoint by named
areas. Under **Verification & planning → Random backcheck sample**, choose
collector/answer grouping and a geopoint question, then upload **Sampling areas
GeoJSON**. The file must be a WGS84 FeatureCollection, with a distinct string
`properties.name` on each Polygon or MultiPolygon feature. Holes are supported.
No remote map service is contacted; changing a separate project map layer does
not change a saved sampling design. Download saved/recorded areas to inspect or
reuse their exact definitions.

## Membership and rates

GeoJSON coordinates are longitude, latitude; submission geopoints are latitude,
longitude, with optional altitude and accuracy. A point on a computed boundary
belongs to that polygon, including hole boundaries; a point inside a hole does
not. Multiple components of one MultiPolygon form one named area. A point in more
than one named area, including shared boundaries, belongs to **Overlapping areas**
rather than receiving an arbitrary priority. Points in no named area belong to
**Outside areas**. Empty/missing answers remain **Missing answer**. None of these
groups is excluded, and all can use different rates through **Add group rate**.
Unspecified rates use the default; existing rounding and minimums still apply
within every collector × group intersection.

Membership uses device-reported coordinates without an accuracy buffer. It does
not establish verified presence or account for measurement uncertainty at a
boundary. Malformed, out-of-range, null-island (0,0), or otherwise invalid geopoints
refuse a manual draw and pause a schedule atomically. Low reported accuracy does
not silently exclude a point. Altitude must be finite when present; accuracy must
be finite and nonnegative when present. Extra coordinate components are rejected.

## Bounded contract and API

Manual POST and schedule PUT accept `groupAreas`, for example:

```json
[{"value":"North","geometry":{"type":"Polygon","coordinates":[[[10,10],[12,10],[12,12],[10,12],[10,10]]]}}]
```

A nonempty list requires `groupField` naming an unencrypted, nonrepeating scalar
geopoint question. It cannot coexist with `groupBreaks`. Scalar-answer and numeric
sampling retain their prior shape and behavior. Nonempty polygon settings are
saved in a nullable JSONB schedule column; omitted/empty areas clear that setting
on PUT. To return to collector-only sampling, omit the grouping question too.
Disabling a saved schedule remains possible when its question is unavailable.

Limits are 20 named areas, 2000 vertices in total, 64 KiB of area settings and
200 characters per name before and after NFC normalization/trim. Names are distinct
and case-sensitive; Outside areas, Overlapping areas and Missing answer are
reserved. Only two-dimensional WGS84 Polygon/MultiPolygon coordinates are accepted.
Rings must close, enclose nonzero area and avoid self-intersection. Holes must be
strictly inside their outer ring, without touching/crossing/nesting other holes.
Antimeridian-crossing geometry is unsupported. Containment is planar on longitude
and latitude, intended for project-scale areas rather than geodesic global regions.

Areas are sorted by normalized name before hashing/saving, so reordering area
features safely replays a manual request ID. Changing a geometry with that ID is
refused. Ring/vertex order is retained as uploaded. Rate rules must target a named
area, Outside areas, Overlapping areas, or null for missing. Changing the uploaded
areas or question clears edited rate overrides in the UI.

To keep draws bounded, eligible count × total vertices must not exceed ten million
work units. Exceeding that limit refuses a manual draw before writes; scheduled
runs record an oversized-period failure without pausing, as with the existing total
sample limit. Use simpler geometry or a narrower reviewed received-date window.
Existing 50,000-eligible and 500-selected limits remain in force.

## Reproduction, history and scheduling

Only final group membership is added to retained eligible rows, not raw location
answers. Canonical polygon definitions and rates are included in immutable sample
settings and audits. Reproduction uses recorded group memberships, settings and
seed; later source edits, uploads or schedule changes cannot rewrite a draw.
Coverage shows named areas, outside, overlap and missing groups with their effective
rates and eligible/sampled/requested/linked counts. Saved and recorded GeoJSON
exports retain the exact polygons associated with that design.

The existing locks, source exclusion, human review/independent assignment, UTC
periods, catch-up and transaction retries are shared with other sampling modes.
The runner rechecks read/list/update permissions, active project/form and current
geopoint-field availability. Unsafe answers roll back the sample and sample audit
and pause with a failed run; no partial selection survives. Re-enabling starts a
new period as before. Area/rate edits preserve the current period boundary.
Migration up is idempotent; rollback retains configured areas and can drop/recreate
an unused column without silently changing a design.

## Validation and remaining scope

Unit tests cover geometry/limits, holes, multipolygons, edges, overlap, outside,
missing, invalid points and normalized setting/rate validation. PostgreSQL tests
exercise actual manual/scheduled draws, canonical retries, immutable group-only
snapshots/audits, catch-up, clearing, atomic refusal/pause, type restrictions,
work bounds and rollback/reapply. Browser checks cover file validation, retries,
saved reload, changed-area rate clearing, coverage, exports and mobile controls.

[O26](O26-sampling-design-weights.md) adds design weights. Calibrated estimates, map-based area editing, geodesic/global strata,
uncertainty-aware assignment and automatic updates from reference layers remain
separate work. Operational counts are not weighted population or measured error
estimates. Operations and the eight-area programme remain partial.
