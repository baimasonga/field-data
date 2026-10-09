# K1: asset identity, temporal observations and expiry

## Contract

This bounded knowledge feature supports physical assets only. An asset has a
project-scoped UUID, exact external identifier, type, name and owning form. No
name/coordinate matching, merge inference, household identity or migration from
legacy global Cases is performed. Project managers register assets and declare
observations against pinned, readable claim versions in the same project.

At most 500 observations are retained per asset in this first release; the API
rejects further appends rather than returning a partial history. An observation records predicate, explicit knowledge state (known, unknown,
not-observed, not-applicable), text value, valid-from, recorded-at, source claim
version, source hash, actor, reason and an immutable age-policy snapshot. The recorded sequence links the previous predicate observation by its ID.
Dated facts select the latest applicable valid-from time, then the latest recorded
sequence for ties; late older facts cannot replace a newer dated state. It does not overwrite evidence. Freshness reports not-yet-valid, fresh,
review-due, expired, unknown or source-unverified; the validity/grace periods are supervisor choices,
not calibrated confidence. Historical queries accept both valid time and known-at
time; all returned records retain source citations and policy version.

Tables: `field_data_assets`, `field_data_asset_observations`,
`field_data_reverification_tasks`. Additive migration; recorded history survives
rollback/reapply. Existing core ODK tables remain unchanged.

API under `/v1/field-data/projects/:projectId/assets`:
- GET list (50 rows, UUID cursor); POST register with requestId/name/assetType/externalId/xmlFormId.
- GET `/:assetId` with optional `at` and `knownAt` ISO timestamps returns history,
  selected facts, freshness, tasks, revision and allowed flag.
- POST `/:assetId/observations` with requestId/claimVersionId/predicate/state/value/
  validFrom/validityDays/graceDays/note; requires `If-Match: "asset-N"`.
- POST `/:assetId/refresh` generates due tasks explicitly; automatic operations
  runner also generates them in bounded batches. Repeated generation is safe.

Registration and observation UUID retries replay only identical payloads. Missing
revision returns 428; stale revision 412; invalid payload 400; exact external-ID
collision 409. Reads require project.read and submission.read on the owning form
and all cited source forms; deleted/inaccessible sources return 404 for details.
Writes additionally require project.update. All responses are private/no-store.

In Review Queue, inspect a claim and choose **Use as asset observation source**,
then load/register an asset and record an observation.

One task is generated per due, verified, known current predicate observation, with a due date,
source and age-policy reason. A replacement observation retains the old task as
superseded; it does not claim a site visit took place. A new expired replacement
gets its own task. Tasks enter a supervisor queue; dispatch to collectors and
proof of field closure belong to later operations work. Unknown, unobserved and not-applicable values require supervisor interpretation
and do not automatically generate age-expiry tasks. No external messages are
sent by task generation. Audits and task insertion/supersession commit together. Each worker batch hashes
at most 100 candidates and inserts/supersedes at most 100 tasks of each kind.
Validity days are elapsed 24-hour periods, including across timezone changes.

## Acceptance

Exercise actual PostgreSQL registration/retries/collisions; source scope and
permission changes; pinned hashes; dated/history queries; boundary/grace/unknown
states; unique task generation and correction history; rollback/reapply; browser
registration/observation/history/task/retry/mobile flows. The entire knowledge
pillar additionally requires resolution/merge/split, citations across records,
rebuildable projections and the acceptance gates in EIGHT-AREA-DELIVERY.md.

## Rollout and measured gate

Deploy `20261009-04-add-asset-freshness.js` before the API/client. No existing
Cases or submissions are automatically registered as assets. Start with a test
project and two physical assets, one manager and one viewer. Verify every fact
opens its pinned source, no duplicate tasks appear after retries, all read/write
permission checks hold, and a correction preserves the prior history. Stop the
pilot on any source-scope leak, duplicate task or lost history. These checks are
functional acceptance targets, not a claim of completed field deployment.

The existing operations runner performs automatic batches only when
`FIELD_DATA_ASSET_TASKS_ENABLED=true`. It defaults off. Leave it off or unset it
to stop automated generation while investigating. Explicit manager-triggered
**Generate due re-verification tasks** remains available. Rollback API/client code
preserves assets, observations, tasks and audits; do not purge source records.
Offline Collect submission behavior is unchanged. Asset editing requires an
online manager session; failed requests retain unchanged retry identifiers.
The broader knowledge acceptance gate (merge/split, retrieval, twins and causal
analysis) remains pending in the programme ledger.

## Validation evidence

Local checks: 39 field-data API tests passed; 1,621 server unit tests passed with
one existing pending test; 62 hardening checks passed. The full browser baseline
passed 56 tests; the final review suite passed 24 tests after adding source
selection, viewer restrictions and stale-write recovery. Client production build
and changed-file lint passed. Fresh public/custom-schema migrations passed with
actual rollback/reapply, append-only enforcement and source FK checks. Tests
include competing real transactions, permission revocation, late older facts,
future validity, tampered/deleted sources and unchanged review decisions.
These results validate the bounded K1 workflow; they do not certify the whole
knowledge pillar or a production device pilot.
