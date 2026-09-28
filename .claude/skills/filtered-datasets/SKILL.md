---
name: filtered-datasets
description: Build saved, shareable subsets of a form — chosen columns plus row filters — in the Field Data repo, the feature Ona calls a filtered dataset or dataview. Use this whenever someone wants to share part of a form's data without sharing all of it, hide sensitive fields like names or phone numbers from a partner, give somebody only their own district's or region's rows, save a named view or slice of submissions, or asks for "filtered dataset", "data view", "dataview", or "a subset of this form". Read it before designing the schema or the filter language, because the central constraint (ODK stores submissions as XML, not columns) changes the design.
---

# Filtered datasets

A filtered dataset is a saved answer to "show them this much and no more":
a named subset of one form, defined by which columns it exposes and which
rows it keeps. It is the feature that unblocks sharing, because today the
only options are handing over the whole form or exporting a spreadsheet by
hand and hoping nobody forgot to delete the name column.

Read `.claude/skills/ona-parity/references/house-style.md` first for how features are wired
here, and the DataViews section of `.claude/skills/ona-parity/references/feature-inventory.md`
for the shape Ona settled on.

## The constraint that shapes everything

**ODK does not store submissions in columns.** A submission is an XML
document in `submission_defs.xml`. There is no `district` column to filter
on; there is an XPath into a document, and `form_fields` tells you which
paths exist and what type each was declared as.

So a filter is not a SQL predicate over a column. It is: extract a value at
a path with `xpath()`, then compare. The existing summary endpoint in
`central/server/lib/resources/field-data.js` already does this extraction —
read `summarizeForm` before writing any new SQL, and carry over its two hard
lessons, both of which are load-bearing:

- **Paths are user input.** They come from uploaded forms and are about to be
  concatenated into an XPath expression. The existing code allows only
  `^(/[A-Za-z_][A-Za-z0-9_.-]*)+$` and *skips* anything else rather than
  escaping it. Do the same. Never build a path from what the client sent;
  look the path up in `form_fields` for that form and use the stored value.
- **Postgres has no try-cast.** One submission whose body will not parse as
  XML takes down the whole query. In the summary endpoint that costs only the
  answer charts. In a filtered dataset it would cost the entire feature, so
  decide deliberately what a malformed submission should do — the honest
  default is to exclude it and report how many were excluded, never to
  silently drop it.

Comparisons have the same problem one level down. `xpath()` returns text, so
`hh_size > 4` needs a numeric cast, and a cast fails on the one submission
where somebody typed "four". Cast defensively, using the declared type from
`form_fields` to choose the comparison, and treat a value that will not cast
as not-matching rather than as an error.

## Schema

```
field_data_filtered_datasets
  id, name, "projectId", "formId",
  columns   jsonb   -- array of field paths, validated against form_fields
  query     jsonb   -- array of {column, filter, value, condition}
  "createdBy", "createdAt"
```

Store paths, not display names: a form can be updated and a label can change,
but the path is what addresses the data.

## The filter language

Copy Ona's shape, which is deliberately small:

```json
[
  {"column": "/data/district", "filter": "=", "value": "bombali"},
  {"column": "/data/hh_size",  "filter": ">", "value": "4", "condition": "AND"}
]
```

Operators: `=`, `<>`, `>`, `<`, `>=`, `<=`. `condition` is `AND` or `OR`,
defaulting to AND. Map the operator through a lookup table so the string from
the client never reaches SQL; parameterise every value through slonik.

Resist extending this. The moment it grows parentheses, `OR` precedence and
nested groups, it is a query language with no parser, no tests and no error
messages. If somebody needs that, they need an export and a real tool. Say so
rather than growing the feature.

## Authorization, which is the whole point and the main risk

The feature exists so that somebody who may **not** see the form can see a
slice of it. That inverts the usual check, and getting it wrong defeats the
feature silently rather than loudly.

- Creating or editing a filtered dataset requires permission on the **form**,
  because it decides what gets exposed.
- Reading a filtered dataset's data requires permission on the **dataset's
  project**, which may not be the form's project. That is what makes it
  shareable.
- The read path must never fall back to a form-level check, and must never
  return a column outside `columns` — not in the data, not in an export, not
  in a chart, not in an error message, not in a `count` that varies with a
  hidden field.

Write a test that asserts a reader with dataset access and no form access
gets exactly the declared columns. That test is the feature's real contract;
everything else is plumbing.

### Revocation is the half that gets forgotten

Ask who can *end* a share before you write the delete, because the obvious
answer is wrong. Requiring both sides to agree sounds symmetrical with
creation and is not: it leaves a form's administrator unable to stop their own
form being served into a project they hold no rights in, with nothing left but
deleting or unpublishing the form.

Deleting only ever takes access away, so it cannot be used to reach anything.
Let **either** side do it. Editing is different -- an edit can widen a share as
easily as narrow it -- so keep that requiring both.

Two things that are part of revocation and do not look like it:

- **A share you cannot see is a share you cannot end.** The destination
  project's own list needs rights there, so the shares that most need ending
  are exactly the ones invisible from the source. Give the source form a
  listing of every dataset built on it, keyed on the form and not on a
  project, and show it on the form.
- **Let the source side read the definition.** You cannot decide whether to
  revoke without seeing which columns and which rows are handed over, and the
  form's administrator can already read every one of those values at the
  source, so withholding it protects nothing.

Return `notFound` rather than a refusal to somebody with a stake in neither
side, or the route becomes a way to test which dataset ids exist.

One consequence to state plainly rather than design around: the read path does
not re-check the source, so if the destination project's membership widens
later, the new members get the rows. That is the feature working -- they were
given the project, not the form -- but it means the source side's control is
watching and revoking, not the permission system refusing. Say so in the
interface, next to the button, rather than leaving somebody to work it out.

## Endpoints

Mirror what a form already offers, so anything built on forms works here:

```
POST   /projects/:projectId/filtered-datasets
GET    /projects/:projectId/filtered-datasets
GET    /projects/:projectId/filtered-datasets/:id
PATCH  /projects/:projectId/filtered-datasets/:id
DELETE /projects/:projectId/filtered-datasets/:id
GET    /projects/:projectId/filtered-datasets/:id/data?offset=&limit=

GET    /projects/:projectId/forms/:xmlFormId/filtered-datasets
```

That last one is the source side's view: every dataset built on this form,
wherever it serves. It takes `form.update`, the same right that authorises
creating one, because anything weaker is a way to learn which projects hold a
given form's data.

Paginate `data` from the first commit. Photos already paginates and is the
example to copy; evidence and integrity do not, and are the reason this note
exists.

## Client

Six edits, per the house-style reference. The page worth building is a list
of a form's saved datasets plus an editor, reachable as a form tab. In the
editor, show the reader what they are about to expose: the chosen columns and
a live count of matching rows. A filtered dataset that says "412 rows, 5 of
28 fields" before it is saved is one somebody can check; a form full of
checkboxes is one they will get wrong.

## Verifying

- Unit-test the filter compiler as a pure function — filters in, SQL fragment
  and parameters out — the way `util/fieldwork-integrity.js` is tested. This
  is where injection and cast bugs live, and they are cheap to catch here.
- Test the authorization contract above.
- Render the editor at 1440 and 390 against a canned server and look at it.
- Then say plainly what has and has not run against real submissions.
