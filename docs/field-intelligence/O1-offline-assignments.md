# O1: protected offline assignment snapshots

The companion page offers an explicitly saved, read-only snapshot of the newest
50 App User instructions. ODK Collect remains responsible for offline forms and
submission capture. This slice does not cache the application shell, upload
submissions, queue acknowledgments or implement a relay. Load the companion page
before losing connectivity; after an online reload the saved snapshot can still
be unlocked without storing or re-entering the App User credential.

`GET /v1/field-data/app-user/offline-assignments` uses the same live assignee and
form-assignment checks as the inbox. Disabled signing returns `enabled: false`.
Configured deployments issue an ES256/P-256 signed `offline-assignments@1`
envelope, audience-bound to the configured origin, with bundle ID, assignee,
project, issue/expiry times, completeness and instructions only. No original
answers, claim IDs, review history or bearer credential appear in the bundle.
Expiry is eight hours. Responses are private/no-store and issuance is audited.
The signed UTF-8 payload is limited to 256 KiB and the encrypted envelope to
512 KiB; oversized snapshots fail without a misleading saved state.

Set `FIELD_DATA_OFFLINE_SIGNING_KEY` to an operator-managed P-256 private PEM
and `FIELD_DATA_OFFLINE_ORIGIN` to the exact HTTPS site origin. HTTP localhost
is allowed only for development. Keep the key out of source control, logs and
browser storage. Missing or invalid configuration disables issuance. Preserve
key custody and rotate keys according to the deployment's security policy.

The client verifies signatures before saving or showing records. The authenticated
same-origin response establishes the signing-key trust pin. The entire envelope,
including that pin, is encrypted with AES-256-GCM using a separate user-chosen
passphrase (12–128 characters), PBKDF2-SHA256/600,000 iterations, random salt and
IV, and origin-bound authenticated data. IndexedDB stores one encrypted snapshot;
no App User key or passphrase persists. A wrong passphrase, corrupted ciphertext,
modified signature, wrong origin or expired package fails closed. Replacing the
snapshot requires another explicit save. Browser storage eviction can remove it.

Disconnect, navigation and observed credential revocation clear decrypted data.
An accepted live inbox refresh or observed revocation also deletes the saved
ciphertext, so revoked form instructions cannot be reopened after revalidation;
explicitly save a new snapshot after a refresh. Users can forget it at any time.
Offline revocation cannot be learned until reconnection. Expiry uses the
device clock, with issue-time skew checks, and cannot resist a malicious device
clock or compromised browser. The UI labels instructions as a stale snapshot,
does not allow acknowledgment or completion, and requires live access for action.

Acceptance: genuine Node/WebCrypto signature interoperability; authorization and
revocation; no credentials or plaintext in IndexedDB; reconnect/reload persistence;
wrong-passphrase, tamper, expiry and origin rejection; disconnect races; escaped
instructions and mobile layout. Deployment key configuration and a real Collect
device pilot remain external gates. No migration is required; removing the route
and component rolls back the feature. Forget local snapshots before retiring it.

Local validation: 42 field-data API tests, 1,621 server unit tests (one existing
pending), 62 hardening checks, 66 browser regression tests plus the unconfigured
signing test, and 14 focused fieldwork tests pass. Changed-file server, client and
browser-test lint and the production client build pass. Required CI must validate
the final commit; production signing configuration and real devices remain pending.
