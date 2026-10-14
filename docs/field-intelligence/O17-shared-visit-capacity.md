# O17: shared capacity for re-verification and backchecks

Managers may choose an optional UTC planned visit date when dispatching a
re-verification task. A dated assignment requires a future visit deadline and an
existing collector calendar, must fall within 90 days and on or before the
UTC deadline date, and must fit that day's quota and saved shift window.
The form and project must be active. Undated legacy assignments remain allowed;
removing a planned date explicitly releases its reservation.

Backchecks (requested or linked) and re-verification tasks (dispatched or closed)
consume the same daily visit allowance. Completed visits retain capacity;
cancelled visits release it. Reassignment excludes the current task's reservation
while checking the replacement. Calendar changes never reschedule existing work.
Dispatch, cancellation, calendar edits and automatic backcheck allocation use the
same project transaction lock. Revision checks, immutable events and identical
retry semantics are retained. Planned dates are stored in task events and audit
records and shown to managers and the assigned collector.

Backcheck previews report shared reserved/completed counts and separately flag
re-verification visits. Their stops and travel are not included in the backcheck
route: combined workload needs manager review. This does not provide a unified
route or guarantee travel feasibility. Closed visits conservatively consume the
saved minimum visit duration; undated tasks do not reserve a calendar day.
Re-verification tasks are not yet included in encrypted offline snapshots.

The migration preserves dated work and append-only history on rollback. API
coverage checks calendar requirements, invalid dates, self-slot retention,
competing and simultaneous last-slot reservations, cancelled-slot reuse and automatic backcheck allocation.
Browser coverage checks manager entry and collector display of planned dates.
