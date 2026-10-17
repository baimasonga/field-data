# F9: targeted investigation backcheck instruments

From a linked case's inspection, a manager can choose active investigation
findings, draft neutral verification questions, edit them, and request an
independent visit using an existing published response form. The request is a
normal backcheck: it appears in the reviewer and collector workflows, is collected
through the existing form, and can be linked, compared and cancelled normally.

## Scope and human review

Fixed templates (`investigation-backcheck@1`) cover contradictions, shared or
inconsistent identity details, similar answers, location and visit timing.
Only open/investigating, non-withdrawn findings attached to this investigation
whose primary form and root submission match the linked case are eligible.
Unsupported checks, resolved findings, unrelated sources and peer-side matches
are excluded. The first 20 eligible findings by ID are offered; further matches
are counted. The selection must be nonempty and contain at most 20 distinct IDs.

Drafts contain no recorded answers, peer identities, finding evidence, or copied
free-text titles. Prompts ask for independent accounts, corrections, uncertainty
and legitimate explanations. Repeated templates are combined once. Changing the
selection requires explicitly drafting again. Managers may edit all question
text and must select a published response form; no equivalence is inferred.
Changing the form resets the collector to its independent workload suggestion.
The original collector is unavailable.

F9 is a question-and-dispatch instrument. Reviewed template-based response-form
generation is added by [F10-generated-response-form-drafts.md](F10-generated-response-form-drafts.md). No
form schema, field mapping, decision, finding resolution or investigation
disposition is changed. Published form creation and App User grants stay in the
existing authoring/administration workflow. The manager must verify that the
selected form can record the requested answers. Drafts are transient, not a
new stored evidence record or export. Native backcheck storage retains the final
edited question, chosen response form, assignee, due date and requesting reviewer.

## API and authorization

Under `/projects/:projectId/investigations/:id/cases/:linkId`:

- `GET /instrument`: template version, investigation and case revisions, bounded
  suggestions and omitted count, plus request eligibility. Requires a project
  manager, active link and readable live source. All responses are private/no-store.
- `POST /instrument/backchecks`: `{requestId, investigationRevision,
  templateVersion, findingIds, responseXmlFormId, assignedTo, question, dueAt}`
  with `If-Match: "review-case-N"`. Questions are trimmed, nonempty and at most
  2,000 characters. The response is the native backcheck ID/status/revision,
  with native review-case ETag and created/replayed idempotency status.

New requests require an open/unarchived investigation/project, the same active
case link, current source, case assigned to this reviewer in review, no pending
backcheck, source submission read/update grants, and read access to the chosen
same-project response form. The response form must be published/open and the
independent App User must still be live and assigned to submit it. Selected
findings and both revisions are checked again while writing; stale case or
investigation state fails 412. Findings/grants/sources are held for the write.

The existing request helper enforces collector independence, request capacity
serialization and case revision changes. Request and investigation audit commit
atomically. Audit stores only investigation/link/backcheck IDs, template version
and finding count; it copies no question, case identifiers, finding IDs or answers.
Investigation revision and disposition stay unchanged by a backcheck request.

Normalized exact retries retain the request UUID, both original revisions,
selected finding IDs, form, collector, final question and due instant. A retry
adds no duplicate request or audit, even after closure/withdrawal. Active link,
manager and both source/response grants must still be present for replay; removal
or revoked access hides the request through this workflow. Changed retry contents
conflict. Refresh clears the pending draft/request and starts a fresh identity.
Explicit access denials clear cached instrument and case inspection details.
Failures never silently fall back to another form, collector or source.

## Acceptance and remaining work

PostgreSQL checks cover finding/source bounds, no answer copying, both revisions,
withdrawal, exact normalized retries, native storage and atomic audit, concurrent
requests, source/response permissions, source deletion, historical/removed links,
archive/closure, collector independence, native pending-request rules and limits.
Browser checks cover explicit drafting/editing, form/collector changes, exact
lost-response retry, stale refresh, unavailable/delayed sources and 320px layout.

Automatic publication, general schema evolution, peer-side targeting, multilingual
prompts, validated instrument effectiveness, calibrated fraud triage and field
acceptance remain separate deliverables. This milestone does not complete the
fraud-intelligence area or the eight-area programme.
