# O8: calendar availability and visit itineraries

Project App Users have an optional weekly UTC calendar (Sunday through Saturday,
0–100 visits per day) and up to 366 dated exceptions. Zero means unavailable.
Managers configure calendars; project readers can view availability. Calendar
edits affect future allocation, not existing requests.

Automatic policies may enable respectCalendar (default false for compatibility).
With it enabled, a checker needs a configured calendar and a free day between
now and the due date (UTC dates, inclusive). The earliest date wins, then the
existing least-loaded ordering. Pending-work limits still apply. Requested and
linked visits both consume daily slots; cancelled requests do not. Completed
visits must not free today's already-used calendar capacity. All changes and
requests share the existing project allocation lock. A request stores its
plannedVisitDate, which appears in the App User inbox and signed offline snapshot.
No feasible slot leaves the case waiting unchanged; reports count those cases.
Manual requests without a visit date remain unplanned and are reported separately.

Managers preview one collector's pending itinerary for a UTC date from an
explicit starting latitude/longitude. A deterministic nearest-next-stop heuristic
orders usable pinned submission locations. Distances are great-circle kilometres,
not road distance, drive time, safety or an optimality claim. No external provider
receives locations. The route returns to the starting point. Unlocated, stale,
unverified, unreadable or currently unauthorized tasks are counted as excluded;
limits and calendar overbooking are explicit. GPS accuracy is shown; missing, negative or over 100-metre accuracy is flagged. CSV export preserves the preview for human field planning.
The preview does not assign, dispatch or change any request. Road navigation,
shift hours, travel-time optimization and automatic route dispatch remain pending.

API:
- GET /v1/projects/:projectId/backcheck-calendars: project.read, live App Users
  with calendars and current pending workload.
- PUT .../backcheck-calendars/:actorId: project.update, {weeklyCapacity:[7 integers],
  exceptions:[{date:YYYY-MM-DD,maxVisits}]}; live App User of that project only.
- GET .../backcheck-route?actorId=&date=&startLat=&startLon=: project.update plus
  read permission on each source and response form; private/no-store. At most
  100 scheduled tasks, with a truncation indicator. Coordinates are extracted
  only for readable, current, integrity-verified source versions.

Acceptance: unit calendar validation, exception precedence, date/slot boundaries,
completed/cancelled capacity, ranking, itinerary distances/ties/dateline; real
PostgreSQL calendar/permission tests, calendar-aware allocation, concurrency,
no-calendar/full days, source integrity and exclusions, rollback and old policies;
browser calendar save/errors, assignment toggle, date in inbox, route preview/CSV,
read-only access and narrow screens. Real device/field-route acceptance is separate.

## Validation evidence

- Unit: UTC dates and exception precedence; bounded input; earliest feasible
  slot and due-date boundary; independent and capacity-limited ranking;
  deterministic itinerary/ties, return distance and dateline crossing.
- PostgreSQL: missing calendars, dated quotas and exceptions, completed slots,
  cancellation freeing capacity, concurrent allocation, inbox dates, verified
  source locations, changed calendar overbooking, corrupted sources, revoked
  collector permissions, missing locations, route/byte limits, unknown GPS
  accuracy, manager/viewer/project boundaries and rollback/reapply.
- Browser: calendars and exceptions, save retry, calendar-aware policy toggle,
  itinerary/CSV with exclusions and overbooking/truncation warnings, formula
  protection while preserving numeric coordinates, read-only access, narrow
  screens and planned dates in both online and encrypted offline inboxes.

Final local validation: 1,850 server unit tests passed (one existing pending),
62 hardening checks passed, and 29 PostgreSQL API tests passed. All 27 selected
browser workflows passed after correcting a selector that matched the inbox's
backcheck, re-verification and receipt lists together; the repaired inbox test
was rerun separately. Server/client lint and diff checks passed.
