# O5: backcheck agreement by collector and question

Status: next slice chosen under the project owner's delegated authority
("continue", 2026-10-10); details open to revision.

A linked backcheck can already be compared with the submission it revisits,
one at a time, on the Verification page. A supervisor cannot see the pattern:
which collectors' answers keep differing from the revisit, and which questions
differ whatever the collector (a sign of a hard or ambiguous question rather
than of a collector). O5 adds up the existing comparisons for a form. It is
the "estimates from backcheck results" item left open by O3, first slice:
counts and shares, not calibrated estimates.

## What is counted

- **Backchecks**: every linked backcheck of a submission of the form (most
  recent 500 by link time), whose original submission and response are not
  deleted. Each is compared exactly as its comparison view does: the latest
  field mapping when one was saved or the response form is another form,
  otherwise question by question.
- **Questions compared**: in a comparison by question, only questions the
  form version of the original actually asks (not calculations, hidden or
  automatically recorded values such as start and end times, nor metadata).
  In a mapped comparison, the mapped pairs.
- **A field** is one question of one backcheck (a repeated question counts
  once per repeat). It **agrees** when both answers are the same text,
  **differs** when both are present and not the same, and is **missing** when
  either side has no answer. Missing fields are counted but not in the share.
- **Not compared**: backchecks whose source failed the integrity check or is
  too large, whose response is another form with no field mapping saved yet,
  or whose form version could not be read (counted by reason), and
  backchecks whose response form the caller may not read (counted).

## What is reported

`GET /v1/projects/:projectId/forms/:xmlFormId/backcheck-agreement`
(`submission.read` on the form):

- totals: linked, compared, not compared by reason, not readable, and
  whether only the most recent 500 were used;
- **by collector** (the original submitter): backchecks compared, backchecks
  with at least one differing field, fields compared, fields differing,
  fields missing; ordered by share of backchecks with a difference, then
  name;
- **by question**: label (the form's default label, or the mapping label),
  fields compared, differing, missing; ordered by share differing.

No answers are returned, only counts.

## UI

Verification page, after the random backcheck sample: "Backcheck agreement",
both tables, each share shown with its counts ("2 of 5 backchecks"), and the
note that a difference is a reason to look, not a verdict: answers can change
between visits, and a few backchecks say little.

## Not in this slice

Confidence intervals or error-rate estimates, weighting by sample design,
tolerance for numbers or dates, per-backchecker agreement, export.

## Acceptance

- Unit: aggregation (agree, differ, missing; repeats; shares and order; mapped
  labels).
- Integration: same-form and other-form backchecks with and without a
  mapping; only asked questions compared (not start, end, calculations);
  integrity failure and deleted sources; unreadable response form; limit;
  permissions; no answers in the response.
- Browser: both tables with counts; empty state; failure and retry.
