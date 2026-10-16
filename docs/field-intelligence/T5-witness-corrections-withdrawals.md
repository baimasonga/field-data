# T5: signed witness corrections and withdrawals

An original witness may correct or withdraw a T3 statement without rewriting its
signed bytes. This extends the Evidence and Trust area. It does not certify
identity, independence of people, physical presence or the truth of a claim.

## Signed history and effective state

The original statement remains in `field_data_capture_witnesses`. New ES256/P-256
envelopes are appended to `field_data_capture_witness_events`. Each envelope binds
the original challenge/image/account scope, witness record UUID, original payload
SHA-256, next sequence, preceding payload SHA-256, request UUID, signing timestamp,
action, replacement statement and reason. Corrections require a trimmed 10–2,000
character statement; withdrawal requires a null statement. Both require a trimmed
10–2,000 character reason. New signatures have the existing ten-minute clock
window; identical authorized retries can be recovered later.

Corrections replace the effective statement, not the original. Withdrawal is
terminal. An identical earlier correction retry after withdrawal returns current
withdrawn history and cannot reactivate it. Twenty corrections are permitted,
with a reserved twenty-first slot for withdrawal. Original account/challenge
quotas are never released by withdrawing a statement.

The browser generates a fresh nonextractable, memory-only private key for each
change and retains only the signed envelope for retry. As in T3, public keys are
self-generated. Attribution to the same authenticated account is enforced by the
server; the new key does not prove certified identity continuity with the old key.

## API and authorization

The existing witness-list endpoint returns original envelopes with ordered signed
`events`, `revision`, `status` (`active` or `withdrawn`), and a next `changeContext`
only for the owning web account with current read/update rights. `canCorrect`
also accounts for ownership, permissions, state and quota. `activeCount` counts
non-withdrawn statements only when the original image/submission binding remains
current. It is not an agreement score or count of supporting votes.

`POST .../capture-challenges/:challengeId/witnesses/:witnessRecordId/events`
accepts `{ requestId, signedAt, action, statement, reason, payload, publicKey,
signature }`. The server reconstructs and verifies the exact expected payload.
Unknown fields, altered signatures/context, wrong sequence and changed retry
envelopes are rejected (400). Terminal withdrawal or exhausted correction quota
is a conflict (409.48). Other accounts, App Users, revoked grants and inaccessible
or deleted sources cannot change the record (404 under the existing scope policy).

The server locks the current inherited write grant and actor, source, attachment,
challenge and witness in the existing upload lock order. Identical concurrent
requests replay one event; competing changes cannot overwrite one another. Each
new event and its audit commit together. Correcting or withdrawing a historical
statement is allowed after image replacement, submission supersession or project
archival, while current permissions still apply. It never makes an earlier image
current or automatically changes a review decision.

## Review and export workflow

Submission details → Capture challenges → Witness statements shows the effective
statement, active/withdrawn/historical status, original statement and verified
change history. Only its owner receives correction/withdrawal controls. A lost
response is retried with the same signed envelope; altered retry text requires
refreshing history. Every change signature and chain link is verified before any
statement is displayed as active. Legacy responses without lifecycle history are
shown with unknown active status.

JSON downloads contain the original envelope and all included change envelopes.
`node cloudflare/verify-capture-witness.mjs FILE [EXPECTED_IMAGE_SHA256]` verifies
both and reports the state at the last included event. It rejects tampering,
reordering, missing intermediate events, transplantation and events after
withdrawal. Old exports without change history establish only the original
signature, with unknown active status. An offline verifier cannot prove that a
later event was not omitted: current history and account/name attribution require
the authenticated server record. Neither export nor signature certifies scene truth.

## Storage and validation

The additive migration protects originals and events against direct update/delete.
It permits the existing actor foreign-key anonymization and cascading source purge
policy; it does not create a new retention policy. Rollback preserves signed
history once changes exist. No core Central columns are added.

Real PostgreSQL tests cover correction/withdrawal, stale and altered signatures,
permission revocation, ownership, image replacement, archival, terminal state,
identical/competing requests, quotas, immutable rows, cascade purge and rollback.
Browser tests use real Web Crypto, interrupted-request recovery, viewer history,
tampered changes, independent Node export verification and a 320-pixel layout.
The standalone verifier's enforced CI suite covers legacy and lifecycle exports.

Delegated witnessing, certified key revocation, sensor/hardware corroboration and
real-device acceptance remain separate work in the eight-area programme.
