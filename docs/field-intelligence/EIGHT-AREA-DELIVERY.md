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
  K7 adds several predicates in one historical projection, independent freshness
  summaries, area counts and pinned sources; see [K7-multi-fact-projections.md](K7-multi-fact-projections.md).
  Maps, areas from locations and broader decision projections remain pending.
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
  forms the caller may read: merged in PR #74. K2a adds literal relevance
  ordering (exact field, prefix, substring, then recency) before pagination,
  with strongest-field excerpts and existing source checks; see
  [K2a-search-relevance.md](K2a-search-relevance.md). Searching submission answers
  and semantic/model-based retrieval remain pending.
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
  Investigation case links (F8): managers associate review cases with an
  investigation, inspect live decisions and readable pinned backchecks, and
  remove/relink with append-only reasons and shared revision checks; source
  revocation hides identifiers and private history. See
  [F8-investigation-case-links.md](F8-investigation-case-links.md).
  Targeted backcheck instruments (F9): fixed neutral question drafts from active
  primary-source findings, manager editing and published response-form selection,
  with independent collector dispatch through the existing backcheck workflow; see
  [F9-targeted-backcheck-instruments.md](F9-targeted-backcheck-instruments.md).
  Generated response-form drafts (F10): consent-aware template fields reviewed
  in the advanced builder, validated with the real compiler and saved through
  ordinary draft creation, preserving existing builder work; see
  [F10-generated-response-form-drafts.md](F10-generated-response-form-drafts.md).
  Peer-side targeting, multilingual/effectiveness evaluation, calibrated triage
  and broader fraud-intelligence acceptance remain pending.
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
  navigation and planning for other task types remain pending. O20 adds explicit
  overnight shifts; O11/O19 provide reviewed approved itinerary dispatch.
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
O18 adds offline re-verification snapshots; O19 adds unified backcheck/re-verification routes. Device acceptance remains pending.

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
tasks. O19 adds unified routes. Collect device acceptance, uploads and relays remain pending.

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

## R4 encrypted challenged-photo recovery

The companion queue can prepare unfinished photos/files for explicit encryption.
Version-two packages preserve challenge nonce/deadline and optional location context
across reload and file transport, while retaining version-one compatibility. Explicit
reconnect, unlock and upload remain required; no credentials or transport sessions
are persisted. Expired challenges remain archived but cannot be restored for upload,
and the server's original deadline remains authoritative. Native Collect queues,
background sync, delegated custody and real-device acceptance remain pending.
See [R4-offline-challenged-media.md](R4-offline-challenged-media.md).

### O19 unified visit itineraries

Backchecks and dated dispatched re-verification tasks share one bounded route,
road estimate, shift budget and approved stop order. Collector inboxes and signed
encrypted snapshots retain visit type and recheck task instructions. Changed
assignments, observation ownership, task revisions and unavailable evidence
withhold stale re-verification stops. See [O19-unified-visit-itineraries.md](O19-unified-visit-itineraries.md).
O20 adds overnight shifts. Navigation, other task types, live road-provider and real-device
acceptance remain pending.

### Product implementation priorities after the reliability work

All eight areas remain partial. The maintenance releases (#117–#122) establish
validation gates; they are not counted as completion of any area. The device
pilot is a separate acceptance activity. Product work resumes with K7 above.

| Area | Current delivery | Further implementation required |
| --- | --- | --- |
| Knowledge | Asset facts, ownership history, freshness, cited search and multi-fact historical projections and cited recorded-location/retained-photo pair comparisons | Image-content identity matching, asset maps/location areas, broader decision projections, answer/semantic retrieval, causal contracts and diagnostics |
| Evidence/trust | Evidence graph, challenges/replay checks, signed witnesses with correction/withdrawal history and server-attested project key revocation, human assessments and device-reported location | Delegation, certified key revocation, independent sensor/hardware corroboration, calibrated presence limitations |
| Offline resilience | Signed encrypted assignments/itineraries, recoverable media, encrypted relay packages and receipts | Durable XML submission queues, Collect integration, background sync and delegated courier/custody transport |
| Operations | Sampling, allocation, shared capacity, same-day/overnight UTC shifts, combined approved itineraries, manual/scheduled collector/answer sampling with group-specific rates, numeric ranges, polygon groups, inspectable design weights, conditional calibrated binary estimates, approved-stop navigation handoff and agreement counts | Additional task types, built-in/offline routing, external benchmark calibration and validated outcome inference |
| Geospatial | Location integrity, imagery availability and cited human geospatial assessments with temporal context and outdated history | Exact footprint checks, reviewed change candidates, imagery analysis and evaluated automated change detection |
| Fraud intelligence | Contradictions, identity reuse, similarity, collector links, investigations/outcomes, live case links and targeted backcheck questions with reviewed form drafts and same-form/cross-form shared-identity peer targeting | Broader peer families, multilingual/effectiveness evaluation, calibrated triage and false-positive evaluation |
| Adaptive surveys | Doctor, simulations, version-change analysis, analysis recodes and opt-in native CSV ZIP value recodes | Approved bounded policies, reviewed evolution/draft generation, answer uncertainty, conversational multilingual support, native moved-question recodes and OData overlays |
| Multimodal | Provenance-preserving capture, manual evidence review and reviewed photo-text/voice extraction with correction history | Live provider/language evaluation, asset/module suggestions, guided capture, source-grounded drafts, offline models and field acceptance |

Each implementation needs its actual API and user workflow, permission and
failure coverage, and passing CI. Hardware, language/model evaluation, live
providers and physical transport acceptance must be recorded separately rather
than being claimed from fixture tests.

### T5 witness correction and withdrawal

The original web witness can append signed corrections or terminal withdrawal,
with current permission checks, linked payload hashes and sequential retry-safe
history. Original signatures remain immutable; withdrawn statements do not count
as active corroboration. Reviewer UI and independent export verification expose
the effective state and full included history. Historical image/version changes
and archival do not block an authorized owner from withdrawing. See
[T5-witness-corrections-withdrawals.md](T5-witness-corrections-withdrawals.md).
This advances Evidence and Trust; delegation, certified revocation, sensor/device
corroboration and field acceptance remain pending.

### M1 reviewed photo text and voice transcription

Submission reviewers can explicitly request visible-text extraction or voice
transcription through an optional operator-configured OpenAI adapter, inspect the
fingerprinted original, correct proposed text and approve/reject with append-only
history. Proposals never overwrite answers. Durable request reservation prevents
implicit provider resends; historical bindings become outdated, with original
bytes retained under existing source-purge policy. See
[M1-reviewed-media-extraction.md](M1-reviewed-media-extraction.md).
This advances Multimodal. Live provider configuration, privacy/retention acceptance,
photo/voice accuracy, local-language evaluation, broader extraction/suggestions,
offline models and real-device acceptance remain pending.

### G2 reviewed geospatial verification

Web reviewers can record source-bound supports/conflicts/unclear/unavailable
assessments with claim, reasoning, explicit limitations and dated imagery citations.
Cached catalogue references pin scene metadata; manual image references remain
reviewer assertions. Revised decisions retain history, and changed submission XML,
attachments, location/time basis or cited catalogue metadata make earlier records
outdated. Per-source catalogue checks preserve the existing rounded cell/day policy.
See [G2-reviewed-geospatial-verification.md](G2-reviewed-geospatial-verification.md).
This advances Geospatial. No imagery pixels are fetched or interpreted, no review
case or answer changes automatically, and exact footprint/cloud analysis, automated
change candidates/detection, labelled evaluation and live provider/device acceptance
remain pending.


### O20 overnight UTC visit shifts

Managers can explicitly mark weekly and dated windows as ending the next UTC
day. Adjacent windows cannot overlap, including week/year boundaries. Allocation
and re-verification dispatch can use the ongoing previous night, with shared
quota and minimum visit-time checks charged to its start date. Approved online
and signed offline itineraries retain the full UTC boundary. See
[O20-overnight-visit-shifts.md](O20-overnight-visit-shifts.md). Navigation, additional
task types, sampling strata and conditional retained-frame binary estimates are implemented in O27; broader calibration remains pending.


### O21 sampling by recorded area or answer

Manual draws can use a selected scalar question within each collector, with
visible missing-answer groups, reproducible retained group membership, and live
requested/linked backcheck coverage by group alongside collector totals. Existing
review and independent assignment rules apply. See
[O21-grouped-backcheck-sampling.md](O21-grouped-backcheck-sampling.md). Scheduled field strata are implemented in O22; group-specific rates are implemented in O23. Design weights are implemented in O26; conditional retained-frame binary estimates are implemented in O27; broader calibration remains pending.


### O22 scheduled sampling by recorded area or answer

Daily/weekly schedules can persist an O21 grouping question. The runner rechecks
answer-read/list permissions and published field availability, draws reproducible
collector/answer intersections across due/catch-up periods and pauses unsafe
configurations atomically. UI exposes saved grouping, paused reasons, retries and
grouped sample coverage. See
[O22-scheduled-answer-sampling.md](O22-scheduled-answer-sampling.md). Group-specific rates are implemented in O23. Polygon groups are implemented in O25. Design weights are implemented in O26; conditional retained-frame binary estimates are implemented in O27; broader calibration remains pending.


### O23 different rates by recorded answer group

Manual and scheduled draws accept canonical per-answer percentages, including
missing answers, with a default fallback and the existing per-intersection
minimum. Saved rules, immutable snapshots and effective coverage rates are
visible; retries, clearing and migration rollback are covered. See
[O23-group-specific-sampling-rates.md](O23-group-specific-sampling-rates.md).
Numeric ranges are implemented in O24. Polygon groups are implemented in O25. Design weights are implemented in O26; conditional retained-frame binary estimates are implemented in O27; broader calibration remains pending. Operations and all eight areas remain partial.


### O24 numeric range sampling

Manual and scheduled draws can use exact decimal boundaries on numeric questions,
with generated range labels, different rates, separate missing answers, immutable
range membership and numeric coverage order. Invalid answers refuse draws or pause
schedules atomically. See [O24-numeric-range-sampling.md](O24-numeric-range-sampling.md).
Polygon groups are implemented in O25. Design weights are implemented in O26; conditional retained-frame binary estimates are implemented in O27; broader calibration remains pending.
Operations and all eight areas remain partial.


### O25 geographic polygon sampling groups

Manual and scheduled draws can assign recorded geopoints to uploaded named
Polygon/MultiPolygon areas, with holes, explicit overlapping/outside/missing groups,
different rates and immutable geometry/membership snapshots. Saved/recorded areas
can be downloaded and coverage inspected. See
[O25-polygon-sampling-groups.md](O25-polygon-sampling-groups.md). Design weights are implemented in O26; conditional retained-frame binary estimates are implemented in O27; broader calibration remains pending. Operations and all eight areas remain partial.


### O26 inspectable sampling design weights

Authorized readers can inspect and export checked inclusion probabilities and
expansion weights from retained stratum membership for manual and scheduled draws.
The UI states the eligible-frame scope, rounding/minimum behavior and nonresponse
limitations, and withholds inconsistent history. See
[O26-sampling-design-weights.md](O26-sampling-design-weights.md). Conditional binary estimates are implemented in O27; external calibration
and validated outcome inference remain pending; all eight areas remain partial.


### O27 calibrated reviewed-binary estimates

Retained-frame stratum targets calibrate explicitly supplied reviewed binary
outcomes, with coverage diagnostics, explicit random-response assumptions,
conservative 95% bounds and reproducible input exports. Empty strata and invalid
history withhold estimates. See [O27-calibrated-binary-estimates.md](O27-calibrated-binary-estimates.md).
External benchmark calibration, validated outcomes and field acceptance remain
pending. Operations and all eight areas remain partial.


### O28 approved-stop navigation handoff

Connected App Users can recheck an approved stop and explicitly open destination
directions/pins in fixed map providers, without sharing Field Data credentials
or task text. Current assignment/provenance checks, short-lived links, expiry,
disconnect and offline boundaries are covered. See
[O28-approved-stop-navigation.md](O28-approved-stop-navigation.md). Built-in/offline
routing, other task types and device/provider acceptance remain pending; all eight
areas remain partial.


### T6 server-attested witness key revocation

Owners and project managers can permanently revoke retained witness signing keys
within a project. Signed history remains readable, revoked records are excluded
from active corroboration, and exports support independently pinned issuer checks.
See [T6-witness-key-revocation.md](T6-witness-key-revocation.md). This covers
self-generated witness keys; certified identity/delegation, certified identity-key
revocation and sensor/hardware corroboration remain pending. All eight areas remain partial.


### F11 same-form peer-side targeted backchecks

Linked peer review cases can use active same-form shared-identity, similar-answer
and repeated-location findings to prepare neutral prompts and reviewed response-form
drafts, then dispatch an independent backcheck to that peer case. Side labels and
write-time eligibility checks retain privacy and retry boundaries. See
[F11-same-form-peer-backchecks.md](F11-same-form-peer-backchecks.md). Cross-form
peer targeting, multilingual/effectiveness evaluation and calibrated triage remain
pending; all eight areas remain partial.


### F12 cross-form shared-identity peer backchecks

Explicit shared-identity counterparts in another readable form can now supply
neutral prompts and reviewed response-form drafts for the linked peer case. Both
source-form grants, mapping ambiguity and retry access are checked. See
[F12-cross-form-peer-backchecks.md](F12-cross-form-peer-backchecks.md). Broader
peer families, multilingual/effectiveness evaluation and calibrated triage remain
pending; all eight areas remain partial.


### K8 recorded asset location comparisons

Readable users can explicitly compare a chosen location fact for a possible
duplicate pair, with source citations, freshness, distance and reported accuracy
limits. Invalid, unknown, stale or unverified facts withhold comparison. See
[K8-asset-location-comparison.md](K8-asset-location-comparison.md). Asset maps,
photo identity matching and validated identity inference remain pending; all eight
areas remain partial.


### K9 cited retained-photo asset comparisons

Readable users can explicitly compare two cited photo attachment references,
inspect local previews and verify whether the retained bytes match. Source
citations, check times, permission checks and missing/stale/tampered failure
states accompany the comparison. See
[K9-cited-asset-photo-comparison.md](K9-cited-asset-photo-comparison.md). This
does not infer image-content identity or certify capture time/presence. Asset
maps, evaluated photo identity inference and field acceptance remain pending;
all eight areas remain partial.


### S6 opt-in native CSV ZIP value recodes

Published unencrypted form downloads can explicitly apply version-bound value
rules to native root/repeat CSV tables with a frozen manifest. Unsupported moved
questions/fields are listed as skipped, source answers remain intact, and rule
retirement changes the export validator. See
[S6-native-csv-value-recodes.md](S6-native-csv-value-recodes.md). Native moved-question
recodes, OData overlays and approved adaptive policies remain pending; all eight
areas remain partial.
