# R11 closed-page background XML delivery

The original collector can explicitly authorize exact queued XML for delivery by
the browser after Fieldwork closes. New XML, native encrypted envelopes and
version-bound edits use the same native acceptance rules as R8–R10. The worker
retains an exact-file capability, never the App User access key. This uses
Background Sync where the browser supports it; browser/OS scheduling is best effort.

## Workflow

1. Connect as the original collector and unlock the encrypted XML queue. Under
   **Delivery after closing this page**, select the XML. For an edit, choose
   **Review background edit base**, inspect the fingerprint and acknowledge again.
2. Choose one hour, four hours, or the remaining package deadline (at most
   24 hours). Explicitly acknowledge that the browser can decrypt a separate
   outbound copy after the passphrase queue is locked. Choose **Authorize
   background XML**. The browser may send it immediately or after the page closes.
3. Keep the original encrypted package. After reopening, reconnect and unlock it,
   then **Refresh background deliveries** or **Find selected background receipt**.
   **Inspect background receipt** checks the authenticated server snapshot.
   **Save background delivery acknowledgement** rechecks the signed receipt and
   live source before durably checkpointing the original encrypted package.
4. Upload referenced media separately. An XML/envelope receipt confirms those
   exact bytes only. For an edit, use its replacement instance ID; ordinary
   unchanged files are retained, encrypted edits need all fresh ciphertext files.

Unsupported browsers create no background authorization. Existing foreground and
open-page automatic sync remain available. No notification permission is needed.
Closing all browser processes, device power policies, unavailable connectivity or
browser scheduling can delay or prevent the sync event; reopening Fieldwork and
checking the receipt remains necessary.

## Private outbound copy and cancellation

The worker encrypts the exact XML and a random 256-bit delivery token using a
fresh AES-256-GCM key and IV, with origin/job-ID authenticated context. The
non-extractable CryptoKey is structured-cloned into a separate IndexedDB store so
a restarted worker can decrypt the opted-in outbound copy. The browser can use
that key without the queue passphrase. Only enable this on a trusted browser.
Passphrase-protected queue storage and expiry remain independent.

The local copy is staged before the metadata-only authorization request. If that
request's acknowledgement is uncertain, **Retry exact background authorization**
reuses the same UUID, token hash, manifest and deadline across reloads. Confirmation
verifies the server's signed authorization before scheduling. No raw XML or token
appears in authorization requests, grant history, custody proofs, URLs or caches.

Locking, disconnecting, closing the page or deleting the passphrase queue does
**not** cancel this separately authorized copy. **Cancel background authorization**
scrubs local ciphertext/key/token first, then requests permanent server revocation.
If connectivity fails, the UI explicitly says server revocation is unconfirmed;
retry cancellation after reconnecting. A request already accepted cannot be undone.

Accepted, cancelled, expired or terminally stopped copies lose their local delivery
secrets. Cleanup runs when the worker executes or local history is inspected; a
browser that never wakes can retain encrypted bytes and its key until then. The
server still enforces the absolute expiry independently of browser execution or
clock. Retained metadata/proofs can be removed with **Remove local background
history**; server custody retention remains unchanged.

## Authorization and native semantics

A separate anonymous PUT route accepts only a 43-character exact-file token in
`X-Field-Data-Delivery-Token`, checked against its immutable SHA-256 using a
constant-time comparison. It cannot read answers, inspect proofs or authorize
another job. All creation/inspection/revocation APIs still require the original
App User key, and unrelated accounts cannot inspect or revoke the authorization.
The public PUT is rate-limited; raw XML is bounded to 1 MiB and parsed strictly.

Every delivery rechecks current collector/project/form/version permission, exact
manifest, database expiry, permanent revocation and signing authority. Edits also
bind the owned prior definition/hash and native claim lineage. Native submitter,
audits and workers retain collector attribution. A separate audit and signed
receipt identify transport as `background-capability`, without asserting that the
collector or a particular physical device was present at receipt time. The separate
background audit has no authenticated actor; it records the authorizing owner
in its details.

Courier and background delivery share the immutable form/instance target and
consult both receipt ledgers under its lock. Exact simultaneous native/courier/
background retries cannot create competing versions. A recorded target tombstone
survives source purge and prevents either capability transport from recreating
that source. The current exact source must remain available for acknowledgements.
Current collector-owned background edits with a recorded delivery receipt can
recover missing files using the existing resumable/media courier transport.

One live background authorization is allowed per target; revoked/expired jobs can
be replaced for the same immutable bytes while no delivery is recorded. Limits:
1 MiB/XML, 10 active local copies/5 MiB total, 100 local history rows, 1,000 shared
XML targets/project and 20 background authorizations/target. Server history lists
50 latest permitted records; selected form/instance lookup recovers older records.
Form/version/project hard purge cascades custody. Migration rollback retains
nonempty history and never silently discards authorizations or receipts.

## Retry policy and verification

Each attempt has a 45-second timeout. Up to two files are attempted per sync event;
IndexedDB leases prevent concurrent workers from sending the same local job.
Temporary network/408/425/429/500/502/503/504 failures receive at most five retries
with increasing 5/15/60/120/300-second delays plus up to 20% jitter. Retry-After
seconds or HTTP dates can lengthen the pause; pauses over one hour or beyond the
original deadline stop delivery. The worker asks the browser to reschedule, never
holds a timer open to simulate persistent execution. The browser's final-chance
signal stops remaining work. **Ask browser to retry background delivery** respects
the saved pause and original deadline. Permanent access/conflict, signature,
integrity and storage failures do not mark XML accepted.

The browser verifies ES256 signatures, key fingerprints, current origin/project,
manifest/token-hash bindings, expiry bounds, source/receipt times and edit lineage.
Purpose-separated proofs use `field-data.xml-background-{authorization|delivery|
revoke}@1`. Server-effective unsigned revocation is displayed explicitly. Independent
verification via `cloudflare/verify-xml-background.mjs` requires separately pinned
issuer, project and P-256 public keys and rejects unsigned history. Source
availability is an authenticated snapshot, not a signed guarantee of future
availability or absence of later events.

## Validation and remaining work

PostgreSQL cases cover key-free scoped delivery, ownership, current permissions,
closed forms, signing outages, exact retries, expiry independent of the browser,
revocation races, purge-resistant cross-transport tombstones, native receipt time,
edit conflicts, fresh encrypted media and nonempty migration rollback retention.
Real production-build browser cases close every Fieldwork page, restart the worker,
dispatch a sync wakeup and verify byte-exact delivery without an App User key. They
also cover encrypted edit review, encrypted/non-extractable local storage, lost
acknowledgements, cancellation during connectivity failure, unsigned revocation,
bounded retries, expiry cleanup, fresh-source acknowledgement and unsupported
browser fallback. Controlled sync dispatch verifies the protocol, not real-device
OS scheduling or guaranteed delivery time.

Closed-page delegated-courier/media transport, Collect-native queue integration
and physical/device acceptance remain pending. The eight-area programme remains
partial outside Knowledge's separately recorded software completion contract.
