# F13: investigation assignment and due dates

Project managers can assign an open investigation to an active web user with
project-management access and set or clear a calendar due date. They can also
leave the investigation unassigned. Each change requires a reason and the
current investigation revision; it is recorded in the append-only history and
the project audit. Closing an investigation prevents assignment changes until it
is reopened. Assignment does not grant access, send a notification, or modify
findings and review cases.

The manager-only assignee list is limited to 200 entries. Eligibility is
checked again and grants are locked when saving. If a manager later loses access,
the investigation shows the assignment as unavailable; a project manager can
choose someone else. A due date is a calendar date, not a reminder or a
deadline enforced by automation. There is no automatic allocation or workload
balancing in this feature.

The Review page's Investigations section shows the assignment, due date and
history, and lets a project manager change them. The API exposes
`GET /projects/:projectId/investigations/assignees` and revision-checked
`POST /projects/:projectId/investigations/:id/assignment` with `assignedTo`,
`dueDate` and `reason`.
