# O4: backcheck workload in the request form

Status: the project owner listed this slice and asked for the work to
continue; details decided under their delegated authority and open to
revision.

When a reviewer requests a backcheck, the form lists every App User who can
submit the response form, in alphabetical order, with nothing to say who is
already busy, and including the submission's original collector (whom the
request then refuses). Over a busy round, the same few collectors get every
revisit. O4 shows each candidate's current backcheck workload and suggests the
least loaded one. It is the "workload balancing" deliverable of the operations
row, first slice, for backchecks.

## What it does

- The two lists the request form uses (`…/backcheck-forms` and
  `…/backcheck-assignees`) give each App User, in the same order as before:
  - `pending`: their open (requested) backchecks;
  - `overdue`: open ones past their due date;
  - `linkedRecently`: backchecks they linked in the last 30 days;
  - `original`: whether they collected the submission being checked;
  - `suggested`: true for exactly one App User, when there is one to suggest.
- **The suggestion**: never the original collector; otherwise the fewest open
  backchecks, then fewest overdue, then fewest linked in the last 30 days,
  then by name and ID. It is a suggestion: the reviewer can choose anyone
  eligible, and the request route's rules are unchanged.
- **The request form** shows each App User's open and overdue counts, marks
  the original collector as unavailable ("collected this submission"),
  preselects the suggestion, and preselects again when the response form
  changes.

## Not in this slice

Balancing by distance or area, capacity limits per collector, automatic
assignment, balancing re-verification visits or sampled backchecks in bulk.

## Acceptance

- Unit: suggestion order and ties; the original collector never suggested;
  nobody to suggest.
- Integration: real backchecks give the counts (open, overdue, and a due date
  removed); the original collector marked; the suggestion in both lists.
- Browser: counts and suggestion shown; original collector disabled; the
  suggestion follows the chosen form; the request carries the chosen App
  User.
