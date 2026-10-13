# O7: automatic independent back-check allocation and capacity

Opt-in policy per source form. A project manager selects an open published
response form in the same project, instructions (up to 1,500 characters), a due interval (1–90 days),
a default maximum pending backchecks (0–100), and optional App User overrides
(up to 200). Zero means unavailable for automatic allocation. Capacity counts
all requested backchecks for the collector, including manual requests and work
from other source forms. Manual requests remain an explicit reviewer override;
they are counted by subsequent automatic allocations.

The five-minute operations runner considers sampled submissions only. A current,
non-deleted claim with an open, unassigned case may be claimed by the configuring
manager; a case already assigned to that manager is also eligible. It never
steals another reviewer's case, reopens a decision, or replaces/cancels an
existing backcheck. A submission with any previous backcheck is not automatically
assigned again, including after a cancellation. Reviewers use the existing
manual replacement path.

Eligible checkers are live project App Users authorized to submit the response
form, excluding the original collector. Allocation chooses the least pending,
then overdue, then recently linked, then name/ID, within capacity. No eligible
independent checker or exhausted capacity leaves the case waiting, unchanged.
At most 100 cases per policy and 20 policies per tick; a rotating case cursor
prevents blocked cases from permanently hiding later work. Least recently
attempted policies are served first.

A project advisory lock serializes automatic and manual requests; case locks,
current-version checks, unique pending requests and the standard audit/push path
remain in force. Case claiming and requests commit atomically with the report.
A failed run rolls back and retries. Each run rechecks the manager's project and
source/response permissions. Revocation, deleted/archived scope or a closed
response form pauses the policy with a visible reason. Requests append the source submission reference to the approved instructions;
answers and attachments are not copied. No model score or route optimization
is claimed.

API /v1/projects/:projectId/forms/:xmlFormId/backcheck-allocation:
GET needs source submission.list/read and returns policy, readable response
forms, eligible collectors and their pending load. PUT needs project.update,
source submission.update and response submission.read; body {enabled,
responseXmlFormId, question, dueDays, maxPending, collectorLimits:[{actorId,
maxPending}]}. Report shows examined, assigned, noIndependentCollector,
atCapacity and last run/failure. Configuration is audited. Existing backcheck
request/link/cancel, AppUser inbox and optional push are reused.

Acceptance: unit validation/ranking/capacity; PostgreSQL independence, balancing,
capacity overrides, manual counts, overlap, rollback, permission/form revocation,
current/deleted/decided/other-reviewer exclusions, cancellation, inbox, audit,
rotating batches and migration rollback; browser opt-in configuration, capacities,
reports, errors, read-only and narrow-screen access. Route, travel-time and daily
calendar capacity planning remain separate work.

## Validation evidence

- PostgreSQL: independence and balanced capacity; collector overrides; App User
  inbox and source references; standard link/cancel workflows; linked responses
  freeing capacity; retries; injected failure after request/claim writes;
  overlapping workers; permission revocation and closed response forms; manual
  load counting; other-reviewer, resolved, deleted, unsampled and non-current
  exclusions; a blocked 101-case queue advancing beyond its first batch;
  migration rollback/reapply.
- Unit: bounded policy validation, zero capacity, per-collector overrides,
  original collector exclusion and least-loaded selection.
- Browser: manager opt-in, response form, instructions, due interval, capacities,
  save retry, pause, waiting report, viewer read-only and narrow-screen layout.

Final local checks: 1,846 server unit tests passed (one existing pending),
62 hardening checks passed, 28 integration tests passed across allocation,
manual requests, scheduled sampling and claim versions, and six browser
workflows passed. Changed server/client files and browser tests pass lint.
Real browser push/Collect acceptance remains separate from mocked browser
workflow tests and the real PostgreSQL API checks.
