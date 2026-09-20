---
name: merged-datasets
description: Combine several forms into one read-only dataset over the fields they share, in the Field Data repo — the feature Ona calls a merged dataset. Use this whenever someone wants to analyse or export several forms together, compare survey rounds, pool the same questionnaire run in different districts or by different partners, ask "how many submissions across all our forms", or asks for "merged dataset", "combine forms", "pool data" or "one table across forms". Read it before designing the merge, because which fields are shared is a harder question than it sounds and the wrong answer silently loses data.
---

# Merged datasets

A programme that runs the same questionnaire three times, or hands it to four
partners, ends up with several forms and one question: how did the whole
thing go? A merged dataset answers it by exposing the fields those forms have
in common as a single read-only table.

Read `.claude/skills/ona-parity/references/house-style.md` for wiring and the Merged
Datasets section of `.claude/skills/ona-parity/references/feature-inventory.md` for Ona's
shape. Note that Ona's own documentation calls the feature experimental —
that is a statement about how much subtlety hides in "have in common", not a
reason to avoid it.

## Read-only is a design decision, not a limitation

A merged dataset rejects submissions and edits. This is right and should be
enforced in the schema and the routes rather than left to convention: a row
in the merge belongs to one of the source forms, and letting somebody edit it
"through" the merge means deciding which form's validation applies, what
happens when the merge's field set does not include a required field, and
what the audit log should say. Every answer is worse than refusing.

Carry the source form on every row — Ona uses `_xform_id_string` — so a
reader can always tell where a row came from and go back to it.

## "Fields in common" is the whole problem

Two forms both have a `district` field. Are they the same field?

- **Same path, same type** — yes, merge them.
- **Same path, different type** (`string` in one, `int` in the other) — not
  the same field. Merging them means one side's values get coerced, and a
  coercion that fails on one row in a thousand produces a table that is
  quietly wrong. Exclude it and say why.
- **Same path, same type, different choice lists** — the hardest case. `1`
  meaning "yes" in one form and "male" in the other will merge without
  complaint and produce nonsense. You cannot detect intent, but you can
  detect *divergent choice lists for the same path* and warn.
- **Different path, obviously the same question** — do not guess. Field
  mapping is a feature somebody must do deliberately, not something to infer
  from labels.

So the merge is an intersection over `(path, type)` from `form_fields`, and
the interesting output is not just the merged field list but **what was left
out and why**. Return that. A merged dataset that says "18 fields merged, 4
excluded: `hh_income` differs in type, `consent` has divergent choice lists…"
is one somebody can trust. One that silently drops four fields is one that
will be presented to a donor.

## Schema

```
field_data_merged_datasets
  id, name, "projectId", "createdBy", "createdAt"

field_data_merged_dataset_forms
  "mergedDatasetId", "formId"          -- unique together
```

Compute the shared field set on read rather than storing it, or store it with
the form versions it was computed from. Forms get new drafts published; a
cached field list that does not know this goes stale and starts lying.

## Endpoints

```
POST   /projects/:projectId/merged-datasets
GET    /projects/:projectId/merged-datasets
GET    /projects/:projectId/merged-datasets/:id        -- includes fields[] and excluded[]
DELETE /projects/:projectId/merged-datasets/:id
GET    /projects/:projectId/merged-datasets/:id/data?offset=&limit=
```

Paginate `data` from the start; this is the endpoint most likely to be asked
for a hundred thousand rows.

Authorization is the union's floor, not its ceiling: require read permission
on **every** source form. Anything else turns the merge into a way to read a
form you were not given.

## Performance

A `UNION ALL` across N forms, each doing XPath extraction per field per
submission, is the slowest query this codebase will run. Before optimising,
measure. If it needs work, the shape that helps is extracting the shared
columns once into a materialised form rather than making the XPath faster.
Do not reach for that until a real dataset says you must.

## Verifying

The field-intersection logic is a pure function over two field lists —
unit-test it directly, including every case in the table above. Test that a
reader missing permission on one source form is refused. Render the creation
flow and check that the excluded-fields explanation is actually visible
rather than buried. Then say what has not run against real data.
