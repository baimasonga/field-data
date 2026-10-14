# R3: encrypted offline media packages

The public companion fieldwork page has an Encrypted offline media card, usable
without connecting. Enter the expected form and submission instance IDs, select
original image/audio/video files, and save using a 12–128 character passphrase.
One package per browser holds at most 10 files and 20 MiB combined, with a 24-hour
validity window. Saving or importing successfully replaces the previous package.
Prepare the public page for offline use before leaving connectivity.

AES-256-GCM encrypts the complete manifest, filenames, IDs, priorities, whole-file
SHA-256 hashes and bytes. PBKDF2-SHA-256 uses 600,000 iterations with fresh 16-byte
salt and 12-byte nonce. Origin and schema are authenticated additional data. Only
schema, salt, nonce and ciphertext are stored in a dedicated IndexedDB database.
No App User credential or passphrase enters the package or persistent storage.
The key is nonextractable and lives only during the operation. Shared-device and
in-memory JavaScript compromise remain outside this protection; encryption does
not provide capture authenticity or signed courier identity.

Unlock checks strict field allowlists, size/count/MIME/filename constraints,
duplicate targets, every file hash, origin, and issued/expiry times before exposing
files. Imported archives are capped at 40 MiB; ciphertext at 30 MiB. Invalid,
expired, wrong-passphrase or tampered imports leave the prior package unchanged.
Package expiry uses the device clock and is not trusted server time. An unlocked
package locks on expiry, explicit lock, identity change, disconnect, or unmount.
Pending cryptographic operations cannot restore plaintext or save a package after
that lock. The encrypted saved copy persists across disconnect and expiry until
explicit deletion or replacement. Browser eviction and lost passphrases cannot
be recovered; users may export an encrypted backup.

Export creates a .fdmedia file containing only the encrypted record and requires
a valid passphrase and unexpired package. A courier can transport it using ordinary
file sharing or removable storage; share its passphrase separately. Import works
on the same origin, validates completely before replacing storage, and uploads
nothing. This is a file relay, not radio transport or a delegated courier account.
The recipient must reconnect as the original collector, unlock again after identity
change, explicitly add files to the queue, then explicitly upload. R2 rechecks
live ownership, source definition, expected missing attachment and current grants.
The package grants no authority, has no server upload IDs, and cannot overwrite
an existing native attachment through the companion API. Saved priorities and
bytes enter the existing resumable foreground queue. A completed transfer does
not automatically delete the encrypted backup. Removing the backup does not
delete any server attachment. Browser file access to Collect still requires
export or a supported Android file provider; native Collect protocol is unchanged.

Remaining: persistent XML queues, background sync, delegated signed custody
handoffs, automatic courier transport, larger/streaming packages, server-clock
expiry, and actual Android/Collect/removable-storage acceptance.

Verification covers exact bytes and priorities, fresh encryption parameters,
maximum-size roundtrip, strict manifests, duplicates, tampering, wrong passphrases,
origin and expiry, encrypted-only persistence, import/export/reload, explicit upload,
revoked access, cancellation during cryptography, 320px layout and production
service-worker offline reload without private content entering Cache Storage.
