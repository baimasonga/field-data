# O22: scheduled backcheck sampling by recorded area or answer

The existing daily/weekly schedule can now select the same recorded area or
scalar answer as O21 manual draws. On **Verification & planning → Random
backcheck sample → Schedule**, choose **Schedule grouping → By collector and
area or answer** and a published question. The rate/minimum applies to each
collector × answer intersection. Missing answers remain a visible group.
Selected normalized values are retained in sample history; choose categories
rather than personal identifiers. O21 field, value, category and sample limits
still apply, including refusal of ambiguous historical repeat answers.

## Persistence and period behavior

`PUT .../backcheck-schedule` accepts optional `groupField`. A path selects grouped
sampling; omitted/null clears it to collector-only. Legacy schedule responses
omit the field when unused. A nullable column stores the selection; migration
rollback retains it while configured schedules exist, and reapplying is safe.
The existing immutable run/sample history and append-only audits are unchanged.

UTC daily/weekly boundaries, catch-up periods, independent seeded draws, shared
manual/scheduled exclusion and retry serialization remain in effect. Grouping
changes apply to the next draw, including all eligible submissions already
received in the current period. Changing grouping does not start a new period.
Re-enabling a paused/off schedule starts a new period at that time, as before.
A failed period may be recovered with a reviewed manual received-date draw;
re-enabling does not automatically resample that past period.

## Permissions and failure behavior

Enabling a grouped schedule requires submission update, read and list permission,
and a supported scalar question in an unencrypted published form. The runner
rechecks all permissions and the current question before every draw. Disabling
remains possible when the saved question has retired. Unknown or unsupported
fields cannot be used to enable grouping.

Lost authority, an archived project or an unavailable question pauses the schedule
with a recorded failed run. Repeated/unreadable/encrypted/oversized answers or
excessive category/value counts roll back the draw and pause it with a bounded
message. No partial sample, cases or sample audit survives. The configuring
manager can correct the issue or return to collector-only sampling and re-enable.
An oversized total draw retains O6's recorded-period failure behavior and does
not pause the schedule. Transient database failures still roll back and retry
the original due period; one failing form does not block other schedules.

The existing form row lock prevents drawing while its deletion is under way.
Run records remain immutable. **Show sample** opens the ordinary grouped history,
with fixed membership and live requested/linked backcheck coverage. Selection
still routes into human review and existing independent assignment rules.

## Validation and remaining scope

Tests cover saved/cleared settings, unsupported paths, viewer restrictions,
catch-up with missing groups, seeded reproduction, repeated runs, atomic pause
and recovery, unavailable questions, read permission loss despite retained write
permission, archival, existing transaction retries/deletion/concurrency guards,
and migration rollback/reapply. Browser coverage includes existing saved groups,
failed-save retry, grouped history, clearing back to collector-only and mobile.

Unequal group-specific rates, geographic polygon strata, weighting and calibrated
estimates remain separate work. Production runner acceptance is distinct from
proving its selection contract in database tests; deployment checks retain the
existing operations-runner diagnostics.
