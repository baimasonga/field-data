# F6: investigation records

Status: next slice chosen under the project owner's delegated authority
("continue", 2026-10-10); details open to revision.

The findings inbox (F3) and collector groups (F5) show patterns worth looking
into, but there is nowhere to record that someone is looking: which findings
an inquiry covers, what was learned, and how it ended. Review cases decide one
submission at a time; a pattern across collectors or forms needs its own
record. F6 adds **investigations**: the "investigation records" deliverable of
the fraud-intelligence row, first slice, following the investigation model of
the fraud skill (case, events, disposition).

## What an investigation is

- A **title**, the **findings** it covers (integrity findings of the
  project's forms, up to 500), a **status** (open or closed) and, once closed,
  a **disposition** with a conclusion.
- **Dispositions**: confirmed issue, data error, benign pattern, insufficient
  evidence, policy exception, duplicate of another investigation.
- An **append-only history** of events: opened, findings added, note, closed
  (with disposition and conclusion), reopened (with a reason). Each event
  records who and when; none can be changed or removed.
- **Reopening** a closed investigation is how a disposition is appealed or
  corrected; the earlier closure stays in the history.

## What it does not do

An investigation is a record for people, not an action. Opening or closing
one changes no submission, finding, review case or payment, and it is not a
verdict on a collector: a group of findings can have a benign explanation, and
the disposition says so. Follow-up (a backcheck, a decision) happens through
the existing review cases.

## Who sees what

Investigations hold notes about people, so only those who may manage the
project (`project.update`) can see or write them; viewers, data collectors and
App Users cannot, and there is no export. A finding in an investigation is
shown only if the caller may read its form's submissions; others are counted.

## API

Under `/v1/projects/:projectId/investigations`:

- `GET` list (optional `status`), newest activity first;
- `POST` create `{ requestId, title, findingIds }` (idempotent by request ID);
- `GET /:id`: the investigation, its findings, its history;
- `POST /:id/findings { findingIds }`, `POST /:id/close { disposition,
  conclusion }`, `POST /:id/reopen { reason }`: each with `If-Match:
  "investigation-<revision>"`;
- `POST /:id/notes { note }`: appends, no revision needed.

Invalid input: 400; a stale revision: 412; closing a closed or reopening an
open investigation: 409.

## UI

Review page, for managers: "Investigations": the list with status and
disposition, the selected investigation's findings (linked to their
submissions), history, a note box, and close or reopen. Each collector group
(F5) gets "Open an investigation", prefilled with its findings.

## Not in this slice

Assignment and due dates, linking review cases or backchecks, attachments,
metrics over dispositions, retention rules.

## Acceptance

- Integration: create (idempotent), add findings (only the project's;
  duplicates ignored), notes, close with each validation, reopen, stale
  revision, wrong-state 409, history append-only in the database, findings of
  unreadable forms hidden and counted, no change to findings or cases,
  viewers and App Users refused; migration and rollback.
- Browser: list, open from a collector group, add a note, close and reopen,
  failure handling.
