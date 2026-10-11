# K5: suggested duplicate assets

Status: next slice chosen under the project owner's delegated authority
("continue", 2026-10-11), following K4; details open to revision.

K4 lets a manager merge an asset registered twice, but finding the
duplicates is left to memory. K5 suggests pairs of assets that may be the same
physical thing, each with the reasons in words, and leaves the decision to a
person: it never merges anything. It is the "entity resolution" item left
open by K4, first slice: deterministic rules, no model, no score.

## Reasons a pair is suggested

Among a project's active assets the caller may see:

- **External IDs match apart from case, spaces and punctuation**
  (`WP-01` and `wp 01`).
- **Same name and type**, after the same normalisation (so "Kissy
  Water-Point" and "kissy waterpoint").
- **Similar names, same type**: names sharing at least 60% of their
  three-letter fragments, ignoring case, spaces and punctuation (so "Kissy
  water point" and "Kisy water point"), and with the same numbers in them:
  "Water point 1" and "Water point 2" are different assets.
- **Facts recorded from the same submission**: both assets have an
  observation citing the same claim version.

A pair can have several reasons; all are shown. Pairs are listed with the
strongest reason first (matching external IDs, then same submission, then
same name, then similar names), then by name.

## Dismissing

A manager (`project.update`) can dismiss a pair with a reason ("two wells on
the same compound"); it is no longer suggested. A dismissal can be withdrawn,
after which the pair is suggested again. Dismissals are kept (append-only,
apart from being withdrawn once).

## Limits

At most 2000 active assets are compared (the response says when there are
more) and at most 200 pairs are returned. The work is bounded too: reasons
are looked for strongest first, and the search stops once 2000 candidate
pairs are held or 500,000 name comparisons made (many assets sharing one
name, for example); the response then says the list is capped, and what it
lists are the strongest found. Numbers in names are compared in any script.

## API

- `GET /v1/field-data/projects/:projectId/assets/duplicates` (`project.read`,
  assets on forms the caller may read): `{ pairs: [{ a, b, reasons }],
  dismissed, truncated }`.
- `POST …/assets/duplicates/dismissals { assetIds: [a, b], reason }`
  (`project.update`) and `POST …/assets/duplicates/dismissals/:id/withdraw`.

## UI

Review page, after the asset status: "Possible duplicate assets": each pair
with its reasons, "Open" on either asset (the passport has Merge), and
"Not the same" with a reason for managers.

## Not in this slice

Location or photo comparison, fuzzy matching across types, learned
weights or scores, automatic merging.

## Acceptance

- Unit: normalisation, trigram similarity, each reason, ordering, limits.
- Integration: each reason on real assets; merged assets and unreadable
  forms left out; dismissal hides a pair and withdrawal brings it back;
  dismissals append-only; permissions.
- Browser: pairs with reasons, open, dismiss.
