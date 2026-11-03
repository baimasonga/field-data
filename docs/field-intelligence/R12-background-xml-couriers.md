# R12 closed-page XML courier delivery

An existing named XML courier can opt into background delivery for the exact
collector-authorized XML package. This includes ordinary XML and encrypted,
version-bound edits. The collector's access key is never needed by the courier
or retained by the background worker.

1. The collector grants an R8/R10 XML courier permission and transfers the
   encrypted submission package and its passphrase through the chosen channel.
2. The named courier opens Fieldwork with their own access key and imports the
   package. Under **Delivery after closing this page**, enter **Courier grant ID
   for background XML**, then **Check courier grant for background XML**.
3. Check the collector, recipient, exact XML and expiry. For edits the reviewed
   prior version comes from the signed original grant. Consent and select
   **Authorize background XML**.
4. Reopen Fieldwork as the courier, unlock the package and **Refresh background
   deliveries**. **Save background delivery acknowledgement** verifies a fresh
   receipt and current source before saving the encrypted package checkpoint.

The background deadline cannot exceed the package, original courier grant or
24-hour limit. Collector revocation of the original grant stops delivery. Either
the collector or courier may cancel the separate background authorization; only
the collector may revoke the original courier grant. Live source permissions
and both accounts are checked when delivery reaches the server. Native submission
ownership and edit lineage remain attributed to the original collector.

R11 browser support, encrypted outbound storage, bounded retries, cancellation,
expiry, history limits and best-effort scheduling apply unchanged. Locking the
original package does not cancel an explicitly authorized outbound copy. Browser
or operating-system scheduling cannot guarantee eventual delivery. Media files
still use the existing foreground/resumable media workflow.

Courier background proofs use `field-data.xml-background-{authorization|delivery|
revoke}@2`. They include the original signed courier proof, binding its payload
hash, exact target, sender and expiry. Delivery appends both a background receipt
and the existing R8/R10 custody receipt. The latter binds the background
identifier/hash when background transport accepted the file first. A previously
accepted foreground receipt can instead be acknowledged for the same native
submission definition. These are account transport assertions, not evidence of
physical custody or collector presence. The standalone verifier at
`cloudflare/verify-xml-background.mjs` requires independently pinned issuer,
project and public keys. Historical receipts survive source purge; missing source
cannot be redelivered from the receipt.

Validation covers real PostgreSQL authorization, exact bytes, original collector
attribution, encrypted edit lineage, concurrent transports and revocation,
source permission loss, purge and migration history retention. Browser tests use
the production service worker, imported encrypted packages and a restarted worker
with all Fieldwork pages closed; automated sync dispatch exercises execution,
not an operating system's scheduling policy.

Remaining: closed-page media delivery, native Collect integration and physical
Android/browser acceptance under the operator's pilot conditions.
