# R14 verified Collect instance-file handoff

Fieldwork can import one exported native Collect instance folder, preserve its
XML and referenced files in one encrypted package, send the exact bytes through
the native OpenRosa multipart endpoint, and verify the stored XML and every
expected attachment before saving a signed verification snapshot.

This is a file-based integration. Collect's Android queue, finalized/draft state
and send status remain controlled by Collect. Fieldwork does not read its private
database, finalize drafts, mark native instances sent, or discover private Android
storage. Export through a file provider supported by the device, then explicitly
confirm the finalized files and original collector/project. Android file-provider
and native queue automation acceptance remain separate work.

## Workflow

1. Connect to **Fieldwork** as the original collector. Open **Collect instance
   handoff** and select one flat exported **Collect instance folder**, or select
   that instance's XML and files together using **Collect instance files**.
2. Choose **Review Collect files**. Review the XML, original collector/project,
   filenames, sizes and SHA-256 values. No upload starts. When `submission.xml`
   exists it takes priority over the original instance XML, matching Collect's
   native uploader. Otherwise exactly one unambiguous instance XML is required.
3. Only files referenced by the XML are included. Encrypted envelopes require
   their `encryptedXmlFile` and every declared `media/file` ciphertext. Original
   plaintext, unrelated files, hidden files, settings and database/savepoint files
   are excluded. Multiple instance folders, ambiguous XML, duplicate or unsafe
   names and missing required ciphertext stop preparation.
4. Confirm that these finalized files belong to the connected collector/project.
   Supply a passphrase and **Encrypt and save Collect handoff**. One dedicated
   encrypted package is replaced only after complete validation/encryption.
   Existing XML, media and background queues remain independent. A late verification
   response cannot overwrite a package explicitly saved/imported in another tab.
5. **Send Collect files** uses the native OpenRosa endpoint with original XML and
   media bytes. It then separately verifies the current stored source and all
   expected attachments. Only a valid signed snapshot, durably saved back to the
   encrypted package, displays complete verification. XML acceptance alone does
   not verify files.
6. If a response is lost or verification is incomplete, use **Verify received
   Collect files** to check without resending. Native exact retransmission uses
   the existing server semantics; conflicting XML or media cannot produce a
   matching snapshot. Collect may still display its own unsent status: keep the
   source files unchanged and reconcile native status through Collect.
7. **Export encrypted Collect handoff** creates `.fdcollect` for recovery.
   **Download Collect verification snapshot** creates a signed metadata-only
   point-in-time artifact. Lock clears open files/passphrase. Import/unlock never
   auto-sends; a different connected collector cannot send or verify this package.

## Integrity and permission contract

The encrypted `offline-collect-handoff@1` package binds origin, original actor,
project, creation/expiry, exact XML, referenced files, and an optional snapshot.
AES-256-GCM uses a fresh salt/IV, PBKDF2-SHA-256 (600,000 iterations), and
schema/origin-bound authenticated context. Filenames, identities, hashes, XML,
media and snapshots are inside the encrypted package. App User keys are never
included. Unlock/import rechecks sizes, hashes, references, ownership metadata,
expiry and any included signature before replacing the saved package. Source
files are read-only. Package expiry is device-clock based; server permission
checks do not depend on that clock.

`POST /v1/field-data/app-user/collect-handoffs/verify` accepts only a bounded
manifest, not file contents. It requires an active original collector and project,
current collection permission, an open published form/version and an owned current
non-draft native submission definition. It locks the source and attachment rows
while comparing exact stored XML size/SHA-256 and the complete expected attachment
set. Missing, extra, changed or unavailable files refuse verification. Database
blob sizes are checked before fetching bytes; object-storage bytes are hashed
through a bounded stream and stopped if larger than the requested size. A global
verification lock bounds concurrent hash work. A bounded process-local retry guard
allows six verifications/minute per authenticated credential; it is not distributed
DoS protection.

The signed `field-data.collect-handoff-snapshot@1` binds collector, project, form,
form definition, native submission definition, exact sorted manifest/hash,
original XML receipt time and verification time. Verification writes only a
metadata audit, not submissions or attachment bytes. No new custody ledger or
core ODK schema is introduced. The independent Node verifier
`cloudflare/verify-collect-handoff.mjs` requires pinned issuer, project, original
collector and public keys, and can additionally pin the expected manifest.

A snapshot proves the stored bytes checked at that time. It does not prove Collect
origin, Android presence, successful decryption, native queue status or future
availability. A downloaded snapshot remains verifiable after purge or permission
loss; a fresh online check then fails. An imported snapshot's embedded public key is not a trust anchor. Imported or
unlocked snapshots remain historical until explicitly rechecked through the
authenticated server in the current session. Independent offline verification
requires the separately pinned keys described above.

## Bounds and evidence

One instance/package: XML up to 1 MiB, up to 10 referenced media files and 20 MiB
media total; 24-hour package lifetime. Folder selection is bounded to 50 files and
44 MiB including excluded plaintext/ciphertext copies. Encrypted archive import
is bounded to 48 MiB. Unsupported or inaccessible file providers retain the
ordinary file-selection/export workflow; ZIPs and entire Collect project/database
backups are not treated as instance folders.

The selection rule is grounded in Collect upstream commit
[e008fbcf5dd4e957d513760c9001707f8cf75989](https://github.com/getodk/collect/blob/e008fbcf5dd4e957d513760c9001707f8cf75989/collect_app/src/main/java/org/odk/collect/android/instancemanagement/send/OpenRosaServerInstanceUploader.kt#L153),
which explicitly prefers `submission.xml` and documents a failure window that
leaves original plaintext alongside encrypted files. This bridge sends only the
referenced files, preventing those unrelated originals from being included.

Real PostgreSQL checks cover native multipart idempotence, collector ownership,
complete attachment hashing, missing/changed files, revoked permission, purge,
opaque encrypted ciphertext and bounded object-storage streams. Browser checks
cover actual folder selection, encrypted storage and reload, precise multipart
bytes, encrypted-envelope priority, lost-response recovery without resend,
forged snapshots, corrupt imports, missing ciphertext, ambiguity and actor binding.
Physical Android/provider behavior and automatic native queue/status integration
are not established by desktop browser or server tests.
