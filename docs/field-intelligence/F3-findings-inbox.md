# F3: project findings inbox

Status: contract decided 2026-10-10 under the project owner's delegated
authority (the owner was away and asked for the work to continue); the
decisions below follow the recommendations given for earlier slices and can
be revisited.

The integrity checks (travel, G1 location, F1 contradictions, F2 identity)
write findings per form, and a reviewer reads them on each form's
Verification page. A project with ten forms means ten pages to visit. F3 adds
one project-wide list of findings across the forms a person may review, so
that the checks are usable at project scale. It adds no detection, no score
and no ranking of collectors.

## What it shows

A **Findings across the project** section on the Review page (beside the
re-verification queue, for the project chosen there), listing findings from
every form in the project the person may read:

- Each row: form, check (travel, location accuracy, outside area, repeated
  location, contradiction rule title, repeated identity or changed details
  with the key title), outcome (worth a look, could not tell, no longer
  found), status (not yet reviewed, being looked into, reviewed), submission
  (link), related submission (link), found at, and the decision and note when
  resolved.
- Filters: form, check family (`travel`, `location`, `contradiction`,
  `identity`), status (default: not yet reviewed and being looked into),
  outcome (default: excludes withdrawn).
- Counts at the top: open findings by check family and by form, as current
  counts (not a performance measure).
- Each row links to the form's Verification page, the submission and the
  related submission.
- Ordered as on the Verification page: concerns first, open before
  investigating before resolved, newest first. Pages of 50 with a cursor.
- A row links to the form's Verification page, where the evidence is shown in
  full and the finding is resolved. Identity findings in the inbox do **not**
  show answers (decision 2).

## API

`GET /v1/projects/:projectId/findings` with `xmlFormId`, `family`, `status`
(repeatable; default open and investigating), `outcome` (repeatable; default
concern and inconclusive) and `cursor`. Pages of 50. Returns
`{ items, nextCursor }`; items carry the rule's or key's title and an identity
finding's kind, never other evidence.

`GET /v1/projects/:projectId/findings/summary`: open counts by family and by
form (forms with none omitted).

Permissions: the caller needs `project.read`; a form's findings are included
only when the caller has both `submission.list` and `submission.read` on it,
the same rule as the per-form findings list. Forms the caller cannot read are
excluded from items and counts alike (not hidden after paging, so pages are
full). A Data Collector, who can see the project but not its submissions,
gets an empty list. App Users and people without a role get 403; unknown
projects 404.
Deleted forms are excluded.

Invalid filter values and cursors are refused (400.8) rather than ignored.

## Decisions (made under delegated authority)

1. **Read and link, not resolve, in the inbox.** Resolving stays on the
   Verification page, where the full evidence is. Recommended because a
   decision without the evidence on screen is a worse decision.
2. **No answers in the inbox.** Identity findings show their key title and
   links; answers are read live only on the Verification page (F2's rule that
   answers are shown beside the evidence that justifies reading them).
3. **Default filter: open and investigating, withdrawn excluded.** Resolved
   and withdrawn are one click away.

## Not in this slice

Assigning findings to people, bulk resolution, notifications, investigation
records grouping several findings (planned with investigation records), any
score or ranking.

## Acceptance

- Findings from several forms of all four families appear with the right
  labels, filters and counts; a second project's findings never appear.
- Access is resolved per form before querying, so pages are full and counts
  match. (Project roles in ODK apply to all forms of a project, so per-form
  differences arise only for roles introduced later; the rule is in place.)
- Withdrawn and resolved findings are excluded by default and included on
  request; cursor paging is stable while new findings are added.
- Bad filters 400; App Users 403; other projects 404.
- Browser: the page lists, filters, pages and links to the Verification page;
  narrow width.

## Validation evidence

Locally, against real PostgreSQL 16:

- Integration: 4 tests (`test/integration/api/field-data-findings.js`): all
  four families across two forms, labelled, without evidence or answers (a
  contradiction's answer and another project's finding checked absent);
  default, status, outcome, family and form filters; bad filters and cursors
  400.8; 120 findings paged in three pages with a finding added between pages
  not shifting the next page; summary counts by family and form; viewer
  access, no-role 403, App User 403, anonymous 401, unknown project 404.
- Browser: 2 tests in `e2e-tests/tests/field-data-review.spec.js`: counts,
  labels, links to the Verification page and submissions, the "Show", check
  and form filters sending the right query, empty state, paging, a failed load
  retried, narrow width. The page's other 37 tests still pass.
