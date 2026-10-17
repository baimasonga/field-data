# F8: investigations linked to review cases

Managers can associate existing review cases with an investigation and inspect
live case status, decisions, original source and related backchecks alongside its
findings. Linking/removing a case changes no decision, claim, backcheck, answer or
investigation disposition. Closed investigations must be reopened before links
change. Existing F6 findings/notes and F7 outcome counts keep their contracts.

## API and lifecycle

Under `/projects/:projectId/investigations/:id/cases`:

- `GET`: active links, the most recent 50 link/removal events, current investigation
  revision and write controls. `before` pages earlier event sequences.
- `GET /candidates`: same-project readable live sources, including historical,
  resolved and superseded cases. Literal `q` (form/root instance/case UUID) and
  status filters are optional. Up to 50 results with a validated keyset cursor;
  hidden forms/sources are excluded before pagination. Already linked cases are
  labelled. No cross-project IDs or submission answers are returned.
- `POST {requestId,caseId,reason}` links a readable case. `If-Match:
  "investigation-<revision>"` is required.
- `POST /:linkId/remove {requestId,reason}` appends a removal and preserves the
  original association. The opaque link ID belongs to this investigation.
- `GET /:linkId` opens an active link with fresh scope checks, current source/case
  status, latest 50 review decisions and at most 50 readable backchecks. Limits
  and omissions are explicit. Existing comparison APIs still check both sources.

Reasons are trimmed 10–2,000 characters. A case may be linked only once actively;
removal permits a fresh link with a new ID. Every real change increments the same
investigation revision used by close/reopen/findings. Concurrent stale changes
fail 412. Normalized identical retries (including original If-Match) return
current state without another event, even after removal/relink/closure; changed
retry contents conflict. At most 100 active links and 500 link/removal events per
investigation. An event slot is reserved for removing every active link, so additions
cannot exhaust removal capacity. A new link is permitted only when the current
event count plus active count plus two fits within 500. The UI states these bounds.

## Permissions and privacy

Investigations and all subresources require project.update and a live web User.
Read access to the case's source form and a live project/form/submission/version
are required to link or inspect. Project, form and user grants are rechecked and
held while committing links. Project archival makes the new link workflow read
only. Resolved/superseded case links remain historical references, never silently
retargeted to a newer claim version. Case status/decisions and backchecks are read
live; they are not copied into a potentially stale investigation decision.

When source access is revoked or a source/case is deleted, active membership is
shown only as an unavailable link with an opaque link ID. Case/claim IDs, form and
submission names, actor identity and event reasons are withheld. Managers may
remove that unavailable link without opening its protected content. Historical
events remain but use the same redaction. Related backchecks require readable live
response forms and, for linked responses, a live response source in the expected
same-project form; others are withheld and counted. No response identifiers,
questions, assignment names or decisions from hidden sources are returned.
Comparison downloads retain their existing independent permission checks.

Link history stores no source names/answers. Append-only guards allow only existing
actor FK clearing and whole-investigation/project cascade purges. Case UUIDs are
historical references without a case FK, so purging a case does not erase the
association record. Link event and audit commit atomically; audit contains only
investigation/link/event IDs and action, not reasons or protected case identifiers.
Rollback preserves nonempty history. No new retention policy or export is added.

## User workflow and acceptance

Review → Investigations → choose investigation → Related review cases. Search
readable cases, select and record a reason, inspect linked live decision history,
view backcheck status/source links and use the existing pinned answer comparison.
Remove with a reason; history records both changes. Refresh clears cached source
inspection. Lost responses retain the same request/If-Match for a safe retry.

Acceptance requires real PostgreSQL ownership/scope/permission/deletion tests,
concurrency, exact retries, state/quotas, history rollback/purge/immutability,
response-form hiding; browser linking/removal/relink/history, safe retries, case
inspection/comparison, stale revisions, unavailable sources, paging and narrow
layout; complete CI and deployment checks. Calibrated triage, false-positive
estimates and field acceptance remain separate work. Fixed-template targeted
backcheck questions and dispatch are added by
[F9-targeted-backcheck-instruments.md](F9-targeted-backcheck-instruments.md);
reviewed template-based form generation is added by
[F10-generated-response-form-drafts.md](F10-generated-response-form-drafts.md).
