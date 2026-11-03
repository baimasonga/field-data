# R16: Collect server delivery receipts

Fieldwork offers an explicit, paginated inventory of submissions received from
the connected App User in the current project. It shows current instance/form
metadata, the XML receipt timestamp, expected and recorded attachment counts,
and up to ten missing filenames per instance. Closed forms remain visible.

`GET /v1/field-data/app-user/collect-delivery` returns at most twenty instances
per page, with a descending submission-definition cursor. It requires an active
App User and unarchived project, original and current-definition ownership, a
published form definition, and current form collection permission. Account,
source and permission rows are protected during the read. Deleted forms and
submissions, drafts, obsolete versions and versions edited by another actor are
excluded. The response is private/no-store and contains no XML answers, file
bytes, credentials, or download links. No new database tables are introduced.

Each instance's attachment counts and bounded missing-name list are read in one
SQL statement. The view reports attachment records, not independently verified
blob availability, file hashes, decryption or device state. Use R14 instance
handoff verification to check exact XML and file bytes. Absence from this view
does not establish that an instance is unsent: permissions, edits and deletion
also affect visibility. Existing R1 historical ledger behavior is unchanged.

Fetching is explicit. Refresh removes previous results before checking again;
failed pagination retains earlier results and permits retry. Disconnect removes
the panel, aborts the request and prevents late responses from populating a new
collector's view. Server responses are also checked against the current actor
and project. Nothing updates Collect's private queue or marks a device instance
sent. Collect remains authoritative for native queued, failed and sent states.

Validation includes PostgreSQL tests for missing/recorded and XML-only files,
filename bounds, ownership and grant changes, closed forms, deleted submissions,
archived projects, actor type, invalid cursors and multi-page results. Browser
tests cover explicit loading, pagination, retry, owner binding and disconnect
races. Physical-device native background sending remains pilot acceptance.
