# Back-check cancellation and replacement

A reviewer assigned to the current claim can withdraw a pending field visit with
a required reason. Its collector, question, original request ID and history remain
unchanged. A new request can then be issued to another authorized App User.
Linked results cannot be cancelled or overwritten. Cancelling a request does not
cancel an offline form on a collector's device or notify the collector.

## Contract

POST `/v1/field-data/review-queue/:caseId/backchecks/:backcheckId/cancel`
requires submission.update on the case's form, its assigned reviewer, a current
claim and an in-review case. The body contains a UUID `requestId` and `reason`
(1–2000 trimmed characters); `If-Match` carries the case revision. The case and
request lock together. Successful cancellation stores timestamp, actor, reason
and operation ID, increments the case revision, and appends one audit event.
An unchanged retry by the same actor returns the current revision without another
audit event. Reusing the operation ID with a different reason is rejected.
Missing or stale revision, inaccessible cases and closed/linked requests fail.

The existing one-pending-request index and request endpoint allow a replacement
after cancellation. Cancellation does not erase the original assignment or
change immutable claim/evidence records. Cancelled requests cannot accept a
linked result. Terminal decisions no longer wait on the cancelled request;
a replacement request blocks them until its result is linked as before.

## Validation

PostgreSQL acceptance covers authorization, missing/stale revisions, empty reason,
idempotent retry, changed retry payload, one audit event, cancelled-link rejection
and retained history alongside a replacement. Browser acceptance checks reason
entry, disabled empty cancellation, retained history, hidden result linking and
replacement request controls. These are automated acceptance checks, not proof
of delivery to an actual Collect device. Offline cancellation messaging and
collector notification remain separate work.
