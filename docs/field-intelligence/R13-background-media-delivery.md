# R13 closed-page resumable media delivery

Collectors and existing named media couriers can explicitly authorize background
transport for an exact reserved missing attachment. This includes opaque native
encrypted ciphertext. The submission XML must already be received; existing
collector ownership, current-version and create-only attachment rules apply.
Challenged camera photos remain foreground-only.

## Using Fieldwork

1. In **Recover media uploads**, select the original files or restore them from
   an encrypted media package. Choose **Reserve files for courier delivery**.
   Reserving confirms the exact SHA-256 without uploading file bytes. For a named
   courier, first use the existing **Delegated media couriers** permission and
   encrypted package handoff; the courier imports/restores the original files and
   matches that reserved transfer.
2. Under **Media delivery after closing this page**, choose a reserved file,
   duration and explicit consent, then **Authorize background media**.
3. The browser may resume verified 256 KiB chunks after the page closes. Reopen
   Fieldwork with your own key, then **Refresh background media deliveries** and
   **Inspect background media receipt**. The receipt reports exact file bytes and
   original collector/sender identities. Inspection rechecks current attachment
   availability. **Download background media proof** retains the signed history.
4. **Cancel background media authorization** stops the local copy first and
   requests permanent server revocation. Retry if revocation is unconfirmed.
   Already accepted attachments cannot be undone. Confirmed chunks remain usable
   through foreground delivery until the transfer is cancelled or expires.

## Permissions and receipts

The metadata-only authorization binds a client UUID, existing upload, original
collector, sender, project, native submission definition, exact manifest, token
hash, issuing time and expiry. A courier continuation additionally binds the
original signed grant's identifier and payload hash. Its expiry cannot exceed
that grant. Each capability status, chunk and completion request checks database
expiry, revocation, live accounts, original collection permission, exact reserved
manifest and current attachment target. Collector revocation of an original
courier grant blocks every later capability operation.

Only a random exact-file token is sent by the worker, in a header; no App User
key, session cookie or passphrase is retained by it. The token can inspect only
its own transfer progress, send verified chunks and finalize that attachment.
It cannot create another transfer or read attachment bytes. Verified tokens have
a bounded process-local retry guard of 240 requests/minute/authorization. This is
not distributed denial-of-service protection.

Foreground and background paths share chunk validation, whole-file assembly,
stored-blob verification and native attachment finalization. Completion locks
serialize native attachment writes and idempotent retries. Background audits have
no authenticated actor and explicitly record the original collector and sender;
these are transport assertions, not proof of account presence or physical custody.
Named courier completion also appends the existing signed custody receipt, binding
the background authorization identifier/hash when that transport completed first.

Background proofs use `field-data.media-background-{authorization|delivery|revoke}@1`.
The asynchronous Node verifier `cloudflare/verify-media-background.mjs` requires
independently pinned issuer, project and public keys, and rejects unsigned
revocation snapshots. The authenticated browser viewer reports unsigned
revocation explicitly. Metadata and receipts survive source purge and temporary
upload cleanup. Reusing a cancelled/expired upload identifier with background
history is forbidden, preventing old capabilities from reviving a cancelled
transfer; reserve a new UUID instead.

## Browser limits

A separate AES-256-GCM outbound copy uses an origin/job-bound authenticated
context and a browser-held non-extractable CryptoKey. File names, form/instance identifiers, hashes, deadlines and receipts remain
unencrypted background metadata. The browser can decrypt the outbound file
without the encrypted package passphrase. Locking the package, disconnecting,
signing out or closing Fieldwork does not cancel this explicit permission. The
worker never extends the original package deadline for restored package files.
Uncertain authorization retries preserve the exact UUID, token hash and deadline.

Limits: 20 MiB/file, 10 active local copies/100 MiB total, 100 local history rows,
1,000 authorizations/project and 20/transfer. One live authorization per transfer.
The deadline is at most 24 hours and cannot exceed the upload or courier grant.
The worker processes at most two files/wake, 80 chunks/file and a 90-second chunk
loop; partial progress resumes from the server-confirmed offset. Requests have a
45-second deadline. Temporary errors use bounded jittered retries (five retries,
respecting Retry-After); permanent refusal stops delivery. Final browser chances
stop remaining queued work. Accepted, cancelled, expired or stopped copies lose
local ciphertext and keys; cleanup occurs when the worker wakes or local history
is inspected. Server expiry is independent of browser cleanup and device clocks.

Background Sync must be present and registration must succeed before any outbound
copy or server authorization is created. Browser/OS policies, process shutdown,
network conditions, storage eviction and finite retry scheduling can prevent
completion. Foreground resume remains available. Automated browser tests dispatch
sync events to a restarted production worker with every Fieldwork page closed;
this verifies execution and recovery, not operating-system scheduling guarantees.

Native Collect queue integration and physical Android/browser pilot acceptance
remain separate work. Challenged camera capture intentionally retains its existing
foreground presence and nonce rules.
