# R10 version-bound XML edit couriers

Fieldwork now accepts new and edited submission XML in the encrypted queue.
A courier edit binds the exact replacement bytes, one prior instance ID and the
SHA-256 of that prior native submission definition. Both the original submission
and the prior definition must belong to the authorizing App User. Courier rights
remain limited to the authorized bytes; no answer-reading or general edit role is
granted to the recipient.

## Workflow

1. Export the replacement XML from Collect with one `meta/instanceID` and one
   different `meta/deprecatedID`. Native encrypted envelopes may instead carry
   their single instance ID directly under the root. Save the XML using the
   existing **Fieldwork → Encrypted XML submission queue** workflow.
2. In **XML courier delivery**, connect as the original collector and select the
   replacement. Choose **Review prior XML version**. This fetches only the owned
   prior definition ID, fingerprint, current/historical status and check time;
   it does not fetch prior answers. Review the fingerprint and recipient, then
   check the authorization acknowledgement and authorize the exact edit.
3. Export/import the encrypted package as for R8/R9. The courier connects using
   their own same-project App User key, recovers or inspects the grant, verifies
   the signed prior-version fingerprint and delivers the authorized XML.
4. Deliver missing files using the media upload queue, with the **replacement
   instance ID**. Reserve and authorize each exact file as the original collector.
   Existing source, recipient, expiry, revocation and create-only checks apply.

The package format, encrypted acknowledgement checkpoints and original 24-hour
maximum deadline are unchanged. The ordinary queue upload and open-page automatic
sync can also submit edits through the existing native OpenRosa route; the
additional prior-hash authorization applies to the delegated courier path.

## Conflicts, attribution and attachments

After target/grant locks, the server locks the native claim before the prior source, matching Central's
version-write order. A courier can replace the currently authorized definition or
acknowledge the exact already-received immediate replacement. Any other newer
version, different prior hash, owner, form/version or replacement byte conflicts.
Two competing courier edits cannot both become current. Native Collect/courier
retries retain one version and one delivery event. Native edit history, claim
lineage and collector attribution remain intact, while a separate custody audit
records the actual courier. Provenance uses `xml-edit-courier@1`.

Ordinary edits retain unchanged referenced native attachment bytes and create
placeholders for new filenames. Retained attachments remain create-only; changed
file contents need a new filename. Encrypted edits inherit **no** old ciphertext:
a replacement envelope can change its key and IV schedule. Deliver every new
encrypted media file and the encrypted XML file as `application/octet-stream`.
Attachment indices remain native. An envelope receipt does not confirm attachment
completion or successful decryption.

Only a current, collector-owned edit with a recorded XML courier delivery receipt
is added to the resumable media recovery eligibility rule. Ordinary native edits
without that receipt do not gain new media recovery permissions. Older pending
transfers cease to be writable when their referenced version is no longer current.

## Proofs and retention

New-submission proofs retain `field-data.xml-courier-{kind}@1`. Edit grant,
revocation and delivery proofs use **`@2`** so older verifiers reject the new
semantics. The signed edit manifest adds `deprecatedId` and `baseSha256`; grant and
delivery bind `baseSubmissionDefId`, and delivery repeats the prior ID/hash.
Both browser verification and the independently pinned Node verifier reject wrong
purpose, manifest or lineage bindings. Download custody proofs from the existing
panel; raw XML is absent from grants and proofs.

Source/form/account grants, recipient, database expiry, signing and revocation are
rechecked on delivery. Source purge retains historical custody and its delivery
tombstone, prevents source recreation and reports source unavailable. Form/version
or project hard purge retains the existing cascade policy. The existing append-only
JSON ledgers support this proof version without a migration.

## Validation and remaining work

Coverage includes metadata-only owned-base review, incorrect fingerprints,
collector attribution, native claim lineage, exact retries, already-received edits,
competing native/courier writes, source purge, signed-proof tampering, unchanged
ordinary media, fresh encrypted attachment indices and delegated file recovery.
Real WebCrypto cases retain exact edited XML in encrypted packages; browser cases
exercise ordinary/encrypted edit review, reload, recovered grants, cross-account
package handoff, lost acknowledgements and mobile layout.

Closed-page background delivery, Collect-native queue integration and real-device
acceptance remain pending. These proofs attest account actions and exact bytes;
they do not establish physical custody, capture truth or successful decryption.
