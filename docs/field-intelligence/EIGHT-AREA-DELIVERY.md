# Eight-area implementation and acceptance programme

Authorized programme: implement all eight remaining Field Intelligence areas,
then test each feature through its actual API and user workflow. Merge only after
required CI gates pass. A merged foundation is not completion of a whole pillar.
This ledger supplements the historical Phase 0 plan.

| First-slice order | Area | Deliverables | Full acceptance evidence |
| --- | --- | --- | --- |
| 1 | Knowledge | Project asset identities; source-linked temporal facts; correction/merge/split history; freshness/expiry policies; re-verification tasks; cited retrieval; decision-specific twin projections; causal analysis contracts | Ambiguous identities; reversible merges/splits; late evidence; time-travel queries; permission revocation; projection rebuild; citations; expiry/renewal; explicit causal assumptions and diagnostics |
| 2 | Evidence/trust | Queryable evidence graph; presence components; nonce capture challenges; replay checks; survey timeline; signed witnessing; sensor corroboration | Missing/contradictory signals; replay; accessible alternatives; device clocks; real device capture; beacon/key revocation; calibrated score limitations |
| 3 | Offline resilience | Resumable priority uploads; signed manifests/bundles; receipt/custody ledger; encrypted relays/courier import; offline assignments/reference data | Disconnect/retry/reorder/duplicate; interrupted media; expired permissions; tamper/quarantine; physical relay and device tests |
| 4 | Operations | Deduplicated tasks; sampling coverage; independent backcheck allocation; capacity/route planning; accessibility history | Infeasible constraints; budget/independence; geography/safety; fair coverage; field closure with fresh evidence |
| 5 | Geospatial | Uncertainty components; imagery adapters; temporal claim verification; candidate change detection; reviewed feedback | Imagery dates/coverage; unavailable provider; coordinate uncertainty; seasonal/viewpoint confounding; held-out labelled evaluation |
| 6 | Fraud intelligence | Deterministic contradictions; investigation records; similarity/identity-reuse signals; collusion subgraphs; targeted instruments; calibrated triage | Legitimate shared identities; strata; explainable evidence; false-positive evaluation; human disposition; independent backchecks |
| 7 | Adaptive surveys | Static survey doctor; reproducible simulations; answer uncertainty; approved policy graph; reviewed evolution; draft generation; conversational language support | Unreachable/cyclic paths; schema/version preservation; approved bounds; multilingual/device pilot; reproducible findings |
| 8 | Multimodal | Reviewed photo/voice extraction; asset/module suggestions; guided capture; source-grounded drafts; offline models | Consent; extraction correction; uncertainty; media provenance; local-language evaluation; hardware/thermal/battery/offline tests |

## Current baseline

Phase 0 provenance, claim versions, evidence records/integrity, scoped idempotency,
review decisions/overrides/reconsideration, manual backchecks, dedicated response
forms, pinned comparisons/field mappings, and companion inbox/optional browser
push are implemented. Analysis, exports, maps, authoring, catalogue and operations
also exist. Those features must not be re-labelled as full completion of this programme.

## Status

- Asset identity, source-linked temporal observations and age-based freshness:
  implemented, validated and merged in PR #52 (first bounded knowledge slice).
- Automatic expiry task generation and reviewer queue: implemented and locally validated;
  automatic batches require the explicit operator flag. Collector dispatch/field closure
  remain pending operations work.
- Remaining deliverables in all eight rows: pending.
- Version-scoped evidence graph and recorded survey timeline: implemented and
  locally and CI validated, merged in PR #53 (E1). Capture sessions, sensor/challenge
  evidence and witnessing remain pending.
- Signed, encrypted, read-only companion assignment snapshots: implemented and
  locally validated (O1; CI/merge pending). Application caching, progressive
  uploads and encrypted relays remain pending.
- Collect pilot and production browser push: pending external acceptance.

## Selected client and providers

User selected ODK Collect plus the companion browser page. Do not introduce a
new Android application. Recommend public Sentinel-2 imagery through an open
STAC adapter and an optional OpenAI adapter for reviewed extraction. Credentials
are configured securely by operators; no account purchase or paid live call is
part of fixture tests. Use deterministic validation before model interpretation.
Real device and provider acceptance remain separate gates.

## Dependencies and test rules

The order denotes foundation slices, not completion of each entire area before
the next. Advanced causal analysis and calibrated learning follow evidence,
offline and operational foundations; all unsatisfied deliverables remain tracked.

Use deterministic, source-cited behavior first. Do not invent calibrated confidence,
causal effects, measurements, provider results or model quality. Device sensors,
short-range relay radios and offline inference need an actual supported client and
hardware. Satellite/model services need authorized providers; model acceptance
needs appropriate labelled data. Build interfaces and independently testable work
while those prerequisites are identified; mocked adapters do not prove live delivery.

For every PR record API/permission tests, user-flow tests, migrations/rollback,
limits, failure recovery and CI results. Retain separate states for implemented,
locally tested, CI tested, externally accepted and pending. Each deliverable must
have a concrete contract before code. No pillar is done until its acceptance
column has supporting evidence.
