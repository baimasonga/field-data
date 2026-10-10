# R1: receipt and custody ledger

Status: the project owner chose this slice on 2026-10-10 ("1"); the details
below are decided under their delegated authority and open to revision.

A collector who uploads an interview, from a village with intermittent
signal, has no record of what the server actually received. A supervisor has
no way to show later that a stored submission is the one that arrived, or
that no receipt was quietly removed. P0.1 records a hash of each submission
version; R1 turns those into an **append-only, hash-chained receipt ledger**
per project, gives collectors their own receipts, and lets a manager verify
the whole chain. It is the "receipt/custody ledger" deliverable of the
offline-resilience row, first slice.

## The ledger

- **One receipt per submission version** received by the server (a first
  upload or an edit), written in the same transaction by a database trigger
  on the provenance row, so no code path can store a submission without a
  receipt.
- **Per project, in order**: sequence number 1, 2, 3, …; a project-level
  transaction lock serialises appends: an upload to a project waits for any
  other upload to that project in progress to commit (uploads are short;
  tested with parallel uploads).
- **Each receipt** holds: sequence, form ID, instance ID, submitter (actor
  ID), receipt time (as the exact text hashed), the SHA-256 of the submission
  XML as received, the previous receipt's hash, and its own hash.
- **Receipt hash** = SHA-256 over the fields above in a fixed order, each
  written as `<byte length>:<value>` (so no value can be confused with
  another), prefixed by the format name `receipt@1`. The first receipt's
  previous hash is 64 zeros. Anyone with the receipts can recompute it.
- **Append-only**: the database refuses to change or delete a receipt. When a
  submission or form is purged, its receipt stays, without the link.
- **Existing submissions** are given receipts when the migration runs, in the
  order they were received, marked as backfilled (their content hash is the
  one P0.1 recorded).

## Verification (managers)

`GET /v1/projects/:projectId/receipts/verify` (`project.update`) walks the
chain and reports:

- **Chain**: every receipt's hash recomputed and linked to the one before;
  the first receipt where this fails is reported (altered or missing entry).
- **Content**: for each receipt whose submission version still exists, the
  stored XML is hashed again and compared with the hash at receipt; versions
  whose content no longer matches are listed (at most 50, with the count).
- **Purged**: receipts whose submission has since been purged (counted, not
  an error).
- The current head (sequence and hash).

## Signed head

`GET /v1/projects/:projectId/receipts/head` (`project.read`): the latest
sequence and hash. When the deployment has the offline signing key (O1,
ES256), the head is signed with it, bound to the configured origin, so a
copy kept outside the server can later show the ledger was not rewritten.
Without a key, the head is returned unsigned and says so.

## Collectors

`GET /v1/field-data/app-user/receipts` (App User token): the App User's own
50 latest receipts (form, instance ID, receipt time, content hash, receipt
hash and sequence) and the project head. The fieldwork page shows them under
"Received by the server", so a collector can confirm an upload arrived and
note its receipt.

## Not in this slice

Receipts signed one by one, device-side hashes compared with server ones,
relays and couriers, exporting the ledger, external anchoring of heads.

## Acceptance

- Unit: receipt hash (fixed vector, length-prefixed fields, Unicode);
  chain verification finding an altered receipt, a broken link and a gap.
- Integration: receipts for uploads and edits, in order, per project; the
  chain verifies; altering a submission's stored XML is reported as changed
  content; the database refuses to update or delete a receipt; a purged
  submission's receipt stays; signed head verifiable with the public key;
  App User sees only their own receipts; permissions; migration backfill and
  rollback.
- Browser: receipts on the fieldwork page.
