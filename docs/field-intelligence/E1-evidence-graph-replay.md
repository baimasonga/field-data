# E1: source-linked evidence graph and replay

This slice projects one pinned claim version, its evidence links, derivation
metadata, stored-byte verifications and review decisions into a queryable graph
and ordered timeline. It does not assert physical presence or reconstruct an
unrecorded capture session. Backcheck responses, assets and sensor challenges are
outside this version-scoped projection and remain separate workflows.

`GET /v1/field-data/claim-versions/:claimVersionId/graph` requires current
submission-read permission on the source form; inaccessible or deleted sources
return 404. Authorized inspections are audited with the claim ID and completeness
only. Responses are private/no-store. Stable typed node IDs and link IDs
preserve citations. Edges always reference returned nodes. Review snapshots are
historical assessments, separate from current evidence integrity.

Read at most 501 links, derivations and decisions per category. Return the first
500 with explicit completeness flags. Hash original XML/local media only up to
2 MiB each within an 8 MiB inspection budget; larger, over-budget or unavailable
bytes are unverified. Object-store verification
is a dated observation, not proof that remote bytes still match today. Raw media,
derivation outputs, device identifiers and raw audit details are not returned.

Replay separates reported capture time from server receipt and processing times.
Unknown times remain unknown; timestamp sorting does not imply causality or a
trusted device clock. Link supersession and decision predecessor edges are
included only when both endpoints are in the projection. Missing predecessors
are reported as incomplete lineage. No score or calibrated probability exists.

The browser loads this projection on demand, offers retry/refresh, and renders
nodes, relationships and a timeline as keyboard-accessible text. Stale responses
must not cross claim or component lifetimes. All untrusted content is escaped.

Acceptance: API permission/deletion checks, altered bytes, missing media,
contradiction and supersession, review snapshots, bounded output, unknown times,
stable repeat reads; browser load/retry, safe rendering and narrow viewport.
This read-only feature needs no migration and rolls back by removing the route
and browser component. Pilot reviewers must trace an original and correction to
their source and distinguish integrity from presence before external acceptance.
The full evidence/trust gate still needs real Collect offline capture, challenge,
sensor/witness and adversarial device tests.

Local validation: 41 field-data API tests, 1,621 server unit tests (one existing
pending), 62 hardening checks and 59 browser tests pass. Changed-file server,
client and browser-test lint and the production client build pass. No schema
change is required. Required CI and the reviewer pilot remain separate gates.
