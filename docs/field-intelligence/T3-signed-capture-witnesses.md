# T3: signed witness statements for challenged photos

Submission details → Capture challenges → Witness statements lets an authorized
web User describe personal observations and limitations, confirm review of the
original image, then explicitly sign and submit. The ES256/P-256 signature covers
a versioned purpose, challenge UUID, project, submission definition, form/root
instance, attachment name, visible code, exact image SHA-256, authenticated witness
actor ID, request UUID, signing timestamp and statement. The browser generates a
nonextractable private key in memory for this statement; only its public key and
signature are sent. No private key or credential is persisted or exported.

The server reconstructs the exact expected UTF-8 JSON payload and verifies its
IEEE P1363 signature before committing. The authenticated account and immutable
name snapshot are recorded separately with a server receipt timestamp. Signing
requires a current web User with submission.read and submission.update, distinct
from the collector actor. This is distinct-account witnessing: one human can
control multiple accounts, and a project administrator can create App Users. It
is not proof of independent people or physical presence. App Users cannot sign
this slice; fieldworker witness onboarding and delegated witness roles remain
future work.

Each account can record one immutable statement per challenge, with ten witnesses
maximum. Statements contain 10–2,000 trimmed characters. New signatures must be
within ten minutes of server time; this limits delayed submissions and is not
capture-time proof. Complete retries reuse the same signed envelope and request
UUID, even after image replacement or expiry, after current authorization is
rechecked. Altered envelopes under the same request ID are rejected. Browser
refresh clears unsigned drafts and retry state; a lost response can be recovered
from history. The original T3 slice did not allow amendments or withdrawal.
[T5](T5-witness-corrections-withdrawals.md) now adds signed corrections and terminal
withdrawal while retaining the original. Signatures are never consensus or proof
of scene truth.

Transactions lock the live inherited write grant and actor, source submission and
project, attachment, then challenge in native upload order. New statements require
an unarchived project, current submission definition, unchanged bound attachment
and a complete recheck of stored image bytes. Replacement or supersession disables
signing and marks existing statements as referring to an earlier image/version.
History remains readable under submission.read, including for viewers; deleted
sources are inaccessible. Original bytes are retained by the existing challenge
reference. A tampered stored envelope fails browser signature verification rather
than displaying a verified badge. Signatures never automatically approve a claim
or change Central's review state.

Each signed statement can be downloaded as JSON. Independent verification:

```sh
node cloudflare/verify-capture-witness.mjs witness-UUID.json EXPECTED_IMAGE_SHA256
```

The image hash argument is optional, but supplying a separately obtained expected
hash checks image correspondence. The included public key is self-generated, not
a certified identity key. Offline signature verification establishes integrity
relative to that key, not authenticated account attribution. Trusting the account
association and name requires the authenticated server record; the export does
not include a server-signed account certificate. Signing timestamps are supplied
by the browser; receipt timestamps are recorded by the server. Neither certifies
scene truth, capture location, device provenance or physical presence.

Verification covers real PostgreSQL signature checks, tampering, scope isolation,
permissions and revocation, retries, account quotas, byte corruption, archived
projects, image replacement, supersession and replacement races. Browser tests
use actual Web Crypto, reject tampered signatures, replay identical envelopes,
verify exports in Node and check the layout at 320 pixels. The standalone verifier
has an enforced CI test. Real-device/field acceptance remains pending.

[T4](T4-device-reported-capture-location.md) adds optional device-reported location
context to the challenged image. It remains an unverified client assertion and is
not covered by a certified witness identity or hardware-backed sensor signature.

T5 also extends JSON downloads and the standalone verifier with signed lifecycle
history. A legacy export without that history establishes only its original
signature, with unknown active status. Even a verified history requires a current
authenticated server read to establish that no later event has been omitted.
