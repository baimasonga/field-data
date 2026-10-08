# Unified review workflow rollout

The sidebar's **Review Queue** now selects an authorized project and form and
uses the same claim-version review component as a form's verification screen.
Its project list comes from Central's authorized projects and forms endpoint.
Reading requires submission read access; assignment, decisions and back-check
actions are shown only with submission update permission. Every server route
continues to authorize the request independently.

The queue exposes open, in-review, resolved and superseded cases. Inspection
shows the exact claim version's provenance, original evidence downloads,
decision history and back-checks. Pending back-checks disable terminal decisions.
Mutation retries preserve their operation identifier for unchanged input and
revision. A late response from an old queue filter cannot replace the current
results.

Administrators retain submission quality rules and submission-status actions
under **Submission quality checks and rules**. Those actions remain separate
from append-only claim decisions and use the existing submission review API.
Opening the claim queue does not request or modify submission quality data.

## Validation and remaining acceptance

Browser fixtures exercise project/form selection, evidence and provenance,
read-only access, assignment, back-check request/link, pending-result blocking,
terminal decision history, retry, and stale response handling. They verify the
client's use of the existing API contract; they are not a production field pilot.
No new database migration or review API is introduced by this change.

Next, run a pilot with a test project, one form, two distinct App Users and a
reviewer. Collect an original submission, inspect its review case, assign it,
request a back-check from the other collector, submit that result offline in
ODK Collect, sync it, and link its instance ID. Confirm source and response
provenance identify the intended collectors. Record a decision and check its
stored evidence snapshot and audit event. Repeat with a read-only account and
with a stale revision; neither may alter the case without authorization.

Keep test data separate from operational records. Offline capture and sync must
be verified on an actual Collect device. Notifications, cancellation/reassignment,
custom back-check forms and automatic answer comparison remain follow-on work
as described in P0.6. Audited override UI is outside this package: the current
terminal-decision API accepts only `override: false`.

Run the isolated browser regression suite from `central/client`:

```sh
npm exec -- playwright test --config e2e-tests/field-data.config.js
```

The configuration starts Vite and uses API fixtures without a database. Install
Playwright Chromium first, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an
installed Chromium executable. Set `ODK_URL` to test a separately running
frontend; API requests in these tests are still intercepted by fixtures.
