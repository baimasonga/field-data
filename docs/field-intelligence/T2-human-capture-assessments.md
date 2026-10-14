# T2: human assessment of challenged photos

Submission details now offer separate judgments for the matching paper challenge
code (visible, absent/different, unclear) and the scene's support for the claim
(supports, does not support, unclear). Reviewers explicitly attest that they reviewed
the originally challenged image. Concerns or uncertainty require explanatory notes;
notes are capped at 2,000 characters. These qualitative judgments do not certify
location, device, capture time or the whole field claim, and do not change Central's
submission review state or the claim review case automatically.

A protected image download serves the immutable blob originally bound by T1,
checks its complete SHA-256 and 5 MiB limit, and logs the read. It stays available
after an attachment replacement or submission edit while the source and read
permission remain available. Blob cleanup treats challenge and assessment references
as retained evidence, independently of the audit worker. Reviewer responses omit
the full capture nonce.

Assessments are append-only records with an immutable reviewer name snapshot,
reviewer ID, server timestamp, decisions, note, original-image attestation and bound
fingerprint. The reviewer foreign key becomes null if the actor is hard deleted;
the name snapshot remains. New notes/decisions create a new revision. A request UUID
and normalized actor/body/revision hash make retries idempotent. Identical retries
return the original assessment; changed bodies or reviewers under the same request
ID are rejected. If-Match (capture-N) is required, and stale revisions return 412.

Read access follows submission.read. Writes require a live web User and
submission.update; the inherited form/project/species grant, role and reviewer row
are locked during the transaction. Archived projects accept no new assessments.
The current submission definition and expected attachment are locked before the
challenge, following upload lock ordering. Writes require the bound blob still to
be the current attachment, and its actual stored bytes must match the challenge
fingerprint. Concurrent replacement cannot yield a new current assessment for
another image. Completed retries can return historical/outdated records after a
replacement, after current authorization is rechecked.

The capture panel includes challenges from previous definitions of the same
submission. Once an attachment changes or the source version is superseded, saved
assessments show an outdated warning and new decision controls disappear. Original
history remains readable. Restoring identical original bytes in the same current
definition makes that assessment applicable again; superseded definitions remain
outdated. Binding-current describes the attachment reference; stored-byte integrity
is rechecked at image download and assessment creation. Images whose storage was
corrupted cannot be downloaded or newly assessed.

The panel initially lists at most 20 challenges and the latest 10 assessments per
challenge. Earlier records have an explicit paged history endpoint and button.
Invalid response shapes fail closed. Refresh/retry controls are independent of the
main evidence and activity panels. Interrupted writes retain their request identity;
changing an uncertain save requires a refresh first. Conflicts refresh the history
rather than applying an old draft. The new table/revision column are preserved on
rollback once assessments exist. Source/challenge hard deletion cascades assessments
according to the existing source-retention policy; central audit events remain.

Validation covers decisions and notes, original-byte attestation, reviewer/viewer
rights, deleted sources, immutable identity/history, pagination, retry mismatch,
stale revisions, replacement/supersession, original downloads after replacement,
corrupt bytes, archive rules, concurrent saves and replacement, lost acknowledgements,
read-only controls, changed-attachment refresh and 320px layout. Native and resumable
media regressions remain in the required PostgreSQL gate.

Remaining trust work includes signed witness attestations, sensor corroboration,
visual similarity/capture attestation and real-device acceptance. This workflow
records a reviewer's assertion; it cannot establish whether the person actually
examined the photograph or whether the scene was staged.
