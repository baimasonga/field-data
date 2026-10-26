# R9 native encrypted XML envelope couriers

The Fieldwork XML queue and exact-byte XML courier delivery now accept native
OpenRosa encrypted submission envelopes. This extends R5/R8 without changing the
offline package schema, grant manifest, proof purpose or expiry.

## Use

Export the new submission envelope XML and its referenced ciphertext files from
the collecting device. Save the envelope in **Fieldwork → Encrypted XML submission
queue**, then authorize and hand off its encrypted package using **XML courier
delivery**. The recipient uses their own App User key. Ordinary foreground and
session automatic queue upload also preserve the envelope bytes.

After the envelope is accepted, the original collector reserves each missing
ciphertext file under **Recover media uploads**, using `application/octet-stream`.
The existing delegated media courier flow authorizes a recipient per exact file.
Deliver the encrypted XML file as well as every encrypted media attachment; the
native attachment indices and original collector attribution are preserved.
An envelope acknowledgement confirms only the envelope, not attachment completion
or successful decryption. Existing native Central decryption and export behaviour
continues to apply; this transport never asks for the decryption key.

## Validation and custody

One direct `base64EncryptedKey`, `encryptedXmlFile` and
`base64EncryptedElementSignature` are required. Key and signature values must be
bounded canonical base64; the ciphertext filename is bounded and cannot contain
path separators or control characters. This is structural validation, not a
cryptographic verification of the encrypted element signature or a guarantee
that the declared ciphertext is decryptable. Missing or duplicate fields, nested
values, entities, document types, edits, invalid UTF-8 and oversized files fail.

Exactly one instance ID may appear either in direct `meta/instanceID` or, for an
encrypted envelope, direct `instanceID`; providing both fails. The server also
requires agreement with Central's native parser before any source is created.
The whole envelope SHA-256 and size remain bound to the grant; modifying key,
signature, filename or any other byte requires different authorization. Existing
current permissions, recipient checks, expiry, revocation, tombstones, source
availability and signed account custody receipts apply unchanged.

No key, signature or ciphertext is included in grant requests, grant history or
custody proofs: they contain the envelope manifest only. The encrypted package
contains the exact envelope, with the same origin/collector/project binding and
24-hour maximum deadline. Native missing-attachment placeholders retain ordered
ciphertext indices, and each later media transfer has its own digest and custody.

## Validation and remaining scope

Server parser cases cover both instance locations and malformed/ambiguous
wrappers. PostgreSQL API coverage checks exact envelope retention, original
collector attribution, native encryption metadata, indexed missing attachments,
idempotent delivery and delegated delivery of both encrypted XML and media bytes.
Real WebCrypto tests cover encrypted package round trips without byte changes.
A browser handoff case covers export/import to another collector account,
metadata-only authorization, exact retry after a lost delivery response and a
durable encrypted acknowledgement.

Closed-page background transport, edit delegation, Collect-native queue changes
and physical-device/decryption acceptance remain pending. This release implements
opaque ciphertext transport; it does not assert independently validated capture,
identity, content integrity after decryption, or physical presence.
