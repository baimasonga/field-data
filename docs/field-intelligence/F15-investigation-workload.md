# F15: investigation workload

The Review page summarizes all open investigations by their current eligible
manager, with project-wide open and overdue counts. Unassigned investigations
and those whose assigned manager has lost access are counted separately.
Overdue uses the same UTC calendar-day rule as the investigation queue.
Closed investigations are excluded. Counts describe current work and are not
an assessment of performance or a measure of investigative quality.

The manager-only `GET /projects/:projectId/investigations/workload` endpoint
returns the complete totals and up to 200 manager rows. Additional manager rows
are counted in the totals and reported as omitted. Names and IDs of managers
who no longer have access are not returned. The summary is independent of the
queue filters and does not allocate work, notify anyone, or change records.
