# G3: image footprints and reviewed change candidates

Submission details → Geospatial verification now accepts two additional cited
review types: a dated image with its footprint, and a before/after change
candidate with two dated image references and their separate footprints. The
reviewer supplies the claim, disposition (supports/conflicts/unclear), reasoning,
limitations and inspection attestation. No image pixels are fetched, interpreted
or classified automatically, and no submission answer or review case is changed.

Footprints are supplied WGS84 GeoJSON Polygon/MultiPolygon geometry in
longitude/latitude order, up to 2,000 vertices and 64 KiB per footprint. Closed,
nonzero, non-self-intersecting rings and valid interior holes are required.
Antimeridian crossings are rejected. The point topology accounts for holes and
multipart shapes. Boundary distance and reported accuracy comparisons use the
existing local equirectangular approximation; they are not certified geodesic
or device accuracy measurements. Overlapping multipart boundaries are treated
conservatively for uncertainty. Supplied geometry and dates remain reviewer
assertions, not verified provider footprints. STAC cell availability is unchanged.

`POST .../geo-assessments/footprint/check` takes exactly sourceFingerprint and
geometry. A currently authorized web User with submission.read can preview the
actual reported point relation (inside/outside/boundary/unavailable), approximate
boundary distance and reported-accuracy relation. It reads current source and
rejects changed fingerprints. No coordinates, geometry or reference URLs are sent
to a provider. Encrypted or unlocated sources return unavailable coverage.

Existing `POST .../geo-assessments` accepts citation kind `footprint` with title,
url, date and geometry, or `change` with before/after references, each containing
those four fields. Dates must be valid, not future, and before strictly precedes
after. Both references require nonsecret HTTPS URLs and explicit inspection.
Supporting or conflicting reviews require the reported point strictly inside
all footprints and its reported accuracy radius contained under the documented
local approximation. Boundary, outside, missing/unknown accuracy and unavailable
location permit an unclear review only. Footprint coverage is always recomputed
on the server under existing source and permission locks; previews are not trusted.

Source snapshots, both dated references, original geometries, computed checks,
reviewer and reasoning are retained in the append-only assessment history and
JSON export. Existing optimistic revisions, idempotent retries, source staleness,
quota, permission, archive, encrypted-source and audit rules apply unchanged.
Changes to external imagery or a reviewer-provided footprint are not monitored;
record another review to revise a claim. A reviewed change candidate is a human
interpretation; cloud masking, pixel analysis, automatic change detection and
empirical effectiveness evaluation remain separate work.
