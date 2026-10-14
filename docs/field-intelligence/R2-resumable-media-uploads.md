# R2: companion resumable media uploads

The companion fieldwork page can recover missing media for a collector's own,
unedited, current published submission. Submission XML must already be received:
this orders submission data before media, but does not change ODK Collect's native
upload protocol or queue XML submissions. Collectors choose the form ID, synced
instance ID and original media files referenced by the XML.

A transfer reserves a 24-hour server session and uses sequential 256 KiB chunks.
Each chunk has SHA-256 verification; identical retries do not advance twice.
Out-of-order or changed chunks are rejected. Completion requires the full declared
size and whole-file SHA-256, checks the actual deduplicated storage bytes, then
atomically links the native Central attachment and records the normal attachment
update audit. The existing evidence worker processes that audit. Byte integrity
is not proof of the field claim or capture time.

Every status/chunk/completion rechecks the App User, active project, open form,
submission ownership, current root definition, collection grant and expected
missing attachment. Database row locks serialize relevant state changes during
acceptance. Completed retries are idempotent; another actor cannot read or change
the session, and an already populated attachment cannot be overwritten through the companion API. Owners
may discard their temporary session after form access is removed. Start, cancel
and completion leave audit history.

Chunks and offsets persist in PostgreSQL, without dependence on a container's
local filesystem. Access expires after 24 hours. Expired sessions and chunks are
removed at the next upload creation; physical cleanup is not a timed background
job. Source/project/actor hard deletion cascades temporary data. Rollback keeps
nonempty temporary tables and preserves delivered native attachments.

Limits: 20 MiB per file; 10 pending transfers and 100 MiB reserved per App User;
256 MiB reserved globally. Whole-file assembly/verification is serialized to bound
memory. Creation quotas are serialized. The foreground browser queue sends high
priority first, then normal, then large media, with smaller files first within a
priority. Saved priorities are restored after matching the complete original file
hash. Pause finishes the current chunk. Interruptions keep confirmed chunks;
reopening requires reconnecting and reselecting the same file. A different file
requires cancelling the saved transfer. Media and credentials are not persisted
in browser storage, and disconnect clears the tab's queue. Transfers cannot carry
into a new authenticated tab session.

This is not a background upload queue or native Collect resumable support.
Browser file access to Collect media needs an export or supported Android file
provider. Files over 20 MiB, persistent encrypted media queues, priority XML
submission queues, encrypted relays and real-device acceptance remain pending.

Validation covers exact native attachment delivery, incomplete and corrupted
transfers, duplicate and concurrent chunk retries, ownership and revoked grants,
expiry cleanup, quota release, stored-byte corruption, priority, lost responses,
page-reload recovery, pause/cancellation, no browser persistence and mobile layout.
Concurrency checks also cover the standard attachment endpoint and Collect's
OpenRosa XML-plus-media retry. Blob deduplication reads a fresh snapshot after a
concurrent insert; standard attachment writes recheck the create-only missing
attachment rule under a row lock. The API suite runs
in the required PostgreSQL gate.
