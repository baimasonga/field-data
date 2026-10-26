# R7 contract: delegated media courier delivery

An original App User may authorize one different active App User in the same
project to transport one reserved, ordinary missing-media transfer. The grant
binds the immutable upload UUID, current source definition, complete manifest/hash,
owner, recipient and an expiry no later than the original 24-hour transfer window.
No collector access key is shared. Challenged capture transfers are excluded.

The courier explicitly receives the encrypted media package/passphrase separately,
unlocks it and selects the same bytes through the existing resumable queue. The
server exposes only authorized transfer manifests, never existing source answers
or attachment bytes. Every read/chunk/completion checks the recipient account,
original collector's current collection permission, live source, missing attachment,
grant expiry/revocation and complete file hash. Existing create-only native attachment
locking remains authoritative. Courier access grants no XML creation/edit, answer
read, unrelated attachment access or ability to authorize another courier.

Grant and final delivery carry root-signed, purpose-separated attestations. The
actual authenticated uploader is recorded, including when the owner completes the
transfer. Permanent revocation stops further courier access; revocation remains
possible if signing is temporarily unavailable, with an explicit unsigned event.
Each grant has at most one revocation and one delivery event. These records are
append-only, survive temporary-upload cleanup, and cascade only with their source
or project. Signing must be available for new grants and final delivery of granted transfers,
including completion by their original owner.
Grant retries bind the same request and immutable body. Retained grants consume
their transfer UUID even after temporary cancellation/cleanup, preventing stale
authority from being reused for another file. Delivery is idempotent.

The original collector can revoke after losing form collection access, without
regaining media access. Source access checks apply to proof exports. Couriers may
resume matched files but cannot cancel the owner's transfer. Expiry is enforced
with database time. Enrollment is limited to 1,000 grants per project, and existing
transfer quotas continue to apply. No unattended radio transport or physical
custody/presence inference is claimed. XML courier transport, closed-page background
transport, multi-hop delegation and physical device acceptance remain pending.

## Use

Connect on Fieldwork as the original collector, select ordinary files under
Recover media uploads, then choose **Reserve files for courier delivery**. The
Server transfers list shows each transfer UUID and owner account. Enter that UUID,
the intended courier's collector ID (shown in their connected courier panel),
duration and explicit acknowledgement under **Delegated media couriers**, then
choose **Authorize media courier**. No file bytes are sent during reservation.
Use Prepare queue for encrypted storage and the existing encrypted-media controls
to export the files; send the package and passphrase separately.

The courier connects with their own App User key, imports/unlocks the package,
adds it to the queue, then uploads/resumes. Exact full-file matching discovers the
authorized reservation; incomplete chunks resume. The list shows up to 50 transfers.
For a known transfer outside that list, inspect its courier proof first, then add
the matching file and resume; up to ten inspected transfer IDs are checked directly. Either participant may inspect
and download the source-scoped proof. The owner may permanently revoke it; changing
recipient requires canceling a pending transfer and reserving a new UUID. A courier
can remove local files but cannot cancel the owner's server reservation. Original
collection permissions must remain active through transport and proof reads.

`cloudflare/verify-media-courier.mjs` exports `verifyMediaCourierProof(proof,
{ issuer, projectId, publicKeys })`; pin the authority keys independently. It checks
purpose, signature, manifest and source/actor bindings, receipt hashes, chronology,
recipient expiry and signed revocation. It rejects unsigned revocation histories;
check authenticated current server state for those. The browser also verifies
signatures and source bindings before offering export, while treating an unsigned
revocation as effective server state with an explicit warning. Authority-origin
changes require a fresh transfer/grant for further courier delivery. Proof export
does not assert the absence of later events or verify physical possession.

Verification covers native exact-byte delivery, permissions and unrelated accounts,
source-grant loss, key/signing availability, revocation, expiry/cleanup, consumed
UUIDs, append-only history, source purge, rollback retention and concurrent writes.
Browser tests cover reservation, lost-acknowledgement retry, encrypted package
handoff, courier delivery, verified export, revocation, forged proof rejection,
access-loss clearing, challenged-photo exclusion and narrow screens.
