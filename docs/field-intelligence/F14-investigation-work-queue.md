# F14: investigation work queue

Project managers can filter investigations by status, assigned manager
(including themselves or unassigned), and overdue status on the Review page.
An investigation is overdue when it is open and its due date is before the
current UTC calendar date. Closed investigations and investigations without a
due date are never overdue. The list highlights overdue records and explains
that at most 200 matching records are displayed.

Filters are applied by the server before the existing 200-record limit.
Changing a filter does not change investigations, notifications or permissions.
The API accepts `status=open|closed`, `assignee=me|unassigned|<actorId>` and
`overdue=true|false` on the manager-only investigation list. `overdue=false`
leaves the list unfiltered by overdue status. Invalid filter values are rejected.
Outcomes remain project-wide and are not affected by these list filters.
