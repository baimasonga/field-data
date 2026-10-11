# K4: reversible asset merges and splits

Status: approved by the project owner on 2026-10-11 ("go ahead", after being
told it changes fact selection and task generation); details decided under
their delegated authority and open to revision.

Asset identities are registered by hand (K1), so mistakes happen both ways:
the same water point registered twice under two external IDs (its facts are
split across two passports, and the stale copy keeps generating
re-verification tasks), or one record covering two physical things (one pump
house, two pumps). K4 corrects both without rewriting history: it is the
"correction/merge/split history" deliverable of the knowledge row, first
slice.

## Principles

- **Observations are never changed.** They stay append-only, with the asset
  they were recorded against. A merge or split is an **operation** that says
  which asset each affected observation now belongs to; every reader (passport,
  status table, search, re-verification) uses the same resolution, a database
  view.
- **Every operation can be undone**, with a reason. Undoing restores the
  previous ownership exactly; the operation and its undoing stay in the
  history. Only the most recent active operation involving an asset can be
  undone, so undoing never leaves a later operation resting on a reversed one.
- **Only project managers** (`project.update`, and submission access to the
  forms involved) can merge, split or undo.

## Merge

Merging asset B **into** asset A (same project, both active, A ≠ B):

- every observation currently belonging to B now belongs to A;
- B becomes **merged** (into A): it is left out of the asset list, status
  table and search, its passport says where it went, and it accepts no new
  observations (409);
- A's current facts are chosen from all its observations, B's included, by the
  usual rule (latest valid-from; then latest recorded; then sequence).

## Split

Splitting chosen observations **out of** asset A into a **new** asset C (name,
type, external ID, as for a registration):

- the chosen observations (at least one, not all of A's) now belong to C;
- A keeps the rest. Each passport shows its own facts.
- Undoing a split folds C back into A (C becomes merged into A); it is
  refused once observations have been recorded against C itself.

## Re-verification

After an operation and after undoing it, re-verification is recomputed for the
assets involved, as the expiry worker would: a queued task whose observation is
no longer an asset's current fact for that predicate is superseded; a newly
current, expired fact gets a task, and a task superseded earlier whose
observation is current again (after an undo) is queued again. Dispatched
tasks continue; a task can be closed by a fresh observation of the asset its
observation now belongs to (newer by recorded time, as sequences are counted
per asset).

## API

Under `/v1/field-data/projects/:projectId/assets`:

- `POST /:assetId/merge { requestId, mergedAssetId, reason }`, with
  `If-Match` on A (the asset kept);
- `POST /:assetId/split { requestId, observationIds, name, assetType,
  externalId, reason }`, with `If-Match` on A;
- `GET /:assetId/operations`: operations involving the asset, newest first;
- `POST /operations/:operationId/undo { reason }`.

Each change bumps the revision of every asset involved. Invalid input: 400;
stale revision: 412; an asset already merged, a duplicate external ID, or an
operation that is not the latest active one: 409.

## UI

Asset passport (Review page): "Merge another asset into this one" (choose by
external ID, with a reason), "Split observations into a new asset" (tick
observations, name the new asset, give a reason), and an "Identity history"
list with "Undo" on the operation that can be undone. A merged asset's passport
says which asset it was merged into, with a link.

## Not in this slice

Suggested duplicates (entity resolution), merging across projects, editing an
asset's name or external ID, bulk operations.

## Acceptance

- Integration: merge moves current facts and history; merged asset refused
  for new observations and left out of list, status table and search;
  re-verification superseded and generated as current facts change; split;
  undo of each restoring the previous facts exactly; only the latest operation
  undone; stale revision, duplicate external ID, wrong state; permissions;
  operations and reassignments append-only in the database; migration and
  rollback.
- Browser: merge, split and undo from the passport; merged asset's notice.
