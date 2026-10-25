# Knowledge workspace

Open **Review → choose a project → Open Knowledge workspace**. The workspace
uses current project and submission-read permissions, including for historical
queries. Project managers can save shared definitions and identity decisions;
readers can inspect and evaluate permitted evidence. Existing passports,
correction/merge/split history, expiry policies and re-verification remain available.

## Maps and location areas

Choose the exact location fact name, then rebuild. The map and its selectable
table show cited fresh, source-verified locations. Missing, stale, unknown or
unverified facts are withheld. Download either the complete cited evaluation or
GeoJSON. The export includes cutoffs and the definition used.

Optionally import a GeoJSON FeatureCollection of named Polygon/MultiPolygon areas
and choose its label property. Edit names before evaluating. Limits are 20 areas,
2,000 vertices and 64 KiB. Invalid rings, self-intersections and antimeridian
crossings are rejected. Holes are supported. Classification distinguishes outside
and overlapping areas; a reported accuracy radius touching a boundary is marked
uncertain. Coordinates are evidence reported by a source, not surveyed certainty.

Coordinates and exports use WGS84 longitude/latitude. Leaflet displays Web
Mercator; locations beyond ±85.05112878° remain in the table/export and are
explicitly omitted from the map. Fixed-size point markers do not encode counts;
metre circles show reported accuracy. The map starts without external tiles.
Optional OpenStreetMap tiles have visible attribution and send tile requests to
the provider only when enabled. Tile failures leave the evidence and table usable.
Pan is opt-in, scroll zoom is disabled, and table/previous/next controls support
selection without dragging. Overlapping markers remain individually selectable.

## Image identity review

Choose any two readable assets, specify the exact photo fact name and compare.
The existing source service resolves each fresh fact to its cited PNG/JPEG
attachment. The browser verifies both SHA-256 byte hashes before displaying them.
It compares a 63-bit low-frequency DCT perceptual hash, a 64-bit horizontal edge
hash and a 24-bin colour histogram. Similarity requires at most 12 perceptual-bit
and 16 edge-bit differences and histogram L1 difference at most 0.5. These fixed
review thresholds are uncalibrated and are not an identity probability.

Comparison runs locally without uploading photos to an external model. Images
are bounded by the existing 5 MiB service limit and 16 million decoded pixels,
with no dimension above 10,000. Unsupported/invalid images fail explicitly;
greyscale variance below 15 yields an inconclusive result. Crop, rotation,
viewpoint, lighting and visually identical objects can defeat comparison.
Human reviewers retain source links and can open passports to use the existing
reasoned merge/undo flow. A manager can record a distinct-asset decision only
after both verified previews load, review acknowledgment and a reason. Existing
identity history supports withdrawing that decision. Attachment replacement is
reflected on the next comparison: a cited claim is not proof that the current
attachment bytes are the original capture.

## Answer and semantic retrieval

Choose literal or semantic retrieval and optionally narrow by form and exact
field paths. Results cite pinned claim versions; repeated values include their
field path and ordinal. Asset facts additionally expose validity, freshness and
source verification. Retrieval never learns statistics from another project or
an unreadable source, and there is no shared index or external model call.

The `request-local-latent-semantic@1` method tokenizes and normalizes visible text,
constructs normalized TF-IDF vectors and a deterministic low-rank approximation
using orthogonal power iterations. It uses at most 768 documents, 512 terms and
24 latent dimensions (12 iterations per dimension). Literal matches sort first;
other matches require cosine at least 0.2. Cosine measures corpus association,
not correctness or confidence. An unseen query or insufficient corpus may yield
no semantic matches. English stopwords and limited in-corpus associations are
explicit limitations; this is not an externally pretrained language model.

Each source window contains at most 100 latest submission versions as of the
knowledge cutoff. Extraction is bounded to 30 non-binary fields/source, eight
repeated values/field, 1,000 extracted answer rows and 256 KiB source XML. Up to
256 facts and 256 asset descriptions may contribute. The screen reports bounds,
coverage and any next window. Narrow field paths to reach other fields. Next
window preserves the original knowledge cutoff; each window has its own model.
Encrypted, oversized, tampered and unreadable source answers are withheld.

Downloaded retrieval snapshots include the request, cutoffs, corpus fingerprint,
method diagnostics and citations. They can be inspected offline or rerun against
current permissions. Deletion/revocation can change a rerun; it never restores
access to historical data that is no longer readable.

## Decision projections and shared definitions

Create up to 20 explicit rules with exact fact names, equality/inequality or
finite numeric comparisons, priority 1–5 (1 highest) and a review action. A rule
matches only a known, fresh, source-verified fact; invalid numeric or unavailable
facts cannot silently become matches. Results expose each matched rule and
citation and distinguish insufficient evidence from no rule match. Actions are
review suggestions; they do not dispatch work or create tasks.

Maps, decision rules and causal contracts can be saved as shared project
specifications after an explicit sharing acknowledgment and revision reason.
Up to 100 definitions/project and 500 immutable revisions/definition are retained.
Optimistic revision checks prevent overwriting another editor. A lost save
acknowledgment retains the exact request identity and body for an idempotent
retry. A conflicting revision requires refreshing history. Archive preserves
history, and old revisions can be loaded as drafts or evaluated directly.
Definition metadata is shared with project readers; evidence is independently
permission checked on every evaluation.

Use UTC valid-at and known-at cutoffs to distinguish when a fact was valid from
when it was recorded. Snapshots rebuild observation ownership as known then,
including merges/splits subsequently undone. Later evidence is excluded from
older knowledge cutoffs. The asset frame is capped at 1,000 with truncation
reported; exact fact inputs are capped at 12. An asset with currently unreadable
owned source evidence is withheld entirely. Downloaded evaluations retain the
actual cited inputs and definition; rebuilds enforce current source access.

## Causal contracts and diagnostics

Declare treatment, outcome, categorical adjustments and a directed acyclic graph.
The optional confounder template is editable; it does not discover causal edges.
Graphs allow up to 12 nodes, 40 edges and five adjustments. Review a rationale
and explicitly declare exchangeability, consistency, positivity, no interference,
temporal order and independent units. Software cannot certify these assumptions.

The estimator targets the complete, fresh, source-verified visible assets meeting
the timing contract at the selected snapshot. Treatment must be exactly `0` or
`1`; outcome must be finite numeric. Adjustments must precede or coincide with
treatment, and outcome must follow treatment. No extrapolation is made to
missing, withheld or otherwise excluded assets.

Graph diagnostics reject cycles, treatment-descendant adjustment and absence of
a directed treatment-to-outcome path. They enumerate backdoor paths and test
collider/non-collider blocking including conditioned descendants. Diagnostics
are bounded to 20,000 traversals/10,000 paths and withhold if capped. Missing
assumptions, a validity horizon after the knowledge cutoff, truncated frames,
invalid timing, more than 100 strata or inadequate overlap also withhold estimates.
Every stratum needs at least two treated and two controls for variance diagnostics.

For eligible stratum s, weight w_s = n_s / N. The estimate is
`sum_s w_s * (mean(Y_treated,s) - mean(Y_control,s))`.
Its conditional variance is
`sum_s w_s² * (sampleVariance(Y_treated,s)/n_treated,s + sampleVariance(Y_control,s)/n_control,s)`.
The displayed normal interval is estimate ± 1.96 standard errors. It assumes
independent units and treats observed stratum weights as fixed. Shared outcome
source groups, exclusions, arm counts, open backdoor paths and input citations
are exposed for review. This interval describes conditional sampling uncertainty,
not causal certainty. Unmeasured confounding, selection, measurement and
small-sample limitations remain. Field/model-effectiveness studies belong to
the separate pilot; fixture results do not validate those assumptions.

## Acceptance evidence

`test/unit/util/knowledge-models.js` and `knowledge-retrieval.js` cover graph
identification, hand-calculated adjusted effects/variance, withholding, geography,
action rules and genuine non-literal corpus associations. The Knowledge API suite
covers live PostgreSQL source permissions/deletion, source hashes, temporal
ownership, late evidence, repeat/namespace extraction, revision concurrency,
idempotency and retained migration history. Knowledge browser scenarios in
`field-data-review.spec.js` exercise all tools, mobile exports, failed tiles,
lost acknowledgments, stale saves, source denial, arbitrary image pairs,
actual PNG/JPEG content comparison and low-information withholding. Broader
server, client and browser regression gates remain required before release.
