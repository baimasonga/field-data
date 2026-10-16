# K7: compare asset facts in one historical projection

Managers planning an intervention can compare condition, operator, depth or
other recorded facts for each asset, instead of opening separate projections
whose times may differ. This extends the Knowledge area's decision-specific
projections. It does not complete that area.

## API

`GET /v1/field-data/projects/:projectId/assets/projection?predicate=condition&compare=depth&compare=operator&areaPredicate=district&at=...&knownAt=...`

The primary predicate plus up to four repeated `compare` parameters select at
most five distinct, nonblank fact names of at most 100 characters. Comparisons
require a primary predicate. Duplicates, invalid names, excess comparisons and
an area predicate also selected as a status column are rejected with the existing
asset validation problem. Names are literal data, including punctuation and
JavaScript property names.

When comparisons are requested, each asset has a `facts` object keyed by every
selected name. A missing fact is explicitly null. Facts have the existing value,
state, valid-from and recorded times, pinned claim-version reference, integrity
and freshness metadata. The response adds ordered `columns`, each containing
its predicate, independent summary and optional area summary. The existing
primary `fact`, `summary` and `byArea` remain available. Requests without
comparisons retain their previous response shape.

All columns share the same `at` and `knownAt` and use the passport's current-fact
selection. Only fresh/review-due values enter each column's value counts; unknown,
expired, missing or unverified facts are counted separately. One source becoming
unverified does not change a different source's integrity. Area facts retain the
K6 rule: old area facts may place an asset, with their age counted explicitly.

The existing project/form permissions, exclusion of assets with deleted or
unreadable evidence, current merge/split ownership view, 1000-asset bound,
truncation notice and private/no-store caching apply to the whole comparison.
Historical cutoffs apply to fact validity and recorded time; they do not restore
historical asset ownership or historical access rights. No new tables or migrations
are required.

## User workflow

The Review page's asset status section offers additional-fact checkboxes,
optional area and type filters, an as-of day and a known-by day. Both dates use
the end of the selected UTC day. The result includes one summary per fact,
per-fact area counts and a horizontally scrollable asset matrix. Every populated
cell identifies its freshness, valid-from day and pinned source. Missing facts
remain visible. Source links recheck access at the existing claim endpoint.
Clearing comparisons returns to the original single-fact table.

Validation covers historical selection against the passport, differing source
claims and integrity, unknown/missing facts, independent age policies, area
counts, permission/deletion exclusions, malformed and excessive comparisons,
legacy compatibility, literal names, source links, escaped values and mobile
layout.

Remaining Knowledge work includes maps/location-derived areas, broader and saved
decision projections, answer/semantic retrieval and causal analysis contracts
and diagnostics. This feature does not infer causal relationships, produce
confidence scores or implement export of the comparison.
