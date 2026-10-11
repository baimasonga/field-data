# F7: investigation outcomes

Status: next slice chosen by the project owner ("focus on the features:
investigation outcomes, asset status by area, scheduled back-check samples",
2026-10-11); details open to revision.

F6 records investigations and how each one ended. F7 adds them up, so a
manager can see how investigations in a project have turned out: how many are
open, how they were closed, how long they took, which kinds of finding they
covered and which collectors' submissions they involved. It is the "metrics
over dispositions" deliverable left open by F6, in the fraud-intelligence row
(human disposition; false-positive evaluation).

## What is counted

From one project's investigations, at the time of the request:

- **Status**: open and closed investigations, and how many were ever reopened.
- **Dispositions**: closed investigations by their current disposition.
- **Time to close**: for closed investigations, the median and the longest
  number of whole days from opening to the latest closure.
- **By month**: closed investigations by the month (UTC) of their latest
  closure and by disposition, for the 12 months up to the current one.
- **By kind of finding**: findings in closed investigations, by the family of
  check that raised them (travel, location, contradiction, identity,
  similarity, other) and by disposition. A finding in several closed
  investigations is counted once, under the one closed most recently.
- **By collector**: for each collector whose submission is part of a finding
  in a closed investigation (both submissions of a pair finding), the number
  of distinct closed investigations by disposition. Submissions with no known
  submitter are counted as "unknown".

Kinds of finding and collectors are taken only from forms whose submissions
the caller may read; findings on other forms are counted in
`hiddenFindings` and left out of both tables. Status, dispositions, time to
close and months are over all the project's investigations (the caller may
already list them all).

## What the numbers are not

Counts and medians only: no rates, scores, rankings or estimates. People
choose which findings to investigate, so the share of a kind of finding that
ended as a confirmed issue is not how often that check is right, and a
collector who appears often is not shown to have done anything: a benign
disposition counts the same as any other. The page says so beside the
tables. Nothing is changed by reading the outcomes.

## Who sees what

Only those who may manage the project (`project.update`), as for
investigations; viewers, data collectors and App Users are refused. No export.

## API

`GET /v1/projects/:projectId/investigations/outcomes` returns:

```
{ status: { open, closed, reopened },
  dispositions: { <disposition>: n },
  timeToClose: { median, longest } | null,      // whole days
  months: [{ month: 'YYYY-MM', <disposition>: n }],   // 12, oldest first
  families: [{ family, <disposition>: n, total }],
  collectors: [{ actorId, displayName, <disposition>: n, total }],  // most first, at most 200
  hiddenFindings, generatedAt }
```

Responses are private and not stored. At most 200 collector rows; `collectorsOmitted` gives the rest.

## UI

Review page, Investigations section, for managers: "How investigations
ended", collapsed by default: the status and disposition counts, time to
close, a table by month, by kind of finding and by collector, with the note on
what the numbers are not. Reloaded after a closure or reopening.

## Not in this slice

Linking review cases or backchecks to investigations, filters by form or date,
charts, triage order of findings.

## Acceptance

- Integration: counts with open, closed and reopened investigations;
  dispositions by the latest closure; median and longest days; months; a
  finding in two closed investigations counted once under the later one; a
  pair finding counting both collectors; unknown submitter; findings on an
  unreadable form hidden and counted; viewers, collectors and App Users
  refused; nothing written.
- Browser: outcomes shown and reloaded after closing; empty project; failure
  message.

## Validation evidence

Locally, against real PostgreSQL 16:

- Unit: 6 tests in `test/unit/util/investigation-outcomes.js` (months, medians,
  status and dispositions, time to close, a finding counted once under the
  latest closure, pair collectors, unknown submitters, hidden findings, the
  200-collector limit).
- Integration: 2 tests in `test/integration/api/field-data-investigations.js`:
  - open, closed and reopened investigations with each table checked, a
    finding in two closed investigations, a pair finding, an unsent
    submission, a deleted form's finding hidden and counted, nothing written,
    viewers and App Users refused, an unknown project;
  - a pair's other submission in another form, and another project's closed
    investigation left out.
- Browser: outcomes hidden while there are none, shown after a closure with
  each table, reloaded after reopening, narrow width, a load failure reported
  with the list still shown, not loaded for those who may not manage the project.
- Deliberate breakages: 8 in the server (7 made a test fail; leaving out the
  project condition on finding rows changed nothing, because rows of other
  projects' investigations are already ignored when counted) and 4 in the
  client (all made a test fail).
