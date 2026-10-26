# R5: encrypted companion XML submission queue

The public **Fieldwork** page provides **Encrypted XML submission queue** beside
media recovery. Connect as an App User, select exported new submission XML,
choose a passphrase of 12–128 characters, and explicitly encrypt/save. The queue
holds at most 10 XML files, 1 MiB each and 5 MiB combined, for 24 hours. One saved
queue exists per browser; successful save/import replaces it. Prepare the existing
page shell before leaving connectivity. Supported Collect exports/file-provider
access and real-device acceptance remain separate from this browser workflow.

Exact original bytes, SHA-256 digests, form/instance identifiers, project/collector
binding, priorities and delivery checkpoints reside inside AES-256-GCM ciphertext.
PBKDF2-SHA256 uses 600,000 iterations, fresh salt and IV for each save, with format
and origin as authenticated additional data. No App User key is persisted or
included in exported `.fdsubmissions` packages. Storage uses a separate IndexedDB
database from media packages. Import must decrypt, validate every XML/hash/scope
and pass expiry/size bounds before replacing storage. Plaintext XML with external
entities/DOCTYPE, missing or ambiguous identities, duplicate instance targets,
edited submissions (`deprecatedID`) and malformed XML is rejected. This is a new
submission queue; edits continue through Collect's native workflow.

Reload or disconnect clears open XML/passphrases. Reconnect as the same collector
in the saved project, unlock, then explicitly upload. Foreground uploads follow
high/normal/low priority, preserving selection order within priority. Updated
priorities are encrypted before sending. Pause stops after the current XML;
locking stops subsequent sends and clears plaintext. A request already accepted
by the server may complete after locking, so the retained queue can be retried.
No scheduled/background synchronization or credentials in a service worker are
introduced. Re-saving checkpoints never extends the original expiry.

The existing authenticated native OpenRosa multipart endpoint receives
`xml_submission_file` and rechecks live collection permission, published form,
version and server acceptance rules. Exactly identical XML/instance retries are
idempotent; different bytes for the instance produce a conflict and stop the
queue for supervisor resolution. Lost network acknowledgements or failed local
checkpoints leave pending bytes intact for exact retry. Each successful 201 is
checkpointed to encrypted storage before the next XML is sent. A changed/revoked
collector session clears open data. Package encryption is storage integrity,
not independent collector identity or a signed custody chain.

XML is sent before media; the UI explicitly states that accepted XML may still
have missing attachments. The existing media recovery/resumable upload workflow
can then deliver referenced files. Receipt history is available after refresh.
This feature does not alter Collect's own queue, delegate submission permission
to couriers, infer capture provenance, or certify physical custody. Background
sync, delegated courier/custody transport and physical-device acceptance remain
remaining offline-resilience work. Browser storage eviction remains possible;
export encrypted recovery copies and share passphrases separately.

Validation includes real Web Crypto round trips/tamper/origin/expiry tests; native
PostgreSQL-backed App User submission, exact retry, XML conflict and revoked-grant
checks; browser reload, priority, lost acknowledgement, conflict, invalid-save
preservation, access-loss clearing, export and narrow-screen checks. The mandatory
encrypted-package CI gate includes both media and submission cryptography suites.
No migration or native submission protocol change is required.

Version-bound edit queue/courier support is added by [R10](R10-version-bound-xml-edit-couriers.md).

Opt-in original-collector closed-page delivery is added by [R11](R11-background-xml-delivery.md), using a separate exact-file capability and browser-held outbound key.
