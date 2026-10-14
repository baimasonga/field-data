# R4: encrypted recovery of challenged camera photos

The companion upload queue now offers **Prepare queue for encrypted storage**.
It selects unfinished local files in the encrypted-media panel, preserving form,
submission root, filename, priority, challenge UUID/nonce, original issued/expiry
timestamps and optional device-reported location. The collector still supplies a
passphrase and explicitly presses Encrypt and save files. Preparation neither
writes storage nor uploads, and the previous saved package remains until a successful
explicit save. Access keys, upload session IDs and acknowledged offsets are excluded.

New archives use offline-media@2, with the complete file manifests and bytes inside
origin-bound AES-GCM ciphertext and the schema/origin authenticated as additional
data. Existing offline-media@1 archives remain decryptable using their original
header; version/header mismatches fail. The existing 10-file, 20 MiB combined,
24-hour storage and passphrase limits are unchanged. Strict validation rejects
partial challenge metadata, malformed UUID/nonces/timestamps, windows over twenty
minutes, non-image/over-5-MiB challenged files and malformed location context.

Reload → reconnect as the original collector → unlock → explicitly add files to
the queue → upload/resume now retains challenge and location metadata. Existing
server transfer lookup uses complete file hashes; server permissions, original
challenge scope, expiry, fingerprint checks and native attachment locks remain
authoritative. Ordinary file packages continue to work. File transport still does
not delegate upload authority to a courier or attest custody.

Package storage does not extend the twenty-minute capture challenge. An expired
challenge's bytes and metadata remain decryptable/exportable while the package is
within its 24-hour lifetime, but restoring a package containing any expired challenge
is refused with an explanation to start a fresh challenge/photo. No nonce is silently
stripped, no new deadline is invented and no successful challenged upload is implied.
Device-clock eligibility can be wrong; the server independently enforces expiry.
For a previously completed upload whose acknowledgement was lost, recover the bound
challenge or inspect submission evidence rather than creating another challenge for
the same bytes.

Lock, disconnect/session change and unmount clear selected/plaintext files and
passphrases while leaving the encrypted copy. Export/import use the same protected
format and preserve context after validation. Browser storage may be evicted, so
collectors should explicitly export a copy where appropriate. This is foreground
recovery of already synced XML's attachments, not native Collect queue changes,
background synchronization, radio relay or hardware-backed capture proof.

Validation covers real Web Crypto, encrypted metadata, legacy decryption, malformed
context, retained original expiry, browser reload/reconnect/restore/upload, denied
expired restoration, existing package workflows and mobile layout. Existing enforced
encrypted-media and browser CI gates include these tests. Real-device acceptance
remains pending.
