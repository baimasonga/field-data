# R8: scoped XML courier delivery

Contract: the connected original collector authorizes one named same-project App
User to deliver a bounded new XML submission. The grant sends metadata only:
published form/version, instance ID, exact SHA-256 and byte size. Raw answers remain
in the existing encrypted R5 package until the courier explicitly delivers them.
No collector key is shared. New ordinary XML exports supported by R5 are accepted;
submission edits, ambiguous instance IDs and external
entities/DOCTYPE are excluded.

The server preserves the original collector as native submitter and records the
courier as the authenticated executor/finalizing account. Native submission,
attachment-placeholder, claim, provenance and receipt paths remain in use. Missing
media is recovered separately through R2/R7. Every delivery checks the live project,
published form/version, original collection grant, recipient account, exact bytes,
server expiry and permanent revocation. Same bytes and original owner may match an
already-received current root; different XML, another submitter, edited/deleted
submissions or changed identities cause conflict. No source is overwritten.

Targets bind each form/instance to one original owner and immutable manifest.
Only one courier grant may be active per target; after revocation/expiry the owner
may authorize another courier for the same bytes. Target locks serialize grant,
revocation and delivery. A single delivery tombstone per target survives submission
purge and prevents resurrection. Signed custody data contains no XML/answers and
persists until form/project purge. New grants and delivery require the existing
signing authority; revocation stays effective with an explicit unsigned event if
signing is unavailable. Snapshot proofs cannot establish physical custody or the
absence of later events.

Bounds: 1 MiB per XML, 24-hour maximum server grant, 1,000 targets per project and
20 grants per target. Package expiry never extends. Proof reads require current
original collection permission and participant identity; original owners may revoke
after losing collection permission. Lost acknowledgements retry exact requests.
This is explicit foreground courier transport, not closed-page/background delivery,
radio discovery or a change to Collect's native queue. Real-device acceptance
remains separate.

## Use and recovery

On the same Fieldwork origin, connect as the original collector and encrypt/save
new XML in the existing queue. Under **XML courier delivery**, choose a submission,
recipient collector ID, duration and explicit acknowledgement, then authorize.
Share the grant ID and exported encrypted package, with its passphrase separately.
If the grant acknowledgement is lost, retry exactly; after reload, unlock the
package and choose **Find XML courier grant** to recover accessible history.

The courier connects with their own key, imports/unlocks the package, selects its
submission and inspects the grant. **Deliver authorized XML** sends the exact
bytes through the scoped route. The ordinary original-collector upload stays
unavailable to another account. XML is attributed to the original collector;
the separate custody audit/receipt identifies the actual courier. Native workers
continue to receive collector-attributed submission creation. Original collection
permission and an open, published form/version must remain available.

Delivery checkpoints stay inside the original encrypted package and never extend
its expiry. A lost network response retries identical bytes. If local encrypted
storage fails after server acceptance, inspect the signed receipt and choose
**Save XML delivery acknowledgement** without resubmitting. A current authenticated
source-availability check withholds that acknowledgement for edited, deleted or
purged XML, while the historical signed receipt remains inspectable. Revocation
does not remove already-received XML; purge does not authorize resurrection.

An owner can revoke after losing collection permission. Grant discovery/proof
reads require current participant identity and original collection permission;
a courier sees only grants naming that account. After expiry/revocation a new
grant can name another courier for the same immutable target. Receipt tombstones
prevent further grants after delivery. Discovery is bounded by 20 grants per target.

`cloudflare/verify-xml-courier.mjs` exports `verifyXmlCourierProof(proof,
{ issuer, projectId, publicKeys })`. Independently pin the issuer/project/authority
keys. The verifier checks purpose, signatures, target/version/owner/recipient
bindings, file hash/size, grant hash, receipt chronology and signed revocation;
unsigned revocation histories are rejected for offline verification. Browser
verification also displays an explicit warning for server-effective unsigned
revocation. Source availability and absence of later events remain authenticated
snapshot information, not independent cryptographic guarantees.

Native encrypted envelope support is added by [R9](R9-native-encrypted-xml-couriers.md); its ciphertext attachments require separate delivery.

Version-bound edit queue/courier support is added by [R10](R10-version-bound-xml-edit-couriers.md).
