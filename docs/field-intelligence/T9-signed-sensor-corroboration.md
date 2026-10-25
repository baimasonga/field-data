# T9: signed external sensor corroboration

Managers open **Review → project → Open sensor key registry**. An external
sensor/operator supplies its public P-256 JWK. Enroll its label, operator label,
measurement type, expiry (one minute to 365 days), provisioning/independence review
note and explicit acknowledgment. Private keys stay with the operator: Central
neither generates nor requests them. The server signs an immutable project
trust-enrollment record. Labels/notes accompany source-readable exports, so the
form explains not to enter private credentials/document numbers.

Supported typed readings are proximity distance/uncertainty in metres (0–100,000),
WGS84 latitude/longitude/reported accuracy (up to 100,000 m), and named scalar
measurements with an explicit unit and finite value from −10¹² to 10¹². Types are
fixed per enrolled key. A key cannot be reenrolled, including after revocation or
expiry; rotation requires a fresh key. There are at most 100 active and 1,000
retained enrolled keys/project. History is paged in groups of 50. Retained revoked
or expired keys remain in signed history. Managers with current project access
can revoke a sensor key permanently, including on archived projects. New enrollment
is disabled on archives. Authority signing must be configured for all mutations.

**Submission → Capture challenges → Signed sensor corroboration** opens a lazy
source-scoped workspace. Download its challenge context, transfer it to the
external operator, then import the returned signed JSON envelope (up to 32 KiB).
The context binds project, challenge UUID, submission definition/form/instance,
attachment name, image SHA-256, hash of the server-issued nonce, and the server's
challenge window. The raw capture nonce is not disclosed. This is an explicit
file adapter protocol, not an automatic connection to unconfigured hardware.

An external Node adapter can use the repository SDK:

```js
import { signSensorReading } from './cloudflare/sensor-reading.mjs';
const envelope = signSensorReading(downloaded.context, {
  deviceId: enrolledDeviceId,
  readingId: uniqueReadingUuid,
  counter: deviceCounter,
  sampledAt: sensorReportedIsoTime,
  measurement: { kind: 'proximity', distanceM: measuredDistance, uncertaintyM: reportedUncertainty }
}, operatorPrivateKey);
```

Signing uses ES256/P-256 and canonical ordered JSON with versioned purpose
`field-data.sensor-reading@1`. The SDK normalizes context/measurement field order.
The server checks schema/size/range bounds, canonical base64url, signature against
the enrolled key, exact challenge/image context and enrolled measurement type.
Counters are positive 32-bit integers and reading identities are UUIDs; both are
unique per device. Previously unused out-of-order counters are allowed. A duplicate
identity/counter under another request is rejected. Exact interrupted retries
reuse the same request UUID/envelope and return the original record. Consumed
identities/counters remain as hash-only tombstones after source purge.

Sensor keys cannot double as retained witness keys or the current authority key.
Enrollment rejects retained/certified/revoked witness material, and witness writes
refuse enrolled sensor keys. These checks share the project witness lock with
registration, import, review and revocation, preventing enrollment/signing races.
This separates cryptographic key purposes, not physical people or devices: the
operator may still control multiple keys/accounts. Provisioning records and
independence declarations must be assessed outside the signature protocol.

Each accepted import receives a server-signed receipt binding record/device/
reading/counter, exact sensor payload/signature hashes, enrollment payload hash,
authenticated importer and server receipt time. The enrolled key must still be
unrevoked and unexpired at recording after the image-byte read. Imports require
current source read and submission-update permission, a live web account, an
unarchived project, current image/version binding and a complete stored-image hash
check. Read grants are locked while committing; collectors/App Users and viewers
do not gain mutation rights from possessing an envelope. An authority-origin
change requires fresh-key enrollment before more imports. Key rotation at the same
issuer is supported through historical trusted authority keys.

The workspace exposes explicit diagnostics for image/version replacement,
unverified/missing/corrupt source bytes, revoked sensor keys, expiry at receipt,
sensor time outside the challenge window, sensor time more than one minute ahead
of server receipt, and server receipt after the challenge window. Late/offline
imports are retained, but late or inconsistent timing withholds supporting
corroboration. Sensor clocks and accuracy remain assertions, not certified times
or surveyed coordinates. No automatic presence score, scene approval or claim
review decision is produced.

Readings start unreviewed. An authorized reviewer inspects the original image,
provenance, timing and reported uncertainty, then records supports/contradicts/
inconclusive with a reason. Supporting assessments require all current eligibility
checks. Inconclusive/contradicting assessments may retain clock/key limitations on
a current, integrity-checked image. Historical/replaced sources permit withdrawal
only. Withdrawal acknowledges the retained assessment without falsely recording
that unavailable original bytes were freshly inspected. A signed append-only
review ledger uses optimistic revisions and exact idempotent retries, with 20
ordinary revisions plus one final withdrawal. At most 20 readings are retained
per challenge. Current supporting counts exclude revoked/historical/unverified
readings and are explicitly not counts of independent people or presence scores.
Expired keys do not rewrite historical receipts made during their enrollment
window, but cannot produce new accepted imports.

Source GETs recheck permissions and image bytes. Key revocation or replacement
immediately withholds earlier supporting corroboration on refresh; signed history
is preserved. Readonly users see verified records, diagnostics and exports without
write controls. Scope changes/unmounts discard late responses. Invalid/tampered
signatures or receipts fail explicitly. The evidence graph now includes bounded
sensor metadata nodes, source links and separate sensor-reported/server-receipt
timeline events. That graph projection labels sensor integrity unverified and
continues to report presence as insufficient evidence; open the source proof for
cryptographic verification and current byte/key checks.

`cloudflare/sensor-reading.mjs` also exports `verifySensorRecord(record, expected)`.
Supply independently trusted authority `publicKeys`, the expected `issuer`, and the
exact expected `context`. It verifies enrollment, device signature, receipt binding,
review sequence and any supplied signed key revocation. Included issuer keys alone
do not establish trust. Retain old trusted issuer keys across rotation. A snapshot
without revocation establishes only that none was supplied; it cannot establish
absence of later revocations/reviews or current source access. An export contains
the signed enrollment, reading, receipt, reviews, revocation and source snapshot;
no private key is exported.

Registry and replay ledgers are append-only project records and survive source
purge and migration rollback. Source deletion removes sensor readings/reviews but
retains key/replay history, without copying measurement bodies into tombstones.
Project deletion removes its ledgers. Signed reviews never silently overwrite
prior assessments. Audit entries record identifiers/outcomes, not free-text notes
or raw measurement values. No external network service is contacted automatically.

Acceptance covers actual database import/review/revocation, source permissions,
byte corruption, archived projects, purpose/key separation, context/signature
mismatch, counter replay and reordering, clock diagnostics, optimistic revisions,
exact concurrent retries, graph projection, append-only guards and purge/rollback
retention. Browser tests use real Web Crypto and signed protocol fixtures for
registry/import, lost acknowledgments, reviews, independent exports, revocation,
read-only/access-loss boundaries and 320-pixel layout. These are software protocol
checks, not evidence of real sensor accuracy, calibration or hardware trust.
Physical adapter/device commissioning, anti-relay guarantees, clock/calibration
validation and independently demonstrated operator separation remain pilot work.
