# R6: optional automatic XML synchronization in an open session

Fieldwork's encrypted XML queue now offers **Automatically sync unlocked XML
while this page is open**. This is an explicit, session-only choice for an unlocked
queue belonging to the connected App User and project. It does not persist across
reload, lock, logout, replacement of the queue or expiry. The saved package and
original 24-hour deadline remain unchanged. No credentials, passphrase or decrypted
XML are added to persistent browser/service-worker storage.

When enabled, pending XML is delivered using the existing priority order, exact
native OpenRosa bytes and encrypted per-acknowledgement checkpoints. Offline
sessions wait for an online event. Temporary network/timeout failures and HTTP
408, 425, 429, 500, 502, 503 and 504 can retry automatically. Each request has a
60-second timeout; a server may have accepted timed-out XML, so retry uses exactly
the retained instance and bytes. Conflicts, other permanent HTTP errors, local
crypto/storage errors, revoked access and changed collectors stop synchronization.
Local checkpoint failure never becomes a delivery acknowledgement.

At most five retries follow the initial attempt, with 5, 15, 60, 120 and 300 second
base waits plus 0–20% jitter. Retry-After seconds or HTTP dates can extend those
waits, never shorten them. HTTP-date delays use the response Date header when
available, avoiding an early retry from an ahead-of-server device clock. Server pauses longer than an hour stop automatic
synchronization for explicit user recovery. Online-event bursts cannot bypass a
pending server/backoff deadline or start concurrent queue sends. Attempts remain
bounded even if individual earlier files were delivered successfully. On exhaustion,
resolve the error and explicitly enable synchronization again or send manually.

**Pause after current XML** and unchecking automatic sync cancel scheduled retries
and stop after any in-flight XML. Lock clears open data and cancels retries; a
request already accepted by the server may finish, leaving exact retry as the
recovery path. Reload/unmount removes the online listener, timer and opt-in.
Automatic sync does not resume simply because a saved package is later unlocked.
Access denial clears the parent authenticated session and child plaintext state.

The page must remain open. Background tabs may run while the browser allows it;
mobile browser suspension, device sleep and closed-page delivery are not promised.
This adds session-bound automatic synchronization, not a service-worker background
transport or a modification of Collect's native queue. Media recovery remains a
separate workflow. Delegated courier/custody delivery, closed-page synchronization
and real-device acceptance remain pending.

Validation uses actual browser online/offline events, Web Crypto, controlled
clocks, native multipart fixtures, repeated online events, Retry-After, exact-body
retry, permanent conflict, five-retry exhaustion, pause/lock/reload cancellation,
request timeout and access-denial clearing. Unit checks cover delay bounds,
server-wait parsing and refusal to retry unclassified storage/local failures.
Existing XML recovery and encrypted-package suites remain regression gates.
No database migration or server submission protocol change is required.

Opt-in original-collector closed-page delivery is added by [R11](R11-background-xml-delivery.md), using a separate exact-file capability and browser-held outbound key.
