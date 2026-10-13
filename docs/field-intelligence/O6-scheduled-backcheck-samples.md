# O6: scheduled backcheck samples

Status: next slice chosen by the project owner ("focus on the features:
investigation outcomes, asset status by area, scheduled back-check samples",
2026-10-11); details open to revision.

O3 draws a random backcheck sample when a manager presses a button. During
fieldwork that has to happen every day or week, and a missed day means a
day's work never sampled. O6 lets a manager set a **schedule** for a form; the
operations runner then draws each period's sample with the O3 rules. It is
the "scheduled samples" deliverable left open by O3, in the operations row
(sampling coverage, independent backcheck allocation).

## The schedule

One per form: a rate (1 to 100 percent), a minimum per collector (0 to 20), a
frequency (daily or weekly) and whether it is on. Periods are UTC: a day
starts at 00:00; a week starts on Monday 00:00.

When a period ends, the next run of the operations runner (every 5 minutes)
draws a sample of the submissions **received during that period**, exactly as
O3 draws one with `receivedFrom` and `receivedTo` set to the period's first
and last day: same strata, minimum, seeded order, routing into review with
`backcheck-sample`, items unique across samples, audit entry. The sample
records the schedule it came from; it is drawn by no person.

- **Catching up**: if the runner was not running for several periods, the
  next run draws one sample covering all of them, so no received submission
  is left out, and says so in the run record.
- **The first period** starts when the schedule is turned on (the current
  period is sampled from then on), so turning a schedule on never samples
  older submissions; an O3 draw by hand does that.
- **Once per period**: each run has a deterministic request ID made from the
  schedule and the period's start, so a runner retried or running twice
  cannot draw two samples for one period.
- **Nothing eligible**: no sample is made; the run is recorded as such.
- **Too large** (over 500 chosen or 50,000 eligible): no sample is made; the
  run is recorded as failed with the count, and the schedule moves on. The
  manager can lower the rate or draw by hand for that period.
- A schedule on a deleted form is not run.
- Every due run rechecks the configuring manager's current permission. Lost
  permission or a deleted/archived project pauses the schedule with a failed
  run record; an authorized manager must enable it again.
- Unexpected write failures roll back the whole period and retry it on a later
  tick. They do not advance the period or record a successful draw. Oversized
  draws remain terminal failures requiring a manual draw or changed settings.
- At most 20 schedules are attempted per tick, least recently attempted first,
  so failed forms cannot permanently block other schedules.

Changing a schedule's rate, minimum or frequency applies from the next
period; turning it off stops it; turning it on again starts a new first
period. Every change is audited.

## Run records

Each run keeps: period start and end, outcome (`drawn`, `nothing-eligible`,
`failed`), the sample if one was drawn, eligible and sampled counts, the error
if failed, and when it ran. Run records are never changed.

## API

Under `/v1/projects/:projectId/forms/:xmlFormId/backcheck-schedule`:

- `GET` (`submission.list` and `submission.read`): the schedule (or null) with its next run and the
  20 latest run records.
- `PUT` (`submission.update`): `{ rate, minPerCollector, frequency, enabled }`.
  400.58 for invalid settings, as for O3.

O3's sample list and detail say `scheduled: true` for scheduled samples.

## UI

Verification page, Backcheck sample section: "Schedule": rate, minimum,
frequency, on or off, the next run, and the latest runs with their outcome
and a link to each drawn sample. Samples in the list are marked "Scheduled".

## Not in this slice

Other frequencies or time zones, several schedules per form, strata other
than collector, automatic backcheck requests, notifications of a failed run.

## Acceptance

- Unit: period boundaries (daily, weekly on Monday, catching up), the
  deterministic request ID.
- Integration: set, read and change a schedule (validation, permissions,
  audit); a run after a period draws a sample of only that period's
  submissions with the schedule recorded and items routed; nothing eligible;
  too large recorded as failed and moving on; catching up over missed
  periods; running twice draws once; turning off stops runs; a deleted form
  is skipped; migration and rollback.
- Browser: set a schedule, see the next run and runs with links, scheduled
  samples marked.

## Validation evidence

Locally, against real PostgreSQL 16:

- Unit: 4 new tests in `test/unit/util/backcheck-sample.js`:
  - day and Monday-week boundaries;
  - due runs, including catching up;
  - the per-period request ID;
  - schedule settings.
- Integration: 8 tests in `test/integration/api/field-data-backcheck-schedules.js`:
  - setting and reading a schedule:
    - seven refused bodies;
    - the first run at the next Monday;
    - viewers read but cannot change it, and App Users can do neither.
  - a period's run:
    - only the submissions received in that period are sampled and routed;
    - the sample is marked as scheduled and drawn by no one;
    - the run record and the next period are set;
    - running again draws nothing;
    - a schedule set back to an earlier period still does not draw it twice;
    - an empty period is recorded;
    - run records cannot be changed;
    - one audit entry per run.
  - catching up over three periods; a draw too large recorded as failed, with the schedule moving on; turning the schedule off and on; a deleted form skipped;
  - the migration rollback keeping schedules.
- The migration is in the rollback chain test, and the O3 sample tests pass with the shared draw.
- Browser: 2 new tests in `field-data-backcheck-sample.spec.js`:
  - a manager:
    - a refused save;
    - saving a weekly schedule, with the request body checked;
    - the status;
    - drawn, caught-up and failed runs;
    - opening a run's sample marked "on schedule";
    - turning the schedule off;
    - narrow width.
  - a viewer sees the schedule without the form.
- Deliberate breakages: 14 in the server and 5 in the client.
  - 12 server breakages made a test fail.
  - The 2 that did not are the re-checks under the row lock (schedule still on, form not deleted). These guard against a change between selecting and locking, which a single-threaded test cannot reach.
  - All client breakages made a test fail, after one test was strengthened.

Additional validation during integration: manager permission revocation and
archived projects pause without sampling; an injected failure after writes
leaves no sample, run or routed cases and retries the original period;
concurrent runners and a manual draw select each submission only once.

The bounded-batch regression creates 21 schedules, injects failure for the
first 20 attempts, and verifies that the untouched schedule is served on the
next tick. Final local validation: 1,844 server unit tests passed (one pending),
62 hardening checks passed, four browser tests passed, and the scheduled/manual
sample and claim-version integration suites passed.
