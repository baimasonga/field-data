# O20: overnight UTC visit shifts

A manager can select **end next day** for a weekly or dated calendar window,
for example `{ start: '22:00', end: '06:00', endNextDay: true }`. Both clocks
are UTC. Without this explicit flag, the end must remain later on the same date.
Overnight ends must have an earlier clock time: zero, 24-hour and longer shifts
are rejected. Legacy date-only and same-day calendars retain their behavior.
No database migration is required.

## Scheduling contract

The calendar date, quota, dated exceptions and `plannedVisitDate` always identify
the UTC date on which the shift starts. Wednesday 22:00 to Thursday 06:00 uses
Wednesday's quota, including after midnight. Closing Thursday's window does not
cancel Wednesday's tail; close Wednesday to do that. Editing a calendar never
moves or cancels existing work.

Weekly windows cannot overlap adjacent days, including Saturday to Sunday.
Each dated exception is checked against the actual preceding and following
window, including other exceptions. Touching endpoints are allowed. Set an
unavailable window to `null`; a zero quota alone does not erase its window.

Automatic allocation considers yesterday's still-active overnight window first.
Explicit re-verification dispatch can select yesterday only if that window is
still open and fits another visit before its exact deadline. Both use shared
requested/completed backcheck and re-verification reservations, the existing
project lock, independent collector rules and pending limits. All reservations
are conservatively charged against the remaining minimum visit-time budget;
completed work does not free quota. These checks do not establish travel or
field safety feasibility.

## Reviewer and collector workflow

Open **Availability and route planning** on a source form's submissions page,
choose a collector, enable saved UTC windows and select **end next day** for
applicable weekly/custom exception windows. Overlapping saves are rejected with
recovery guidance. For after-midnight route previews and re-verification dates,
choose the shift's start date. Preview and CSV show full UTC boundaries and the
quota date; preview overrides cannot enlarge the remaining shift budget.

Approved itineraries carry an optional `{ startAt, endAt }` shift window to the
collector inbox and encrypted signed offline snapshot. The window reflects the
approved snapshot, not later calendar edits. Both displays explain the start date.
Offline validation rejects noncanonical/impossible timestamps, wrong start
dates, reversed windows, durations of 24 hours or more and extra shift fields.
Old approved itineraries and snapshots without this optional window still work.
Offline snapshots cannot check subsequent cancellations or road conditions.

## Validation

Server tests exercise explicit intent, invalid durations, adjacent weekly/dated
overlaps, year/leap rollover, closed exceptions, shared quota, exact deadlines,
ongoing previous-night dispatch/allocation, persisted settings, expired previews
and online/signed offline boundaries. Browser tests cover editing, invalid-clock
and overlap recovery, preview dates, collector displays, malformed signed
windows rejected before encrypted storage, and mobile widths.

This completes overnight support within the existing two visit types. Navigation,
other task types, sampling strata and calibrated estimates remain separate work;
live regional routing and real-device acceptance remain pending.
