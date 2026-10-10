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
- Asset status across a project (K3, first decision-specific projection):
  one predicate's current fact for every asset, chosen as the passport chooses
  it, with a count by value of facts still fresh or due for review and the
  rest counted by freshness status, on the Review page: implemented and
  locally validated. Several predicates, maps and aggregation by area remain
  pending.
- Cited search (K2, first cited-retrieval slice): one search across a
  project's assets, asset facts, integrity findings and review decisions on
  the Review page, each result citing the submission it rests on, limited to
  forms the caller may read: merged in PR #74. Ranking,
  searching answers and model-based retrieval remain pending.
- Automatic expiry task generation and reviewer queue: implemented and locally validated;
  automatic batches require the explicit operator flag.
- Dispatch of freshness tasks to App Users and field closure by fresh collected evidence
  (O2): merged in PR #57. The project-wide queue with overdue and collector filters and a
  workload count (current open tasks, not a performance measure): merged in PR #58.
  Collector push, inclusion in the signed offline snapshot, sampling, route/capacity
  planning, workload balancing and a Collect device pilot remain pending.
- Location evidence and deterministic spatial checks (G1, first geospatial slice):
  accuracy, outside-project-area and repeated-location rules in the existing integrity
  framework, location components, project-area designation, withdrawal of findings no
  longer observed: merged in PR #60.
- Deterministic answer contradictions (F1, first fraud-intelligence slice): per-form
  rules written by project managers, evaluated in the integrity framework with the
  answers shown, benign explanations required, versioned, withdrawn when no longer
  observed: merged in PR #61. Identity reuse across submissions of one form (F2):
  manager-declared identity keys, reuse and changed-detail findings with answers
  read live rather than stored: merged in PR #63. Near-duplicate submissions
  (F4, first similarity signal): a later submission whose informative answers
  match an earlier one's at least 90%, routed to review with benign
  explanations and no answers stored: merged in PR #70. Groups of collectors
  whose submissions keep matching (F5, first collusion-subgraph slice):
  collectors connected by repeated pair findings across forms, on the Review
  page, with no score: merged in PR #71. Triage remains pending.
- Receipt and custody ledger (R1, first offline-resilience custody slice):
  an append-only, hash-chained receipt per submission version received,
  written by a database trigger; manager verification of chain and stored
  content; a head signed with the offline key when configured; collectors see
  their own receipts on the fieldwork page: merged in PR #72 (deploy backfilled
  existing submissions). Device-side hashes, relays and couriers remain pending.
- Backcheck workload (O4, first workload-balancing slice): the backcheck
  request form shows each eligible App User's open and overdue backchecks,
  marks the original collector unavailable and preselects the least loaded:
  merged in PR #73. Distance, capacity and automatic
  assignment remain pending.
- Static survey doctor (S1, first adaptive-surveys slice): checks of a form
  definition for unknown references, cycles, never-shown questions, impossible
  constraints and choice-list problems, on the Draft page and in the publish
  dialog: merged in PR #64 (including a sweep of 150 real forms). Reproducible
  interview simulation (S2): seeded simulated interviews of a form version
  reporting never-shown questions, constraints not met, interview length and
  what was not simulated, on the Draft page: merged in PR #69 (swept over 158
  forms). Approved policies and evolution remain pending.
- Project findings inbox (F3): integrity findings from every readable form of a
  project in one list on the Review page, with filters and open counts, linking
  to each form's Verification page: merged in PR #65.
- Identity keys across forms (F2b): a key can also count uses in up to 5 other
  forms of the project through a question mapping, flagging only its own form:
  merged in PR #66.
- Imagery availability (G1b): Sentinel-2 scenes covering each located submission
  within 30 days of its visit, from an open STAC catalogue, sending only a 0.05°
  cell centre and whole days; off until an operator enables it: merged in PR #67,
  validated with a recorded catalogue answer. A live run from the deployed
  server, imagery analysis and change detection remain pending.
- Random backcheck sample (O3): a seeded, reproducible share of every
  collector's submissions of a form, routed into review with the reason
  `backcheck-sample` for a backcheck by another App User, with coverage by
  collector: merged in PR #68. Backchecker workload in the request form (O4):
  merged in PR #73. Backcheck agreement (O5): the linked backchecks of a form
  compared as their comparison views do and added up by collector and by
  question, counting only asked questions or mapped pairs, with counts rather
  than estimates: merged in PR #75. Scheduled samples, other
  strata and calibrated estimates from backcheck results remain pending.
- Remaining deliverables in all eight rows: pending.
- Version-scoped evidence graph and recorded survey timeline: implemented and
  locally and CI validated, merged in PR #53 (E1). Capture sessions, sensor/challenge
  evidence and witnessing remain pending.
- Signed, encrypted, read-only companion assignment snapshots: merged in PR #54 (O1).
  Application caching, progressive uploads and encrypted relays remain pending.
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
