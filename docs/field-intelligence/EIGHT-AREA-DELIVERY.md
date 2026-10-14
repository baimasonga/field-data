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
  rest counted by freshness status, on the Review page: merged in PR #76.
  Asset status by area (K6): the same table grouped by another recorded
  fact chosen as the area (for example `district`), with the assets placed by
  an area fact no longer current counted: merged in PR #85.
  Several predicates, maps and areas from locations remain pending.
- Reversible asset merges and splits (K4, first correction/merge/split
  history slice): a duplicate asset merged into another, or chosen
  observations split into a new asset, without changing any observation; an
  ownership view used by the passport, status table, search and
  re-verification (superseding and, after an undo, restoring tasks); undo of
  the latest operation restoring the previous facts exactly; approved by the
  project owner: merged in PR #78. Suggested duplicates (K5, first entity
  resolution slice): pairs of assets that may be the same thing, with reasons
  in words (matching external IDs, the same source submission, the same or a
  similar name of the same type with the same numbers), never merged
  automatically, dismissible with a reason: merged in PR #79. Location and
  photo comparison remain pending.
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
  page, with no score: merged in PR #71. Investigation records (F6): findings
  looked into together, an append-only history, a disposition from a fixed
  list and reopening as the correction path, for project managers only and
  changing nothing else: merged in PR #77. Investigation outcomes (F7,
  first metrics-over-dispositions slice): counts of a project's
  investigations by status and disposition, days to close, closures by month,
  findings by kind of check and collectors by disposition, counts only, with
  the note that investigated findings are chosen by people: merged in PR #84.
  Triage and linking review cases remain pending.
- Receipt and custody ledger (R1, first offline-resilience custody slice):
  an append-only, hash-chained receipt per submission version received,
  written by a database trigger; manager verification of chain and stored
  content; a head signed with the offline key when configured; collectors see
  their own receipts on the fieldwork page: merged in PR #72 (deploy backfilled
  existing submissions). Device-side hashes, relays and couriers remain pending.
- Backcheck workload (O4, first workload-balancing slice): the backcheck
  request form shows each eligible App User's open and overdue backchecks,
  marks the original collector unavailable and preselects the least loaded:
  merged in PR #73. Automatic independent allocation and pending-work
  capacity limits (O7): opt-in per source form, with response-form choice,
  instructions, due interval, collector overrides, permission rechecks,
  atomic retry, manual-request capacity counts and a rotating queue:
  merged in PR #90. Calendar-aware allocation and itinerary previews (O8):
  weekly UTC quotas and dated exceptions, dated independent assignment,
  capacity including completed visits, fieldwork/offline dates, and a
  deterministic stop-order preview with great-circle distance, integrity,
  permission, location and capacity warnings and CSV export: implemented and
  merged in PR #91. Road estimates (O9) add an optional operator-controlled
  OSRM driving adapter, return-trip travel time, per-visit duration and day
  budget warnings; live provider acceptance remains pending. Persisted UTC
  shift windows and visit-time planning (O10) add weekday/date overrides,
  closed/expired-window handling, conservative allocation time limits and
  saved preview assumptions: implemented and merged in PR #96. Road
  navigation, overnight shifts,
  automatic route dispatch and planning for other task types remain pending.
- Static survey doctor (S1, first adaptive-surveys slice): checks of a form
  definition for unknown references, cycles, never-shown questions, impossible
  constraints and choice-list problems, on the Draft page and in the publish
  dialog: merged in PR #64 (including a sweep of 150 real forms). Reproducible
  interview simulation (S2): seeded simulated interviews of a form version
  reporting never-shown questions, constraints not met, interview length and
  what was not simulated, on the Draft page: merged in PR #69 (swept over 158
  forms). Version changes (S3, first schema/version-preservation slice):
  every change between two versions of a form to what is collected, each
  with its effect on the data in words (meaning, continuity, who is asked or
  what is accepted, wording), on the Draft page and counted in the publish
  dialog, never blocking: merged in PR #80 (swept over 304 forms compared
  with themselves and 303 pairs of different forms). Recode rules for exports
  (S4): per-form rules, written by managers and kept, mapping earlier
  versions' codes to current ones or reading a moved question from its old
  path, applied by version in the analysis exports (direct and queued, frozen
  with the job) and listed in each export's manifest, with an option to
  export answers as stored: merged in PR #82. Recodes in
  Central's own exports, approved policies and
  evolution remain pending.
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
  than estimates: merged in PR #75. Scheduled samples (O6): a daily or
  weekly schedule per form, drawn by the operations runner with the O3 rules
  when each UTC period ends, once per period, catching up after an outage,
  with permission rechecks, atomic retry and a run record for each:
  implemented and locally validated for PR #86. Other
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

### O11 road-aware ordering

Optional fixed-depot road trip suggestions are merged in PR #97, with complete
permutation validation, explicit fallback, unknown-time preservation, CSV method
metadata and focused server/API/browser tests. See [O11-road-stop-order.md](O11-road-stop-order.md). Live provider acceptance, persisted dispatch and navigation remain pending.

### O12 reviewed itinerary dispatch

Immutable manager-approved backcheck itineraries are merged in PR #98, with
stale-preview checks, audit history and collector-scoped online delivery that
withholds cancelled, superseded or inaccessible stops. See [O12-reviewed-itinerary-dispatch.md](O12-reviewed-itinerary-dispatch.md). Offline itinerary bundles, navigation and field acceptance remain pending.

### O13 offline approved itineraries

Signed, encrypted itinerary snapshots are merged in PR #99 with version-1
compatibility, whole-plan bounds, omission counts, typed coordinate/date checks
and explicit offline freshness limits. See [O13-offline-approved-itineraries.md](O13-offline-approved-itineraries.md). Page-shell caching, resumable uploads and offline relays remain pending.

### O14 companion page preparation

The public companion shell can be prepared explicitly for offline reload, with
asset allowlists, byte/time limits, expiry and separate encrypted private data.
Merged in PR #100 and covered by real production-service-worker browser tests.
See [O14-fieldwork-offline-page.md](O14-fieldwork-offline-page.md). Upload queues, resumable transfers and relays remain pending.

### S5 screen recodes

Approved version-bound recodes are merged in PR #101 for analysis rows,
charts and full-selection maps, with stored-filter semantics, repeat preservation,
fixed rule IDs and delegated-path restrictions shared with exports. See
[S5-screen-recodes.md](S5-screen-recodes.md). Native Central exports/OData and adaptive policy/evolution remain pending.

### O15 production signing readiness

Missing Worker signing bindings can be prepared atomically during deployment,
and a custom-domain release/signature check cleans up its own empty fixture.
Merged in PR #102 with 15 Worker/readiness checks; live verification follows
deployment. See [O15-signing-readiness.md](O15-signing-readiness.md). Existing invalid bindings and provider/device acceptance remain operator checks.

### O16 collector form guidance

Approved stop cards identify the response form/version and deadline in online
and signed offline views, preserving legacy snapshots and hiding technical
references by default. Implemented locally with 13 database and 23 browser
checks. See [O16-collector-form-guidance.md](O16-collector-form-guidance.md). Collect form availability and device acceptance remain field checks.

### O17 shared visit capacity

Dated re-verification assignments share collector quotas and UTC shifts with
backchecks, with serialized allocation, retained completed reservations, event
history and collector-visible dates. See [O17-shared-visit-capacity.md](O17-shared-visit-capacity.md).
Unified routes, offline re-verification snapshots and device acceptance remain pending.

### Release reconciliation

O15 production signing verification passed after the cleanup fixes in PRs #104
and #105. O16 collector form guidance was merged in PR #103 and deployed, with
live custom-domain assets, signed snapshot identity/expiry and fixture cleanup
verified. Earlier pending statements about itinerary dispatch, encrypted itinerary
snapshots and public companion-page caching are superseded by O12–O14 above.

### O18 offline re-verification instructions

Version-3 signed encrypted snapshots add collector-scoped re-verification
instructions and planned visit dates, shared live/offline permission checks,
explicit omissions and strict pre-storage validation. See
[O18-offline-reverification.md](O18-offline-reverification.md).
This supersedes earlier pending statements about snapshot inclusion for these
tasks. Collect device acceptance, uploads, relays and unified routes remain pending.

### R2 companion resumable media uploads

A foreground companion queue recovers missing media for already received own
submissions, with durable verified chunks, priority, pause/reselect recovery,
quotas and atomic native attachment delivery. See
[R2-resumable-media-uploads.md](R2-resumable-media-uploads.md).
Native Collect resumption, priority XML queues, encrypted persistent media,
background uploads, relay transport and device acceptance remain pending.

## R3 encrypted offline media packages

The companion page now supports explicit encrypted IndexedDB storage and
.fdmedia export/import for up to 10 files and 20 MiB combined. Full manifests
and bytes use origin-bound AES-GCM and passphrase-derived keys; strict integrity,
expiry and size validation precedes restoration. Reconnect, unlock and explicit
upload remain required, with R2's live authorization checks. This implements a
bounded file relay; delegated courier authority, signed custody, native Collect
queues, background sync and real-device acceptance remain pending.
See [R3-encrypted-media-packages.md](R3-encrypted-media-packages.md).

## T1 capture challenges and exact-image replay checks

Collectors can issue a 20-minute server challenge, include the code physically in
a camera photo, and explicitly upload it through the resumable queue. Atomic
completion consumes the scoped nonce and rejects repeated challenged-image hashes
within a project. Reviewers see the code, timestamps, fingerprint and current
attachment reference, with scene review explicitly not assessed. This adds a
challenge binding, not proof of device, location or capture time. Signed witnessing,
sensors, visual similarity, challenge-aware offline packages and device acceptance
remain pending. See [T1-capture-challenges.md](T1-capture-challenges.md).

## T2 human capture assessments

Reviewers can record matching-code visibility and scene support, with original-image
attestation, notes, identity and timestamp. Immutable assessment revisions, safe
retries, current-attachment checks and outdated warnings preserve the distinction
between a historical review and a current image. Exact originally bound bytes are
available through a scoped integrity-checked download, and earlier decisions have
paged history. This does not automatically accept the field claim or certify
presence. Signed witnesses, sensors and device acceptance remain pending.
See [T2-human-capture-assessments.md](T2-human-capture-assessments.md).

## T3 signed capture witness statements

Authorized web Users can sign one immutable statement per challenged image, with
account/name snapshots and server receipt timestamps. P-256 signatures cover the
exact scoped image fingerprint; browser and standalone export verification reject
tampering. Live permissions, unchanged-image checks, bounded history, safe retries
and outdated warnings preserve historical meaning. Distinct accounts do not prove
independent people, presence or claim truth. Certified witness identity, delegated
fieldworker witnessing, sensors, correction/withdrawal and device acceptance remain
pending. See [T3-signed-capture-witnesses.md](T3-signed-capture-witnesses.md).

## T4 optional device-reported capture location

The companion camera can include one explicitly requested browser location reading
with a challenged photo. Coordinates, reported accuracy and client timestamps are
shown before upload, removable before transfer starts and atomically linked to the
original challenged image. Reviewers see historical context after replacement;
absent location remains a valid workflow. This records a client assertion rather
than proving presence or GPS authenticity. Hardware attestation, stronger sensor
corroboration, native Collect integration, offline challenge packages and real-device
acceptance remain pending. See [T4-device-reported-capture-location.md](T4-device-reported-capture-location.md).
